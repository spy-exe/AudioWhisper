import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from audiowhisper_core.errors import ValidationAppError
from audiowhisper_core.models import MediaFile, TranscriptSegment, TranscriptionJob, WorkspaceItem
from audiowhisper_core.text import fold_text, snippet
from audiowhisper_core.workspace import indexed_matches
from app.dependencies import get_db
from app.routers.library import folded_like

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def search(q: str | None = Query(default=None, max_length=200), project: str = Query(default="", max_length=128),
           speaker: str = Query(default="", max_length=128), offset: int = Query(default=0, ge=0, le=5000),
           limit: int = Query(default=20, ge=1, le=50), db: Session = Depends(get_db)):
    # Explicit empty queries support the workspace's initial state; omitted/invalid terms are errors.
    if q == "":
        return {"query": "", "items": [], "hits": [], "total": 0, "offset": offset, "limit": limit}
    if q is None or len(fold_text(q.strip())) < 2:
        raise ValidationAppError("Digite pelo menos dois caracteres para buscar.")
    term = q.strip()
    matches = indexed_matches(term)
    literal = folded_like(TranscriptSegment.text, term)
    text_match = or_(TranscriptSegment.id.in_(select(matches.c.segment_id)), literal) if matches is not None else literal
    conditions = [TranscriptionJob.status == "completed", text_match]
    if any(char in term for char in "%_"):
        conditions.append(literal)
    if project:
        conditions.append(WorkspaceItem.project == project)
    if speaker.strip():
        names = func.json_each(WorkspaceItem.speakers_json).table_valued("key", "value")
        conditions.append(or_(TranscriptSegment.speaker_id.icontains(speaker.strip(), autoescape=True),
                              select(names.c.key).where(names.c.key == TranscriptSegment.speaker_id,
                                                         names.c.value.icontains(speaker.strip(), autoescape=True)).exists()))
    base = select(TranscriptSegment, TranscriptionJob, MediaFile, WorkspaceItem).join(
        TranscriptionJob, TranscriptionJob.id == TranscriptSegment.job_id).join(
        MediaFile, MediaFile.id == TranscriptionJob.media_file_id).outerjoin(
        WorkspaceItem, WorkspaceItem.job_id == TranscriptionJob.id).where(*conditions)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.execute(base.order_by(TranscriptionJob.created_at.desc(), TranscriptSegment.segment_index,
                                    TranscriptSegment.id).offset(offset).limit(limit)).all()
    items, hits = [], []
    for segment, job, media, workspace in rows:
        names = json.loads(workspace.speakers_json) if workspace else {}
        name = names.get(segment.speaker_id, segment.speaker_id) if segment.speaker_id else None
        title = (workspace.title if workspace else "") or media.original_name
        common = {"segment_id": segment.id, "job_id": job.id, "title": title, "start": segment.start, "end": segment.end}
        context = snippet(segment.text, term) or {"before": "", "match": segment.text, "after": ""}
        items.append({**common, "project": workspace.project if workspace else "", "text": segment.text,
                      "speaker": name or "Falante não identificado", "snippet": context})
        hits.append({**common, "speaker": name, "snippet": context, "job_created_at": job.created_at})
    # Both clients use the same page and source IDs; snippets augment the complete literal text.
    return {"query": term, "items": items, "hits": hits, "total": total, "offset": offset, "limit": limit}
