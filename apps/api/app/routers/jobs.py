import json

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from audiowhisper_core.errors import NotFoundError, ValidationAppError
from audiowhisper_core.models import TranscriptSegment
from audiowhisper_core.schemas import (
    JobCreateIn,
    SegmentUpdateIn,
    TranscriptionJobOut,
    TranscriptSegmentOut,
    TranscriptUpdateIn,
    WordOut,
)

from app.dependencies import get_db
from app.services import job_service

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _segment_to_out(segment: TranscriptSegment) -> TranscriptSegmentOut:
    words = None
    if segment.words_json:
        words = [WordOut(**w) for w in json.loads(segment.words_json)]
    out = TranscriptSegmentOut.model_validate(segment)
    out.words = words
    return out


@router.post("", response_model=TranscriptionJobOut)
def create_job(payload: JobCreateIn, db: Session = Depends(get_db)) -> TranscriptionJobOut:
    job = job_service.create_job(db, payload)
    return TranscriptionJobOut.model_validate(job)


@router.get("", response_model=list[TranscriptionJobOut])
def list_jobs(db: Session = Depends(get_db)) -> list[TranscriptionJobOut]:
    jobs = job_service.list_jobs(db)
    return [TranscriptionJobOut.model_validate(j) for j in jobs]


@router.get("/{job_id}", response_model=TranscriptionJobOut)
def get_job(job_id: str, db: Session = Depends(get_db)) -> TranscriptionJobOut:
    job = job_service.get_job_or_404(db, job_id)
    return TranscriptionJobOut.model_validate(job)


@router.post("/{job_id}/cancel", response_model=TranscriptionJobOut)
def cancel_job(job_id: str, db: Session = Depends(get_db)) -> TranscriptionJobOut:
    job = job_service.get_job_or_404(db, job_id)
    job = job_service.cancel_job(db, job)
    return TranscriptionJobOut.model_validate(job)


@router.post("/{job_id}/retry", response_model=TranscriptionJobOut)
def retry_job(job_id: str, db: Session = Depends(get_db)) -> TranscriptionJobOut:
    job = job_service.get_job_or_404(db, job_id)
    job = job_service.retry_job(db, job)
    return TranscriptionJobOut.model_validate(job)


@router.get("/{job_id}/segments", response_model=list[TranscriptSegmentOut])
def get_segments(job_id: str, db: Session = Depends(get_db)) -> list[TranscriptSegmentOut]:
    job_service.get_job_or_404(db, job_id)
    stmt = (
        select(TranscriptSegment)
        .where(TranscriptSegment.job_id == job_id)
        .order_by(TranscriptSegment.segment_index)
    )
    segments = db.execute(stmt).scalars().all()
    return [_segment_to_out(s) for s in segments]


@router.patch("/{job_id}/segments/{segment_id}", response_model=TranscriptSegmentOut)
def update_segment(
    job_id: str, segment_id: str, payload: SegmentUpdateIn, db: Session = Depends(get_db)
) -> TranscriptSegmentOut:
    job_service.get_job_or_404(db, job_id)
    segment = db.get(TranscriptSegment, segment_id)
    if segment is None or segment.job_id != job_id:
        raise NotFoundError(f"Segmento '{segment_id}' não encontrado no job '{job_id}'")

    segment.text = payload.text
    if "speaker_id" in payload.model_fields_set:
        segment.speaker_id = payload.speaker_id
    if payload.start is not None:
        segment.start = payload.start
    if payload.end is not None:
        segment.end = payload.end
    segment.edited = True
    db.commit()
    db.refresh(segment)
    return _segment_to_out(segment)


@router.put("/{job_id}/transcript", response_model=list[TranscriptSegmentOut])
def replace_transcript(
    job_id: str, payload: TranscriptUpdateIn, db: Session = Depends(get_db)
) -> list[TranscriptSegmentOut]:
    job_service.get_job_or_404(db, job_id)
    stmt = (
        select(TranscriptSegment)
        .where(TranscriptSegment.job_id == job_id)
        .order_by(TranscriptSegment.segment_index)
    )
    segments = db.execute(stmt).scalars().all()
    if len(segments) != len(payload.segments):
        raise ValidationAppError(
            "Número de segmentos enviado não corresponde ao transcript atual",
            {"expected": len(segments), "received": len(payload.segments)},
        )

    for segment, update in zip(segments, payload.segments, strict=True):
        segment.text = update.text
        if update.start is not None:
            segment.start = update.start
        if update.end is not None:
            segment.end = update.end
        segment.edited = True

    db.commit()
    return [_segment_to_out(s) for s in segments]
