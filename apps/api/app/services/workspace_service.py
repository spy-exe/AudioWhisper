"""Organization data (title, speakers) attached to a job, shared by several routers."""
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from audiowhisper_core.models import Bookmark, MediaFile, TranscriptionJob, TranscriptSegment, WorkspaceItem


def get_or_create_item(db: Session, job_id: str) -> WorkspaceItem:
    item = db.get(WorkspaceItem, job_id)
    if not item:
        item = WorkspaceItem(job_id=job_id)
        db.add(item)
        db.flush()
    return item


def speakers_for(db: Session, job_id: str) -> dict[str, str]:
    item = db.get(WorkspaceItem, job_id)
    return json.loads(item.speakers_json) if item else {}


def title_for(db: Session, job: TranscriptionJob) -> str:
    item = db.get(WorkspaceItem, job.id)
    if item and item.title:
        return item.title
    media = db.get(MediaFile, job.media_file_id)
    return media.original_name if media else "transcricao"


def ordered_segments(db: Session, job_id: str) -> list[TranscriptSegment]:
    return list(db.scalars(
        select(TranscriptSegment).where(TranscriptSegment.job_id == job_id).order_by(TranscriptSegment.segment_index)
    ))


def bookmarks_for(db: Session, job_id: str) -> list[Bookmark]:
    return list(db.scalars(select(Bookmark).where(Bookmark.job_id == job_id).order_by(Bookmark.start, Bookmark.created_at)))
