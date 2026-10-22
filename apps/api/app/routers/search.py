import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from audiowhisper_core.models import MediaFile, TranscriptSegment, TranscriptionJob, WorkspaceItem
from app.dependencies import get_db

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def search(q: str = Query(default="", max_length=200), project: str = Query(default="", max_length=128),
           speaker: str = Query(default="", max_length=128), offset: int = Query(default=0, ge=0),
           limit: int = Query(default=20, ge=1, le=50), db: Session = Depends(get_db)):
    if not q.strip():
        return {"items": [], "total": 0, "offset": offset, "limit": limit}
    conditions = [TranscriptSegment.text.icontains(q.strip(), autoescape=True)]
    if project:
        conditions.append(WorkspaceItem.project == project)
    if speaker.strip():
        names = func.json_each(WorkspaceItem.speakers_json).table_valued("key", "value")
        conditions.append(or_(TranscriptSegment.speaker_id.icontains(speaker.strip(), autoescape=True),
                              select(names.c.key).where(names.c.key == TranscriptSegment.speaker_id,
                                                         names.c.value.icontains(speaker.strip(), autoescape=True)).exists()))
    base = select(TranscriptSegment, MediaFile.original_name, WorkspaceItem).join(
        TranscriptionJob, TranscriptionJob.id == TranscriptSegment.job_id).join(MediaFile).outerjoin(
            WorkspaceItem, WorkspaceItem.job_id == TranscriptionJob.id).where(*conditions)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    rows = db.execute(base.order_by(TranscriptionJob.created_at.desc(), TranscriptSegment.segment_index, TranscriptSegment.id).offset(offset).limit(limit))
    return {"items": [{"segment_id": segment.id, "job_id": segment.job_id, "title": (workspace.title if workspace else "") or filename,
                       "project": workspace.project if workspace else "", "start": segment.start, "end": segment.end, "text": segment.text,
                       "speaker": (json.loads(workspace.speakers_json).get(segment.speaker_id) if workspace else None) or segment.speaker_id or "Falante não identificado"}
                      for segment, filename, workspace in rows], "total": total, "offset": offset, "limit": limit}
