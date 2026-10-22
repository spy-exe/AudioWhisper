import json
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from audiowhisper_core.enums import TERMINAL_STATUSES
from audiowhisper_core.models import DocumentRecipe, MediaFile, TranscriptionJob, TranscriptSegment, WorkspaceItem
from audiowhisper_core.schemas import TranscriptionJobOut
from app.dependencies import get_db
from app.services.job_service import get_job_or_404

router = APIRouter(prefix="/api/library", tags=["library"])


class OrganizationIn(BaseModel):
    title: str = Field(default="", max_length=512)
    folder: str = Field(default="", max_length=128)
    project: str = Field(default="", max_length=128)
    tags: list[str] = Field(default_factory=list, max_length=30)
    speakers: dict[str, str] = Field(default_factory=dict, max_length=100)


def workspace_out(item):
    return {"title": item.title, "folder": item.folder, "project": item.project,
            "tags": json.loads(item.tags_json), "speakers": json.loads(item.speakers_json),
            "diarization_status": item.diarization_status, "diarization_error": item.diarization_error} if item else {
        "title": "", "folder": "", "project": "", "tags": [], "speakers": {},
        "diarization_status": "idle", "diarization_error": None}


@router.get("")
def library(q: str = Query(default="", max_length=200),
            status: Literal["all", "active", "completed", "failed", "cancelled"] = "all",
            folder: str = Query(default="", max_length=128), project: str = Query(default="", max_length=128),
            tag: str = Query(default="", max_length=128), offset: int = Query(default=0, ge=0),
            limit: int = Query(default=12, ge=1, le=50), db: Session = Depends(get_db)):
    conditions = []
    if q.strip():
        term = q.strip()
        matching_segment = select(TranscriptSegment.id).where(
            TranscriptSegment.job_id == TranscriptionJob.id, TranscriptSegment.text.icontains(term, autoescape=True)).exists()
        conditions.append(or_(MediaFile.original_name.icontains(term, autoescape=True),
                              WorkspaceItem.title.icontains(term, autoescape=True), matching_segment))
    if status == "active":
        conditions.append(TranscriptionJob.status.not_in(TERMINAL_STATUSES))
    elif status != "all":
        conditions.append(TranscriptionJob.status == status)
    if folder:
        conditions.append(WorkspaceItem.folder == folder)
    if project:
        conditions.append(WorkspaceItem.project == project)
    if tag:
        # json_each matches complete tags, rather than substrings or JSON syntax.
        tags = func.json_each(WorkspaceItem.tags_json).table_valued("value")
        conditions.append(select(tags.c.value).where(tags.c.value == tag).exists())
    base = select(TranscriptionJob, MediaFile, WorkspaceItem).join(MediaFile).outerjoin(WorkspaceItem).where(*conditions)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    rows = db.execute(base.order_by(TranscriptionJob.created_at.desc(), TranscriptionJob.id).offset(offset).limit(limit)).all()
    return {"items": [{"job": TranscriptionJobOut.model_validate(job), "name": media.original_name,
                       "duration_seconds": media.duration_seconds, "media_type": media.media_type,
                       **workspace_out(item)} for job, media, item in rows], "total": total, "offset": offset, "limit": limit}


@router.get("/{job_id}")
def get_organization(job_id: str, db: Session = Depends(get_db)):
    get_job_or_404(db, job_id)
    return workspace_out(db.get(WorkspaceItem, job_id))


@router.put("/{job_id}")
def organize(job_id: str, payload: OrganizationIn, db: Session = Depends(get_db)):
    job = get_job_or_404(db, job_id)
    item = db.get(WorkspaceItem, job_id)
    if not item:
        item = WorkspaceItem(job_id=job_id)
        db.add(item)
    item.title, item.folder, item.project = payload.title.strip(), payload.folder.strip(), payload.project.strip()
    item.tags_json = json.dumps(list(dict.fromkeys(t.strip()[:128] for t in payload.tags if t.strip())))
    item.speakers_json = json.dumps({k[:64]: v.strip()[:128] for k, v in payload.speakers.items() if v.strip()})
    db.commit()
    if job.status == "completed" and item.project and db.scalar(select(DocumentRecipe.id).where(
            DocumentRecipe.project == item.project, DocumentRecipe.enabled.is_(True), DocumentRecipe.automatic.is_(True)).limit(1)):
        try:
            from app.queue import get_queue
            get_queue().enqueue("app.workspace_tasks.schedule_recipes", job_id, job_timeout=60)
        except Exception:
            pass  # Startup recovery also reconciles completed recordings and recipes.
    return workspace_out(item)
