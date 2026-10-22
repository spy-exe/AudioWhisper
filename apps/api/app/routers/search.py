import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from audiowhisper_core.errors import ValidationAppError
from audiowhisper_core.models import MediaFile, TranscriptionJob, TranscriptSegment, WorkspaceItem
from audiowhisper_core.text import fold_text, snippet
from app.dependencies import get_db
from app.routers.library import folded_like

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def search_segments(q: str = Query(min_length=1, max_length=200), offset: int = Query(default=0, ge=0, le=5000),
                    limit: int = Query(default=20, ge=1, le=50), db: Session = Depends(get_db)):
    """Every moment where a term was said, across the whole library, accents and case ignored."""
    term = q.strip()
    if len(fold_text(term)) < 2:
        raise ValidationAppError("Digite pelo menos dois caracteres para buscar.")
    condition = (TranscriptionJob.status == "completed", folded_like(TranscriptSegment.text, term))
    base = select(TranscriptSegment, TranscriptionJob, MediaFile, WorkspaceItem) \
        .join(TranscriptionJob, TranscriptionJob.id == TranscriptSegment.job_id) \
        .join(MediaFile, MediaFile.id == TranscriptionJob.media_file_id) \
        .outerjoin(WorkspaceItem, WorkspaceItem.job_id == TranscriptionJob.id).where(*condition)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.execute(base.order_by(TranscriptionJob.created_at.desc(), TranscriptSegment.segment_index)
                      .offset(offset).limit(limit)).all()
    hits = []
    for segment, job, media, item in rows:
        speakers = json.loads(item.speakers_json) if item else {}
        hits.append({
            "job_id": job.id, "segment_id": segment.id, "start": segment.start, "end": segment.end,
            "title": (item.title if item and item.title else media.original_name),
            "speaker": speakers.get(segment.speaker_id, segment.speaker_id) if segment.speaker_id else None,
            "snippet": snippet(segment.text, term) or {"before": "", "match": segment.text, "after": ""},
            "job_created_at": job.created_at,
        })
    return {"query": term, "total": total, "offset": offset, "limit": limit, "hits": hits}
