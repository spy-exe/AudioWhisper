import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from audiowhisper_core.config import Settings, get_settings
from audiowhisper_core.errors import NotFoundError, ValidationAppError
from audiowhisper_core.models import MediaFile, TranscriptSegment
from audiowhisper_core.schemas import (
    JobCreateIn,
    SegmentMergeIn,
    SegmentSplitIn,
    SegmentUpdateIn,
    TranscriptionJobOut,
    TranscriptionSettingsIn,
    TranscriptSegmentOut,
    TranscriptUpdateIn,
    WordOut,
)
from audiowhisper_core.stats import transcript_stats

from app.dependencies import get_db
from app.services import job_service, settings_service
from app.services.workspace_service import ordered_segments, speakers_for

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


@router.delete("/{job_id}", status_code=204)
def delete_job(job_id: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)) -> None:
    job = job_service.get_job_or_404(db, job_id)
    job_service.delete_job(db, settings, job)


@router.post("/{job_id}/retranscribe", response_model=TranscriptionJobOut, status_code=201)
def retranscribe(job_id: str, payload: TranscriptionSettingsIn, db: Session = Depends(get_db),
                 settings: Settings = Depends(get_settings)) -> TranscriptionJobOut:
    job = job_service.get_job_or_404(db, job_id)
    return TranscriptionJobOut.model_validate(job_service.retranscribe(db, settings, job, payload))


@router.get("/{job_id}/stats")
def job_stats(job_id: str, threshold: float | None = Query(default=None, ge=0.05, le=0.99),
              db: Session = Depends(get_db), settings: Settings = Depends(get_settings)) -> dict:
    job = job_service.get_job_or_404(db, job_id)
    media = db.get(MediaFile, job.media_file_id)
    if threshold is None:
        threshold = float(settings_service.get_all_settings(db, settings)["low_confidence_threshold"])
    return transcript_stats(ordered_segments(db, job_id), speakers_for(db, job_id),
                            media.duration_seconds if media else None, threshold)


@router.post("/{job_id}/segments/{segment_id}/split", response_model=list[TranscriptSegmentOut])
def split_segment(job_id: str, segment_id: str, payload: SegmentSplitIn,
                  db: Session = Depends(get_db)) -> list[TranscriptSegmentOut]:
    job = job_service.get_job_or_404(db, job_id)
    return [_segment_to_out(s) for s in job_service.split_segment(db, job, segment_id, payload.offset)]


@router.post("/{job_id}/segments/merge", response_model=list[TranscriptSegmentOut])
def merge_segments(job_id: str, payload: SegmentMergeIn, db: Session = Depends(get_db)) -> list[TranscriptSegmentOut]:
    job = job_service.get_job_or_404(db, job_id)
    return [_segment_to_out(s) for s in job_service.merge_segments(db, job, payload.segment_ids)]


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
