from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from audiowhisper_core.errors import NotFoundError, ValidationAppError
from audiowhisper_core.models import Bookmark, MediaFile, TranscriptSegment
from audiowhisper_core.schemas import BookmarkIn, BookmarkOut, BookmarkUpdateIn

from app.dependencies import get_db
from app.services.job_service import get_job_or_404
from app.services.workspace_service import bookmarks_for

router = APIRouter(tags=["bookmarks"])

MAX_BOOKMARKS_PER_JOB = 500


def _check_start(db: Session, job, start: float) -> None:
    media = db.get(MediaFile, job.media_file_id)
    if media and media.duration_seconds and start > media.duration_seconds + 1:
        raise ValidationAppError("O marcador está depois do fim da gravação.",
                                 {"start": start, "duration_seconds": media.duration_seconds})


def _get_bookmark(db: Session, bookmark_id: str) -> Bookmark:
    bookmark = db.get(Bookmark, bookmark_id)
    if bookmark is None:
        raise NotFoundError("Marcador não encontrado")
    return bookmark


@router.get("/api/jobs/{job_id}/bookmarks", response_model=list[BookmarkOut])
def list_bookmarks(job_id: str, db: Session = Depends(get_db)):
    get_job_or_404(db, job_id)
    return bookmarks_for(db, job_id)


@router.post("/api/jobs/{job_id}/bookmarks", response_model=BookmarkOut, status_code=201)
def create_bookmark(job_id: str, payload: BookmarkIn, db: Session = Depends(get_db)):
    job = get_job_or_404(db, job_id)
    _check_start(db, job, payload.start)
    if payload.segment_id is not None:
        segment = db.get(TranscriptSegment, payload.segment_id)
        if segment is None or segment.job_id != job_id:
            raise NotFoundError("O trecho escolhido não pertence a esta transcrição.")
    if len(bookmarks_for(db, job_id)) >= MAX_BOOKMARKS_PER_JOB:
        raise ValidationAppError(f"Limite de {MAX_BOOKMARKS_PER_JOB} marcadores por gravação atingido.")
    bookmark = Bookmark(job_id=job_id, **payload.model_dump())
    db.add(bookmark)
    db.commit()
    db.refresh(bookmark)
    return bookmark


@router.patch("/api/bookmarks/{bookmark_id}", response_model=BookmarkOut)
def update_bookmark(bookmark_id: str, payload: BookmarkUpdateIn, db: Session = Depends(get_db)):
    bookmark = _get_bookmark(db, bookmark_id)
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "label" in changes:
        changes["label"] = changes["label"].strip()
        if not changes["label"]:
            raise ValidationAppError("Dê um nome ao marcador")
    if "start" in changes:
        _check_start(db, get_job_or_404(db, bookmark.job_id), changes["start"])
    for key, value in changes.items():
        setattr(bookmark, key, value)
    db.commit()
    db.refresh(bookmark)
    return bookmark


@router.delete("/api/bookmarks/{bookmark_id}", status_code=204)
def delete_bookmark(bookmark_id: str, db: Session = Depends(get_db)) -> None:
    db.delete(_get_bookmark(db, bookmark_id))
    db.commit()
