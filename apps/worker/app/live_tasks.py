import hashlib
import json
import math
import time
import uuid
import wave
from datetime import datetime, timezone

import redis
from sqlalchemy import select
from audiowhisper_core.config import get_settings
from audiowhisper_core.db import session_scope
from audiowhisper_core.enums import ExportFormat
from audiowhisper_core.exports import generate_export
from audiowhisper_core.models import LiveChunk, LiveSession, MediaFile, TranscriptionJob, TranscriptSegment
from audiowhisper_core.progress import progress_channel
from audiowhisper_core.schemas import TranscriptSegmentOut
from app.tasks import get_model_manager, transcribe_options


def provisional_segments(db, job_id):
    chunks = list(db.scalars(select(LiveChunk).where(LiveChunk.job_id == job_id).order_by(LiveChunk.sequence, LiveChunk.revision)))
    latest, finished = {}, set()
    for chunk in chunks:
        if chunk.final and chunk.status == "completed":
            finished.add(chunk.sequence)
        elif not chunk.final and chunk.status == "completed":
            latest[chunk.sequence] = json.loads(chunk.result_json)
    return [segment for sequence, segments in latest.items() if sequence not in finished for segment in segments]


def notify(db, job, segments=None):
    settings = get_settings()
    connection = redis.from_url(settings.redis_url)
    try:
        connection.publish(progress_channel(settings, job.id), json.dumps({"job_id": job.id, "status": job.status,
            "progress": job.progress, "current_stage": job.current_stage, "ts": time.time(),
            "new_segments": segments or [], "provisional_segments": provisional_segments(db, job.id)}))
    except redis.RedisError:
        pass  # Saved state remains recoverable over HTTP and WebSocket snapshots.
    finally:
        connection.close()


def process_live_chunk(chunk_id):
    settings = get_settings()
    with session_scope() as db:
        chunk = db.get(LiveChunk, chunk_id)
        if not chunk or chunk.status in ("completed", "superseded"):
            return
        job = db.get(TranscriptionJob, chunk.job_id)
        if job.cancel_requested:
            return
        newer = db.scalar(select(LiveChunk.id).where(LiveChunk.job_id == chunk.job_id, LiveChunk.sequence == chunk.sequence, LiveChunk.revision > chunk.revision))
        if newer and not chunk.final:
            chunk.status = "superseded"
            db.commit()
            return
        try:
            chunk.status = "processing"
            db.commit()
            options = json.loads(job.settings_json)
            loaded = get_model_manager(settings).get_model(job.model_name, job.device, job.compute_type, job.id)
            segments, info = loaded.model.transcribe(str(settings.uploads_dir / chunk.path),
                word_timestamps=True, **transcribe_options(options))
            result = []
            for i, segment in enumerate(segments):
                words = [{"word": w.word, "start": w.start + chunk.start, "end": w.end + chunk.start, "probability": w.probability} for w in (segment.words or [])]
                segment_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"audiowhisper:{job.id}:{chunk.sequence}:{i}"))
                fields = {"id": segment_id, "job_id": job.id, "segment_index": chunk.sequence * 1000 + i,
                          "start": segment.start + chunk.start, "end": segment.end + chunk.start, "text": segment.text.strip(),
                          "confidence": math.exp(segment.avg_logprob) if segment.avg_logprob is not None else None,
                          "words": words, "edited": False, "speaker_id": None, "updated_at": datetime.now(timezone.utc).isoformat()}
                if chunk.final:
                    row = db.get(TranscriptSegment, segment_id)
                    if not row:
                        row = TranscriptSegment(**{k: v for k, v in fields.items() if k not in ("words", "updated_at")}, words_json=json.dumps(words))
                        db.add(row)
                result.append(fields)
            job.language_detected = info.language
            job.model_name, job.device, job.compute_type = loaded.model_name, loaded.device, loaded.compute_type
            job.current_stage = "Capturando áudio ao vivo" if db.get(LiveSession, job.id).status == "recording" else "Consolidando gravação"
            chunk.result_json, chunk.status, chunk.error = json.dumps(result), "completed", None
            db.commit()
            notify(db, job, result if chunk.final else [])
        except Exception:
            db.rollback()
            chunk = db.get(LiveChunk, chunk_id)
            chunk.status, chunk.error = "failed", "Falha ao transcrever o trecho. O áudio foi salvo; tente recuperar a captura."
            db.commit()
            return
    finalize_live_session(chunk.job_id)


def finalize_live_session(job_id):
    settings = get_settings()
    with session_scope() as db:
        session = db.get(LiveSession, job_id)
        if not session or session.status != "stopping" or session.expected_chunks is None:
            return
        chunks = list(db.scalars(select(LiveChunk).where(LiveChunk.job_id == job_id, LiveChunk.final.is_(True)).order_by(LiveChunk.sequence)))
        job = db.get(TranscriptionJob, job_id)
        if {c.sequence for c in chunks if c.status == "completed"} != set(range(session.expected_chunks)):
            job.current_stage = "Aguardando recuperação dos trechos pendentes"
            db.commit()
            notify(db, job)
            return
        media = db.get(MediaFile, job.media_file_id)
        path = settings.uploads_dir / media.stored_name
        temporary = path.with_suffix(".partial.wav")
        with wave.open(str(temporary), "wb") as target:
            target.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            cursor = 0
            def silence(frames):
                while frames > 0:
                    count = min(frames, 16000)
                    target.writeframesraw(b"\0" * (count * 2))
                    frames -= count
            for chunk in chunks:
                start_frame = round(chunk.start * 16000)
                if start_frame > cursor:
                    silence(start_frame - cursor)
                    cursor = start_frame
                with wave.open(str(settings.uploads_dir / chunk.path)) as source:
                    overlap = max(0, cursor - start_frame)
                    source.setpos(min(overlap, source.getnframes()))
                    data = source.readframes(source.getnframes())
                    target.writeframesraw(data)
                    cursor += len(data) // 2
            if round(session.duration * 16000) > cursor:
                silence(round(session.duration * 16000) - cursor)
                cursor = round(session.duration * 16000)
        temporary.replace(path)
        digest = hashlib.sha256()
        with path.open("rb") as source:
            while data := source.read(1024 * 1024):
                digest.update(data)
        media.sha256, media.size_bytes, media.duration_seconds = digest.hexdigest(), path.stat().st_size, cursor / 16000
        job.status, job.progress, job.current_stage = "completed", 1, "Captura concluída"
        job.completed_at = datetime.now(timezone.utc)
        session.status = "completed"
        db.commit()
        segments = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.job_id == job_id).order_by(TranscriptSegment.segment_index)))
        for fmt in (ExportFormat.TXT, ExportFormat.MARKDOWN, ExportFormat.JSON, ExportFormat.SRT, ExportFormat.VTT):
            generate_export(db, settings, job, media, segments, fmt)
        notify(db, job)
        from app.workspace_tasks import schedule_recipes
        schedule_recipes(job_id)
