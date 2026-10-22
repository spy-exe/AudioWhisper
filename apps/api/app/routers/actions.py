import json
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from audiowhisper_core.evidence import expose_sources, snapshots, source_map
from audiowhisper_core.models import ActionTask, WorkspaceItem
from app.dependencies import get_db
from app.routers.documents import get_document, require_reviewed
from app.routers.projects import require_project

router = APIRouter(prefix="/api/tasks", tags=["tasks"])
TaskStatus = Literal["open", "doing", "done"]
Priority = Literal["low", "normal", "high"]


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=512)
    description: str = Field(default="", max_length=12000)
    project: str = Field(default="", max_length=128)
    assignee: str | None = Field(default=None, max_length=256)
    due_date: date | None = None
    priority: Priority = "normal"

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value):
        if not value.strip():
            raise ValueError("Informe o título da tarefa.")
        return value.strip()


class TaskPatch(BaseModel):
    revision: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=512)
    description: str | None = Field(default=None, max_length=12000)
    project: str | None = Field(default=None, max_length=128)
    assignee: str | None = Field(default=None, max_length=256)
    due_date: date | None = None
    priority: Priority | None = None
    status: TaskStatus | None = None
    archived: bool | None = None


def task_out(task, current):
    fields = ("id", "title", "description", "project", "status", "priority", "assignee", "due_date", "due_label", "job_id", "document_id", "archived", "revision", "created_at", "updated_at")
    return {**{field: getattr(task, field) for field in fields}, **expose_sources(task, current)}


@router.get("")
def tasks(project: str = Query(default="", max_length=128), q: str = Query(default="", max_length=200),
          task_id: str = Query(default="", max_length=36),
          status: Literal["all", "open", "doing", "done"] = "all", archived: bool = False,
          offset: int = Query(default=0, ge=0), limit: int = Query(default=30, ge=1, le=100), db: Session = Depends(get_db)):
    conditions = [ActionTask.archived == archived]
    if task_id:
        conditions.append(ActionTask.id == task_id)
    if project:
        conditions.append(ActionTask.project == project)
    if status != "all":
        conditions.append(ActionTask.status == status)
    if q.strip():
        conditions.append(or_(ActionTask.title.icontains(q.strip(), autoescape=True), ActionTask.description.icontains(q.strip(), autoescape=True)))
    base = select(ActionTask).where(*conditions)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    items = list(db.scalars(base.order_by(ActionTask.created_at.desc(), ActionTask.id).offset(offset).limit(limit)))
    current = source_map(db, items)
    return {"items": [task_out(task, current) for task in items], "total": total, "offset": offset, "limit": limit}


@router.post("", status_code=201)
def create_task(payload: TaskIn, db: Session = Depends(get_db)):
    if payload.project:
        require_project(db, payload.project)
    values = payload.model_dump()
    values["due_date"] = payload.due_date.isoformat() if payload.due_date else None
    task = ActionTask(**values)
    db.add(task)
    db.commit()
    return task_out(task, {})


class ImportIn(BaseModel):
    document_id: str = Field(min_length=1, max_length=36)


@router.post("/import")
def import_actions(payload: ImportIn, db: Session = Depends(get_db)):
    document = get_document(db, payload.document_id)
    require_reviewed(db, document)
    workspace = db.get(WorkspaceItem, document.job_id)
    imported = 0
    keys = []
    for index, item in enumerate(json.loads(document.content_json)):
        if item["kind"] != "action":
            continue
        key = f"{document.id}:{index}"
        keys.append(key)
        if db.scalar(select(ActionTask.id).where(ActionTask.import_key == key)):
            continue
        sources = snapshots(db, item["source_segment_ids"])
        if len(sources) != len(set(item["source_segment_ids"])) or any(source["job_id"] != document.job_id for source in sources):
            raise HTTPException(409, "As fontes da ação foram alteradas. Gere e revise um novo documento.")
        try:
            with db.begin_nested():
                db.add(ActionTask(title=item["text"][:512], description=item["text"], project=workspace.project if workspace else "",
                                  assignee=item.get("assignee"), due_label=item.get("due_date"), job_id=document.job_id,
                                  document_id=document.id, import_key=key, sources_json=json.dumps(sources, ensure_ascii=False)))
                db.flush()
            imported += 1
        except IntegrityError:
            pass  # A concurrent import has already persisted the same action.
    db.commit()
    items = list(db.scalars(select(ActionTask).where(ActionTask.import_key.in_(keys))))
    current = source_map(db, items)
    return {"imported": imported, "items": [task_out(task, current) for task in items]}


@router.patch("/{task_id}")
def update_task(task_id: str, payload: TaskPatch, db: Session = Depends(get_db)):
    if not db.get(ActionTask, task_id):
        raise HTTPException(404, "Tarefa não encontrada.")
    values = payload.model_dump(exclude_unset=True, exclude={"revision"})
    for field in ("title", "description", "project", "priority", "status", "archived"):
        if field in values and values[field] is None:
            raise HTTPException(422, f"O campo {field} não pode ser vazio.")
    if "title" in values:
        values["title"] = values["title"].strip()
        if not values["title"]:
            raise HTTPException(422, "Informe o título da tarefa.")
    if values.get("project"):
        require_project(db, values["project"])
    if "due_date" in values and values["due_date"]:
        values["due_date"] = values["due_date"].isoformat()
    result = db.execute(update(ActionTask).where(ActionTask.id == task_id, ActionTask.revision == payload.revision).values(**values, revision=ActionTask.revision + 1))
    if not result.rowcount:
        db.rollback()
        raise HTTPException(409, "Esta tarefa mudou em outra janela. Atualize a lista e tente novamente.")
    db.commit()
    db.expire_all()
    task = db.get(ActionTask, task_id)
    return task_out(task, source_map(db, [task]))
