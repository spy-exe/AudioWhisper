import json
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import case, func, or_, select, true
from sqlalchemy.orm import Session

from audiowhisper_core.config import Settings, get_settings
from audiowhisper_core.enums import TERMINAL_STATUSES
from audiowhisper_core.errors import AppError
from audiowhisper_core.models import AIDocument, MediaFile, TranscriptionJob, TranscriptSegment, WorkspaceItem
from audiowhisper_core.schemas import TranscriptionJobOut
from audiowhisper_core.text import fold_text, snippet
from app.dependencies import get_db
from app.services import job_service
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


def like_pattern(term: str) -> str:
    """Accent-insensitive LIKE pattern; user wildcards are literal characters."""
    escaped = fold_text(term).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def folded_like(column, term: str):
    return func.aw_fold(column).like(like_pattern(term), escape="\\")


def segment_matches(db: Session, job_id: str, term: str, limit: int = 3) -> tuple[list[dict], int]:
    condition = (TranscriptSegment.job_id == job_id, folded_like(TranscriptSegment.text, term))
    total = db.scalar(select(func.count()).select_from(TranscriptSegment).where(*condition)) or 0
    rows = db.scalars(select(TranscriptSegment).where(*condition).order_by(TranscriptSegment.segment_index).limit(limit))
    return [{"segment_id": s.id, "start": s.start, "speaker_id": s.speaker_id, **(snippet(s.text, term) or {})}
            for s in rows], total


SORTS = {
    "recent": (TranscriptionJob.created_at.desc(),),
    "oldest": (TranscriptionJob.created_at.asc(),),
    "name": (func.lower(func.coalesce(func.nullif(WorkspaceItem.title, ""), MediaFile.original_name)).asc(),),
    "duration": (case((MediaFile.duration_seconds.is_(None), 1), else_=0), MediaFile.duration_seconds.desc()),
}


@router.get("")
def library(q: str = Query(default="", max_length=200),
            status: Literal["all", "active", "completed", "failed", "cancelled"] = "all",
            folder: str = Query(default="", max_length=128), project: str = Query(default="", max_length=128),
            tag: str = Query(default="", max_length=128), sort: Literal["recent", "oldest", "name", "duration"] = "recent",
            offset: int = Query(default=0, ge=0), limit: int = Query(default=12, ge=1, le=50),
            db: Session = Depends(get_db)):
    conditions = []
    term = q.strip()
    if term:
        matching_segment = select(TranscriptSegment.id).where(
            TranscriptSegment.job_id == TranscriptionJob.id, folded_like(TranscriptSegment.text, term)).exists()
        conditions.append(or_(folded_like(MediaFile.original_name, term),
                              folded_like(WorkspaceItem.title, term), matching_segment))
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
    rows = db.execute(base.order_by(*SORTS[sort], TranscriptionJob.id).offset(offset).limit(limit)).all()
    items = []
    for job, media, item in rows:
        entry = {"job": TranscriptionJobOut.model_validate(job), "name": media.original_name,
                 "duration_seconds": media.duration_seconds, "media_type": media.media_type, **workspace_out(item)}
        if term:
            entry["matches"], entry["match_count"] = segment_matches(db, job.id, term)
        items.append(entry)
    return {"items": items, "total": total, "offset": offset, "limit": limit}


@router.get("/facets")
def facets(db: Session = Depends(get_db)):
    """Existing folders, projects and tags, so filters are chosen instead of typed blind."""
    def grouped(column):
        rows = db.execute(select(column, func.count()).where(column != "").group_by(column).order_by(func.lower(column)))
        return [{"value": value, "count": count} for value, count in rows]
    tags = func.json_each(WorkspaceItem.tags_json).table_valued("value")
    tag_rows = db.execute(select(tags.c.value, func.count()).select_from(WorkspaceItem).join(tags, true())
                          .group_by(tags.c.value).order_by(func.lower(tags.c.value)))
    return {"folders": grouped(WorkspaceItem.folder), "projects": grouped(WorkspaceItem.project),
            "tags": [{"value": value, "count": count} for value, count in tag_rows]}


@router.get("/stats")
def library_stats(db: Session = Depends(get_db)):
    completed = TranscriptionJob.status == "completed"
    text = func.trim(TranscriptSegment.text)
    words = db.scalar(
        select(func.coalesce(func.sum(func.length(text) - func.length(func.replace(text, " ", "")) + 1), 0))
        .join(TranscriptionJob, TranscriptionJob.id == TranscriptSegment.job_id).where(completed, text != "")) or 0
    # Distinct media: a retranscription of the same file must not double the transcribed time.
    media_seconds = select(MediaFile.id, MediaFile.duration_seconds.label("seconds")) \
        .join(TranscriptionJob, TranscriptionJob.media_file_id == MediaFile.id).where(completed).distinct().subquery()
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    return {
        "recordings": db.scalar(select(func.count()).select_from(TranscriptionJob)) or 0,
        "completed": db.scalar(select(func.count()).select_from(TranscriptionJob).where(completed)) or 0,
        "active": db.scalar(select(func.count()).select_from(TranscriptionJob)
                            .where(TranscriptionJob.status.not_in(TERMINAL_STATUSES))) or 0,
        "transcribed_seconds": round(db.scalar(select(func.coalesce(func.sum(media_seconds.c.seconds), 0.0))) or 0.0, 2),
        "words": int(words),
        "documents": db.scalar(select(func.count()).select_from(AIDocument)
                               .where(AIDocument.status.in_(["generated", "reviewed"]))) or 0,
        "last_7_days": db.scalar(select(func.count()).select_from(TranscriptionJob)
                                 .where(TranscriptionJob.created_at >= week_ago)) or 0,
    }


class BulkIn(BaseModel):
    action: Literal["delete", "organize"]
    job_ids: list[str] = Field(min_length=1, max_length=100)
    folder: str | None = Field(default=None, max_length=128)
    project: str | None = Field(default=None, max_length=128)
    add_tags: list[str] = Field(default_factory=list, max_length=30)


@router.post("/bulk")
def bulk(payload: BulkIn, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    """Per-item outcome: one recording still processing never blocks the rest of the batch."""
    done, skipped = [], []
    for job_id in dict.fromkeys(payload.job_ids):
        try:
            job = get_job_or_404(db, job_id)
            if payload.action == "delete":
                job_service.delete_job(db, settings, job)
            else:
                item = db.get(WorkspaceItem, job_id) or WorkspaceItem(job_id=job_id)
                db.add(item)
                if payload.folder is not None:
                    item.folder = payload.folder.strip()
                if payload.project is not None:
                    item.project = payload.project.strip()
                if payload.add_tags:
                    tags = json.loads(item.tags_json or "[]") + [t.strip()[:128] for t in payload.add_tags if t.strip()]
                    item.tags_json = json.dumps(list(dict.fromkeys(tags))[:30], ensure_ascii=False)
                db.commit()
            done.append(job_id)
        except AppError as exc:
            db.rollback()
            skipped.append({"job_id": job_id, "reason": exc.message})
    return {"action": payload.action, "done": done, "skipped": skipped}


@router.get("/{job_id}")
def get_organization(job_id: str, db: Session = Depends(get_db)):
    get_job_or_404(db, job_id)
    return workspace_out(db.get(WorkspaceItem, job_id))


@router.put("/{job_id}")
def organize(job_id: str, payload: OrganizationIn, db: Session = Depends(get_db)):
    get_job_or_404(db, job_id)
    item = db.get(WorkspaceItem, job_id)
    if not item:
        item = WorkspaceItem(job_id=job_id)
        db.add(item)
    item.title, item.folder, item.project = payload.title.strip(), payload.folder.strip(), payload.project.strip()
    item.tags_json = json.dumps(list(dict.fromkeys(t.strip()[:128] for t in payload.tags if t.strip())))
    item.speakers_json = json.dumps({k[:64]: v.strip()[:128] for k, v in payload.speakers.items() if v.strip()})
    db.commit()
    return workspace_out(item)
