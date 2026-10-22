import json
import shutil
import uuid
from datetime import datetime, timezone

from redis.exceptions import RedisError
from rq.exceptions import InvalidJobOperation, NoSuchJobError
from rq.job import Job as RqJob
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from audiowhisper_core.config import Settings
from audiowhisper_core.enums import ErrorCode, JobStatus, TERMINAL_STATUSES
from audiowhisper_core.errors import AppError, ConflictError, NotFoundError, QueueUnavailableError, ValidationAppError
from audiowhisper_core.models import Bookmark, MediaFile, TranscriptionJob, TranscriptSegment, LiveSession, WorkspaceItem
from audiowhisper_core.schemas import JobCreateIn, TranscriptionSettingsIn

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

    _enqueue_or_fail(db, job)
    return job


def _enqueue_or_fail(db: Session, job: TranscriptionJob) -> None:
    """A job that never reached the queue must not sit in "queued" forever: it is marked failed,
    so the interface offers a retry instead of an endless wait."""
    try:
        enqueue_transcription(job.id)
    except RedisError as exc:
        job.status, job.current_stage = JobStatus.FAILED, "Falhou"
        job.error_code = ErrorCode.QUEUE_UNAVAILABLE.value
        job.error_message = "A fila de processamento estava indisponível. Tente novamente."
        job.failed_at = datetime.now(timezone.utc)
        db.commit()
        raise QueueUnavailableError(details={"job_id": job.id}) from exc


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

    _enqueue_or_fail(db, job)
    return job


def retranscribe(db: Session, settings: Settings, job: TranscriptionJob, settings_in: TranscriptionSettingsIn) -> TranscriptionJob:
    """A new logical run over the same media; the original transcript, edits and documents stay."""
    media = db.get(MediaFile, job.media_file_id)
    if media is None or media.size_bytes == 0 or not (settings.uploads_dir / media.stored_name).is_file():
        raise ConflictError("O arquivo original não está disponível para uma nova transcrição.")
    new_job = create_job(db, JobCreateIn(media_file_id=media.id, settings=settings_in))
    source = db.get(WorkspaceItem, job.id)
    if source:
        db.add(WorkspaceItem(job_id=new_job.id, title=source.title, folder=source.folder,
                             project=source.project, tags_json=source.tags_json))
        db.commit()
    return new_job


def delete_job(db: Session, settings: Settings, job: TranscriptionJob) -> None:
    if job.status not in TERMINAL_STATUSES:
        raise ConflictError("Cancele o processamento antes de excluir esta gravação.")
    media = db.get(MediaFile, job.media_file_id)
    job_id = job.id
    db.delete(job)
    db.flush()
    remove_media = media is not None and not db.scalar(
        select(func.count()).select_from(TranscriptionJob).where(TranscriptionJob.media_file_id == media.id))
    media_path = settings.uploads_dir / media.stored_name if remove_media else None
    if remove_media:
        db.delete(media)
    db.commit()
    # Files go after the commit: a failed unlink leaves an orphan file, never a dangling row.
    for directory, root in ((settings.exports_dir / job_id, settings.exports_dir),
                            (settings.uploads_dir / "live" / job_id, settings.uploads_dir / "live")):
        if directory.resolve().parent == root.resolve() and directory.is_dir():
            shutil.rmtree(directory, ignore_errors=True)
    if media_path is not None and media_path.resolve().parent == settings.uploads_dir.resolve():
        media_path.unlink(missing_ok=True)


def _require_editable(job: TranscriptionJob) -> None:
    if job.status != JobStatus.COMPLETED:
        raise ConflictError("Conclua a transcrição antes de reorganizar os segmentos.")


def _renumber(db: Session, job_id: str, ordered: list[TranscriptSegment]) -> list[TranscriptSegment]:
    for index, segment in enumerate(ordered):
        segment.segment_index = index
    db.commit()
    return list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.job_id == job_id)
                           .order_by(TranscriptSegment.segment_index)))


def split_segment(db: Session, job: TranscriptionJob, segment_id: str, offset: int) -> list[TranscriptSegment]:
    _require_editable(job)
    ordered = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.job_id == job.id)
                              .order_by(TranscriptSegment.segment_index)))
    segment = next((s for s in ordered if s.id == segment_id), None)
    if segment is None:
        raise NotFoundError(f"Segmento '{segment_id}' não encontrado no job '{job.id}'")
    left_text, right_text = segment.text[:offset].rstrip(), segment.text[offset:].lstrip()
    if offset >= len(segment.text) or not left_text or not right_text:
        raise ValidationAppError("Escolha uma posição com texto antes e depois da divisão.", {"offset": offset})

    words = json.loads(segment.words_json) if segment.words_json else []
    count = len(left_text.split())
    if words and 0 < count < len(words):
        left_words, right_words = words[:count], words[count:]
        split_at = right_words[0]["start"]
    else:
        left_words, right_words = words, []
        split_at = segment.start + (segment.end - segment.start) * len(left_text) / max(1, len(left_text) + len(right_text))
    split_at = min(max(split_at, segment.start), segment.end)

    new_segment = TranscriptSegment(
        id=str(uuid.uuid4()), job_id=job.id, segment_index=segment.segment_index, start=split_at, end=segment.end,
        text=right_text, confidence=segment.confidence, speaker_id=segment.speaker_id, edited=True,
        words_json=json.dumps(right_words) if right_words else None,
    )
    segment.text, segment.end, segment.edited = left_text, split_at, True
    segment.words_json = json.dumps(left_words) if left_words else None
    db.add(new_segment)
    db.flush()
    for bookmark in db.scalars(select(Bookmark).where(Bookmark.segment_id == segment.id, Bookmark.start >= split_at)):
        bookmark.segment_id = new_segment.id
    position = ordered.index(segment)
    return _renumber(db, job.id, ordered[: position + 1] + [new_segment] + ordered[position + 1:])


def merge_segments(db: Session, job: TranscriptionJob, segment_ids: list[str]) -> list[TranscriptSegment]:
    _require_editable(job)
    ordered = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.job_id == job.id)
                              .order_by(TranscriptSegment.segment_index)))
    positions = {s.id: index for index, s in enumerate(ordered)}
    unique_ids = list(dict.fromkeys(segment_ids))
    if any(segment_id not in positions for segment_id in unique_ids):
        raise NotFoundError("Um dos segmentos não pertence a esta transcrição.")
    indexes = sorted(positions[segment_id] for segment_id in unique_ids)
    if len(indexes) < 2 or indexes != list(range(indexes[0], indexes[-1] + 1)):
        raise ValidationAppError("Selecione dois ou mais segmentos consecutivos para juntar.")
    group = ordered[indexes[0]: indexes[-1] + 1]
    keep, removed = group[0], group[1:]
    weighted = [(s.confidence, max(0.0, s.end - s.start)) for s in group if s.confidence is not None]
    total = sum(weight for _, weight in weighted)
    words = [w for s in group for w in (json.loads(s.words_json) if s.words_json else [])]
    keep.text = " ".join(s.text.strip() for s in group if s.text.strip())
    keep.start, keep.end = min(s.start for s in group), max(s.end for s in group)
    keep.confidence = (sum(c * w for c, w in weighted) / total if total else weighted[0][0]) if weighted else None
    keep.words_json = json.dumps(sorted(words, key=lambda w: w["start"])) if words else None
    keep.speaker_id = keep.speaker_id or next((s.speaker_id for s in removed if s.speaker_id), None)
    keep.edited = True
    removed_ids = [s.id for s in removed]
    for bookmark in db.scalars(select(Bookmark).where(Bookmark.segment_id.in_(removed_ids))):
        bookmark.segment_id = keep.id
    for segment in removed:
        db.delete(segment)
    db.flush()
    return _renumber(db, job.id, [s for s in ordered if s.id not in removed_ids])
