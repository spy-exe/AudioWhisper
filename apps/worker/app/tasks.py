import json
import math
import time
import traceback
from datetime import datetime, timezone

import redis
from sqlalchemy import select

from audiowhisper_core.config import get_settings
from audiowhisper_core.db import get_session_factory
from audiowhisper_core.enums import ErrorCode, ExportFormat, JobStatus
from audiowhisper_core.errors import AppError
from audiowhisper_core.exports import generate_export
from audiowhisper_core.logging import configure_logging
from audiowhisper_core.models import MediaFile, TranscriptionJob, TranscriptSegment
from audiowhisper_core.progress import progress_channel
from audiowhisper_core.schemas import ProgressEvent, TranscriptSegmentOut, WordOut

from app.model_manager import ModelManager
from app.pipeline.audio_extract import extract_mono_wav

logger = configure_logging("worker", get_settings().log_level)

DEFAULT_EXPORT_FORMATS = [
    ExportFormat.TXT,
    ExportFormat.MARKDOWN,
    ExportFormat.JSON,
    ExportFormat.SRT,
    ExportFormat.VTT,
]

PROGRESS_PUBLISH_MIN_INTERVAL = 0.5  # seconds, avoid flooding redis/websocket on fast segments

_model_manager: ModelManager | None = None


def get_model_manager(settings) -> ModelManager:
    """A process-wide singleton. Only valid because the worker runs as an RQ SimpleWorker
    (no per-job fork) — see worker_main.py — so the loaded model and CUDA context survive
    across jobs instead of being torn down and reloaded every time."""
    global _model_manager
    if _model_manager is None:
        _model_manager = ModelManager(settings)
    return _model_manager


class JobCancelled(Exception):
    pass


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _cancel_requested(db, job_id: str) -> bool:
    """A fresh, non-identity-mapped scalar read so we see cancellation requests committed
    by the API process (a different SQLAlchemy Session/connection), not a stale cached copy."""
    value = db.execute(
        select(TranscriptionJob.cancel_requested).where(TranscriptionJob.id == job_id)
    ).scalar_one_or_none()
    db.commit()
    return bool(value)


def process_transcription_job(job_id: str) -> None:
    settings = get_settings()
    db = get_session_factory()()
    redis_conn = redis.from_url(settings.redis_url)
    tmp_wav_path = settings.tmp_dir / f"{job_id}.wav"

    def publish(status: JobStatus, progress: float, stage: str, **extra) -> None:
        event = ProgressEvent(
            job_id=job_id, status=status, progress=progress, current_stage=stage, ts=time.time(), **extra
        )
        try:
            redis_conn.publish(progress_channel(settings, job_id), event.model_dump_json())
        except redis.RedisError as exc:
            logger.warning("progress_publish_failed", extra={"job_id": job_id, "error": str(exc)})

    def set_job(**fields) -> TranscriptionJob:
        job = db.get(TranscriptionJob, job_id)
        for key, value in fields.items():
            setattr(job, key, value)
        db.commit()
        db.refresh(job)
        return job

    try:
        job = db.get(TranscriptionJob, job_id)
        if job is None:
            logger.error("job_not_found", extra={"job_id": job_id})
            return
        media = db.get(MediaFile, job.media_file_id)
        job_settings = json.loads(job.settings_json) if job.settings_json else {}

        if _cancel_requested(db, job_id):
            set_job(status=JobStatus.CANCELLED, current_stage="Cancelado antes de iniciar")
            publish(JobStatus.CANCELLED, 0.0, "Cancelado antes de iniciar")
            return

        set_job(status=JobStatus.PREPARING, started_at=_utcnow(), current_stage="Preparando")
        publish(JobStatus.PREPARING, 0.0, "Preparando")

        media_path = settings.uploads_dir / media.stored_name

        set_job(status=JobStatus.EXTRACTING_AUDIO, current_stage="Extraindo áudio")
        publish(JobStatus.EXTRACTING_AUDIO, 0.02, "Extraindo áudio")
        extract_mono_wav(media_path, tmp_wav_path)

        if _cancel_requested(db, job_id):
            raise JobCancelled

        set_job(status=JobStatus.LOADING_MODEL, current_stage="Carregando modelo")
        publish(JobStatus.LOADING_MODEL, 0.05, "Carregando modelo")

        manager = get_model_manager(settings)
        loaded = manager.get_model(job.model_name, job.device, job.compute_type, job_id)
        job = set_job(model_name=loaded.model_name, device=loaded.device, compute_type=loaded.compute_type)

        if _cancel_requested(db, job_id):
            set_job(status=JobStatus.CANCELLED, current_stage="Cancelado")
            publish(JobStatus.CANCELLED, job.progress, "Cancelado")
            return

        set_job(status=JobStatus.TRANSCRIBING, current_stage="Transcrevendo")

        duration = media.duration_seconds or 0.0
        segments_gen, info = loaded.model.transcribe(
            str(tmp_wav_path),
            language=job_settings.get("language") or None,
            task="translate" if job_settings.get("translate_to_english") else "transcribe",
            beam_size=job_settings.get("beam_size", 5),
            vad_filter=job_settings.get("vad_enabled", True),
            word_timestamps=job_settings.get("word_timestamps", True),
            temperature=job_settings.get("temperature", 0.0),
        )
        set_job(language_detected=info.language)

        t_start = time.monotonic()
        last_publish = 0.0
        segment_index = 0
        pending_segments = []

        for seg in segments_gen:
            if _cancel_requested(db, job_id):
                raise JobCancelled

            words_json = None
            if seg.words:
                words_json = json.dumps(
                    [
                        {"word": w.word, "start": w.start, "end": w.end, "probability": w.probability}
                        for w in seg.words
                    ]
                )
            confidence = math.exp(seg.avg_logprob) if seg.avg_logprob is not None else None

            row = TranscriptSegment(
                job_id=job_id,
                segment_index=segment_index,
                start=seg.start,
                end=seg.end,
                text=seg.text.strip(),
                confidence=confidence,
                words_json=words_json,
            )
            db.add(row)

            progress = min(0.95, 0.1 + 0.85 * (seg.end / duration)) if duration > 0 else 0.5
            stage = f"Transcrevendo — {seg.end:.0f}s / {duration:.0f}s"
            job = db.get(TranscriptionJob, job_id)
            job.progress = progress
            job.current_stage = stage
            db.commit()
            db.refresh(row)
            segment_index += 1

            pending_segments.append(TranscriptSegmentOut(
                    id=row.id,
                    job_id=job_id,
                    segment_index=row.segment_index,
                    start=row.start,
                    end=row.end,
                    text=row.text,
                    confidence=row.confidence,
                    words=[WordOut(**w) for w in json.loads(words_json)] if words_json else None,
                    edited=False,
                    updated_at=row.updated_at,
                ))
            now = time.monotonic()
            if now - last_publish > PROGRESS_PUBLISH_MIN_INTERVAL:
                publish(
                    JobStatus.TRANSCRIBING,
                    progress,
                    stage,
                    language_detected=info.language,
                    new_segments=pending_segments,
                )
                pending_segments = []
                last_publish = now

        if _cancel_requested(db, job_id):
            raise JobCancelled

        processing_seconds = time.monotonic() - t_start
        real_time_factor = processing_seconds / duration if duration > 0 else None

        set_job(status=JobStatus.GENERATING_EXPORTS, current_stage="Gerando exports", progress=0.97)
        publish(JobStatus.GENERATING_EXPORTS, 0.97, "Gerando exports", new_segments=pending_segments)

        job = db.get(TranscriptionJob, job_id)
        stmt = (
            select(TranscriptSegment)
            .where(TranscriptSegment.job_id == job_id)
            .order_by(TranscriptSegment.segment_index)
        )
        all_segments = list(db.execute(stmt).scalars().all())
        for fmt in DEFAULT_EXPORT_FORMATS:
            generate_export(db, settings, job, media, all_segments, fmt)

        if _cancel_requested(db, job_id):
            raise JobCancelled

        set_job(
            status=JobStatus.COMPLETED,
            progress=1.0,
            current_stage="Concluído",
            completed_at=_utcnow(),
            processing_seconds=processing_seconds,
            real_time_factor=real_time_factor,
        )
        publish(JobStatus.COMPLETED, 1.0, "Concluído", language_detected=info.language)
        logger.info(
            "job_completed",
            extra={"job_id": job_id, "stage": "completed", "duration_ms": round(processing_seconds * 1000)},
        )

    except JobCancelled:
        job = set_job(status=JobStatus.CANCELLED, current_stage="Cancelado")
        publish(JobStatus.CANCELLED, job.progress, "Cancelado")
        logger.info("job_cancelled", extra={"job_id": job_id, "stage": "cancelled"})

    except AppError as exc:
        set_job(
            status=JobStatus.FAILED,
            failed_at=_utcnow(),
            error_code=exc.code.value,
            error_message=exc.message,
            current_stage="Falhou",
        )
        publish(JobStatus.FAILED, 0.0, "Falhou", error_code=exc.code.value, error_message=exc.message)
        logger.error("job_failed", extra={"job_id": job_id, "stage": "failed", "error": exc.message})

    except Exception as exc:  # noqa: BLE001 — last-resort guard so a job always reaches a terminal state
        logger.error("job_failed_unexpected", extra={"job_id": job_id, "stage": "failed", "error": str(exc)})
        logger.error(traceback.format_exc())
        set_job(
            status=JobStatus.FAILED,
            failed_at=_utcnow(),
            error_code=ErrorCode.INTERNAL_ERROR.value,
            error_message="Erro interno inesperado durante a transcrição",
            current_stage="Falhou",
        )
        publish(
            JobStatus.FAILED,
            0.0,
            "Falhou",
            error_code=ErrorCode.INTERNAL_ERROR.value,
            error_message="Erro interno inesperado durante a transcrição",
        )

    finally:
        tmp_wav_path.unlink(missing_ok=True)
        db.close()
        redis_conn.close()
