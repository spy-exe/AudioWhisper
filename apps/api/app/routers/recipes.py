import json

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from audiowhisper_core.intelligence import TEMPLATES
from audiowhisper_core.models import DocumentRecipe, RecipeRun, WorkspaceItem
from audiowhisper_core.workspace import ensure_recipe_run
from app.dependencies import get_db
from app.queue import get_queue
from app.routers.projects import require_project
from app.services.job_service import get_job_or_404

router = APIRouter(tags=["recipes"])


class RecipeIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    project: str = Field(default="", max_length=128)
    kind: str = Field(min_length=1, max_length=32)
    model: str = Field(min_length=1, max_length=128)
    instruction: str = Field(default="", max_length=4000)
    automatic: bool = False
    enabled: bool = True

    @field_validator("kind")
    @classmethod
    def template_exists(cls, value):
        if value not in TEMPLATES:
            raise ValueError("Escolha um tipo de documento disponível.")
        return value

    @field_validator("name", "model")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Preencha este campo.")
        return value.strip()


class RecipePatch(BaseModel):
    revision: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=128)
    instruction: str | None = Field(default=None, max_length=4000)
    automatic: bool | None = None
    enabled: bool | None = None


def recipe_out(recipe):
    return {field: getattr(recipe, field) for field in ("id", "name", "project", "kind", "model", "instruction", "automatic", "enabled", "revision", "created_at", "updated_at")}


def run_out(run):
    return {**{field: getattr(run, field) for field in ("id", "recipe_id", "job_id", "document_id", "status", "error", "created_at", "updated_at")},
            "name": json.loads(run.payload_json)["name"]}


@router.get("/api/recipes")
def recipes(project: str = Query(default="", max_length=128), offset: int = Query(default=0, ge=0),
            limit: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)):
    base = select(DocumentRecipe)
    if project:
        base = base.where(DocumentRecipe.project == project)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    return {"items": [recipe_out(r) for r in db.scalars(base.order_by(DocumentRecipe.created_at.desc(), DocumentRecipe.id).offset(offset).limit(limit))],
            "total": total, "offset": offset, "limit": limit}


@router.post("/api/recipes", status_code=201)
def create(payload: RecipeIn, db: Session = Depends(get_db)):
    if payload.project:
        require_project(db, payload.project)
    recipe = DocumentRecipe(**payload.model_dump())
    db.add(recipe)
    db.commit()
    return recipe_out(recipe)


@router.patch("/api/recipes/{recipe_id}")
def edit(recipe_id: str, payload: RecipePatch, db: Session = Depends(get_db)):
    if not db.get(DocumentRecipe, recipe_id):
        raise HTTPException(404, "Receita não encontrada.")
    values = payload.model_dump(exclude_unset=True, exclude={"revision"})
    if any(value is None for value in values.values()) or ("name" in values and not values["name"].strip()):
        raise HTTPException(422, "Preencha os campos da receita.")
    result = db.execute(update(DocumentRecipe).where(DocumentRecipe.id == recipe_id, DocumentRecipe.revision == payload.revision).values(**values, revision=DocumentRecipe.revision + 1))
    if not result.rowcount:
        db.rollback()
        raise HTTPException(409, "A receita mudou em outra janela. Atualize e tente novamente.")
    db.commit()
    db.expire_all()
    return recipe_out(db.get(DocumentRecipe, recipe_id))


class RunIn(BaseModel):
    job_id: str = Field(min_length=1, max_length=36)


def enqueue_run(db, run):
    db.commit()
    try:
        get_queue().enqueue("app.workspace_tasks.run_recipe", run.id, job_id=f"recipe-{run.id}", job_timeout=7200)
    except Exception:
        run.status, run.error = "failed", "Fila indisponível. A execução foi preservada; tente novamente."
        db.commit()
        raise HTTPException(503, run.error)
    return run_out(run)


@router.post("/api/recipes/{recipe_id}/run", status_code=202)
def run_recipe(recipe_id: str, payload: RunIn, db: Session = Depends(get_db)):
    recipe = db.get(DocumentRecipe, recipe_id)
    if not recipe:
        raise HTTPException(404, "Receita não encontrada.")
    if not recipe.enabled:
        raise HTTPException(409, "Habilite a receita antes de executá-la.")
    job = get_job_or_404(db, payload.job_id)
    workspace = db.get(WorkspaceItem, job.id)
    if job.status != "completed" or (recipe.project and (not workspace or workspace.project != recipe.project)):
        raise HTTPException(422, "Selecione uma gravação concluída do projeto da receita.")
    run, created = ensure_recipe_run(db, recipe, job.id)
    return enqueue_run(db, run) if created else run_out(run)


@router.get("/api/recipe-runs")
def runs(project: str = Query(default="", max_length=128), offset: int = Query(default=0, ge=0),
         limit: int = Query(default=20, ge=1, le=100), db: Session = Depends(get_db)):
    base = select(RecipeRun).join(DocumentRecipe)
    if project:
        base = base.where(DocumentRecipe.project == project)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    return {"items": [run_out(r) for r in db.scalars(base.order_by(RecipeRun.created_at.desc(), RecipeRun.id).offset(offset).limit(limit))],
            "total": total, "offset": offset, "limit": limit}


@router.post("/api/recipe-runs/{run_id}/retry", status_code=202)
def retry(run_id: str, db: Session = Depends(get_db)):
    run = db.get(RecipeRun, run_id)
    if not run:
        raise HTTPException(404, "Execução não encontrada.")
    if run.status != "failed":
        raise HTTPException(409, "Somente execuções com falha podem ser repetidas.")
    run.status, run.error = "queued", None
    return enqueue_run(db, run)
