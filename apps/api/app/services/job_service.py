import json

from redis.exceptions import RedisError
from rq.exceptions import InvalidJobOperation, NoSuchJobError
from rq.job import Job as RqJob
from sqlalchemy import select
from sqlalchemy.orm import Session

from audiowhisper_core.enums import ErrorCode, JobStatus, TERMINAL_STATUSES
from audiowhisper_core.errors import AppError, NotFoundError, ValidationAppError
from audiowhisper_core.models import MediaFile, TranscriptionJob, TranscriptSegment, LiveSession
from audiowhisper_core.schemas import JobCreateIn

from app.queue import enqueue_transcription, get_redis_connection


def get_job_or_404(db: Session, job_id: str) -> TranscriptionJob:
    job = db.get(TranscriptionJob, job_id)
    if job is None:
        raise NotFoundError(f"Job '{job_id}' não encontrado")
    return job


def create_job(db: Session, payload: JobCreateIn) -> TranscriptionJob:
    media = db.get(MediaFile, payload.media_file_id)
    if media is None:
        raise NotFoundError(f"Arquivo de mídia '{payload.media_file_id}' não encontrado")

    settings_in = payload.settings
    job = TranscriptionJob(
        media_file_id=media.id,
        status=JobStatus.QUEUED,
        progress=0.0,
        current_stage="Na fila",
        model_name=settings_in.model_name,
        language_requested=settings_in.language,
        compute_type=settings_in.compute_type,
        device=settings_in.device,
        settings_json=json.dumps(settings_in.model_dump()),
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    enqueue_transcription(job.id)
    return job


def list_jobs(db: Session, limit: int = 100) -> list[TranscriptionJob]:
    stmt = select(TranscriptionJob).order_by(TranscriptionJob.created_at.desc()).limit(limit)
    return list(db.execute(stmt).scalars().all())


def cancel_job(db: Session, job: TranscriptionJob) -> TranscriptionJob:
    if job.status in TERMINAL_STATUSES:
        raise ValidationAppError(f"Job já está em estado terminal: {job.status}")

    job.cancel_requested = True
    live = db.get(LiveSession, job.id)
    if live:
        live.status = "cancelled"
        job.status, job.current_stage = JobStatus.CANCELLED, "Captura cancelada; áudio recebido preservado"
    db.commit()

    try:
        conn = get_redis_connection()
        rq_job = RqJob.fetch(job.id, connection=conn)
        if rq_job.get_status(refresh=True) == "queued":
            rq_job.cancel()
            job.status = JobStatus.CANCELLED
            job.current_stage = "Cancelado antes de iniciar"
            db.commit()
        # Running jobs use the durable cancellation flag. SimpleWorker has no separate
        # work-horse process: a stop signal can kill an active ffmpeg subprocess instead.
    except (NoSuchJobError, InvalidJobOperation, RedisError):
        pass

    db.refresh(job)
    return job


def retry_job(db: Session, job: TranscriptionJob) -> TranscriptionJob:
    if job.status not in (JobStatus.FAILED, JobStatus.CANCELLED):
        raise ValidationAppError(
            "Somente jobs com falha ou cancelados podem ser reprocessados",
            {"current_status": job.status},
        )

    db.query(TranscriptSegment).filter(TranscriptSegment.job_id == job.id).delete()

    job.status = JobStatus.QUEUED
    job.progress = 0.0
    job.current_stage = "Na fila"
    job.error_code = None
    job.error_message = None
    job.started_at = None
    job.completed_at = None
    job.failed_at = None
    job.processing_seconds = None
    job.real_time_factor = None
    job.language_detected = None
    job.cancel_requested = False
    db.commit()
    db.refresh(job)

    enqueue_transcription(job.id)
    return job
