import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from audiowhisper_core.evidence import expose_sources, snapshots, source_map
from audiowhisper_core.models import NotebookEntry, WorkspaceItem
from app.dependencies import get_db
from app.services.job_service import get_job_or_404

router = APIRouter(tags=["notebook"])
NoteKind = Literal["note", "bookmark", "chapter"]


class NoteIn(BaseModel):
    segment_id: str = Field(min_length=1, max_length=36)
    title: str = Field(min_length=1, max_length=512)
    body: str = Field(default="", max_length=12000)
    kind: NoteKind = "note"

    @field_validator("title")
    @classmethod
    def clean_title(cls, value):
        if not value.strip():
            raise ValueError("Informe um título.")
        return value.strip()


class NotePatch(BaseModel):
    revision: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=512)
    body: str | None = Field(default=None, max_length=12000)
    kind: NoteKind | None = None
    archived: bool | None = None


def note_out(note, current, project=""):
    return {**{field: getattr(note, field) for field in ("id", "job_id", "title", "body", "kind", "archived", "revision", "created_at", "updated_at")},
            "project": project, **expose_sources(note, current)}


@router.get("/api/notebook")
def notebook(project: str = Query(default="", max_length=128), job_id: str = Query(default="", max_length=36),
             q: str = Query(default="", max_length=200), kind: Literal["all", "note", "bookmark", "chapter"] = "all", archived: bool = False,
             offset: int = Query(default=0, ge=0), limit: int = Query(default=30, ge=1, le=100), db: Session = Depends(get_db)):
    conditions = [NotebookEntry.archived == archived]
    if project:
        conditions.append(WorkspaceItem.project == project)
    if job_id:
        conditions.append(NotebookEntry.job_id == job_id)
    if kind != "all":
        conditions.append(NotebookEntry.kind == kind)
    if q.strip():
        conditions.append(or_(NotebookEntry.title.icontains(q.strip(), autoescape=True), NotebookEntry.body.icontains(q.strip(), autoescape=True)))
    base = select(NotebookEntry, WorkspaceItem.project).outerjoin(WorkspaceItem, WorkspaceItem.job_id == NotebookEntry.job_id).where(*conditions)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    rows = db.execute(base.order_by(NotebookEntry.created_at.desc(), NotebookEntry.id).offset(offset).limit(limit)).all()
    current = source_map(db, [note for note, _ in rows])
    return {"items": [note_out(note, current, name or "") for note, name in rows], "total": total, "offset": offset, "limit": limit}


@router.post("/api/jobs/{job_id}/notes", status_code=201)
def create_note(job_id: str, payload: NoteIn, db: Session = Depends(get_db)):
    get_job_or_404(db, job_id)
    sources = snapshots(db, [payload.segment_id])
    if not sources or sources[0]["job_id"] != job_id:
        raise HTTPException(422, "Selecione um segmento desta gravação.")
    note = NotebookEntry(job_id=job_id, title=payload.title, body=payload.body, kind=payload.kind, sources_json=json.dumps(sources, ensure_ascii=False))
    db.add(note)
    db.commit()
    workspace = db.get(WorkspaceItem, job_id)
    return note_out(note, source_map(db, [note]), workspace.project if workspace else "")


@router.patch("/api/notebook/{note_id}")
def update_note(note_id: str, payload: NotePatch, db: Session = Depends(get_db)):
    note = db.get(NotebookEntry, note_id)
    if not note:
        raise HTTPException(404, "Nota não encontrada.")
    values = payload.model_dump(exclude_unset=True, exclude={"revision"})
    if any(value is None for value in values.values()) or ("title" in values and not values["title"].strip()):
        raise HTTPException(422, "Informe valores válidos para a nota.")
    result = db.execute(update(NotebookEntry).where(NotebookEntry.id == note_id, NotebookEntry.revision == payload.revision).values(**values, revision=NotebookEntry.revision + 1))
    if not result.rowcount:
        db.rollback()
        raise HTTPException(409, "Esta nota mudou em outra janela. Atualize e tente novamente.")
    db.commit()
    db.expire_all()
    note = db.get(NotebookEntry, note_id)
    workspace = db.get(WorkspaceItem, note.job_id)
    return note_out(note, source_map(db, [note]), workspace.project if workspace else "")
