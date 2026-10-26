import hashlib
import io
import json
import uuid
import wave
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from audiowhisper_core.config import get_settings
from audiowhisper_core.models import LiveChunk, LiveSession, MediaFile, TranscriptionJob
from audiowhisper_core.schemas import TranscriptionSettingsIn, TranscriptionJobOut
from app.dependencies import get_db
from app.queue import get_queue

router = APIRouter(prefix="/api/live", tags=["live"])

MAX_CHUNK_BYTES = 2_000_000


class LiveIn(BaseModel):
    title: str = Field(default="Nova captura", min_length=1, max_length=500)
    source: Literal["microphone", "system", "mixed", "obs"] = "microphone"
    settings: TranscriptionSettingsIn = Field(default_factory=TranscriptionSettingsIn)
    capture_id: uuid.UUID | None = None


def previous_capture(db, job_id, fingerprint):
    job = db.get(TranscriptionJob, job_id)
    if job:
        media = db.get(MediaFile, job.media_file_id)
        if not media or json.loads(media.metadata_json or "{}").get("capture_fingerprint") != fingerprint:
            raise HTTPException(409, "Este identificador pertence a outra captura. A gravação original foi preservada.")
    return job


@router.post("", status_code=201)
def create_live(payload: LiveIn, db: Session = Depends(get_db)):
    fingerprint = hashlib.sha256(payload.model_dump_json(exclude={"capture_id"}).encode()).hexdigest()
    job_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "audiowhisper:live:" + str(payload.capture_id))) if payload.capture_id else str(uuid.uuid4())
    previous = previous_capture(db, job_id, fingerprint)
    if previous:
        return TranscriptionJobOut.model_validate(previous)
    try:
        return _create_live(payload, db, job_id, fingerprint)
    except IntegrityError:
        db.rollback()
        previous = previous_capture(db, job_id, fingerprint)
        if previous:
            return TranscriptionJobOut.model_validate(previous)
        raise HTTPException(409, "Outra tentativa está criando esta captura. Repita com o mesmo identificador.")


def _create_live(payload, db, job_id, fingerprint):
    media_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "audiowhisper:live-media:" + job_id))
    media = MediaFile(id=media_id, original_name=payload.title + ".wav", stored_name=media_id + ".wav",
                      mime_type="audio/wav", extension="wav", size_bytes=0, sha256=hashlib.sha256(media_id.encode()).hexdigest(), media_type="audio", metadata_json=json.dumps({"live": True, "source": payload.source, "capture_fingerprint": fingerprint}))
    db.add(media)
    db.flush()
    job = TranscriptionJob(id=job_id, media_file_id=media_id, status="transcribing", model_name=payload.settings.model_name,
        device=payload.settings.device, compute_type=payload.settings.compute_type, language_requested=payload.settings.language,
        settings_json=payload.settings.model_dump_json(), started_at=datetime.now(timezone.utc), current_stage="Capturando áudio ao vivo")
    db.add(job)
    db.flush()
    db.add(LiveSession(job_id=job.id, source=payload.source))
    db.commit()
    return TranscriptionJobOut.model_validate(job)


def get_live(db, job_id):
    session = db.get(LiveSession, job_id)
    if not session:
        raise HTTPException(404, "Captura não encontrada")
    return session


@router.get("/{job_id}")
def live_status(job_id: str, db: Session = Depends(get_db)):
    session = get_live(db, job_id)
    chunks = list(db.scalars(select(LiveChunk).where(LiveChunk.job_id == job_id, LiveChunk.final.is_(True)).order_by(LiveChunk.sequence)))
    return {"status": session.status, "expected_chunks": session.expected_chunks,
            "chunks": [{"sequence": c.sequence, "status": c.status, "error": c.error} for c in chunks]}


@router.post("/{job_id}/chunks/{sequence}", status_code=202)
async def ingest_chunk(job_id: str, sequence: int, file: UploadFile = File(...),
                       revision: int = Query(default=0, ge=0, le=1000), start: float = Query(ge=0, le=86400),
                       final: bool = False, db: Session = Depends(get_db)):
    if not 0 <= sequence <= 20000:
        raise HTTPException(422, "Sequência inválida")
    session = get_live(db, job_id)
    chunk_id = f"{job_id}-{sequence}-{revision}"
    data = await file.read(MAX_CHUNK_BYTES + 1)
    if len(data) > MAX_CHUNK_BYTES:
        raise HTTPException(413, f"Trecho excede o limite de {MAX_CHUNK_BYTES // 1_000_000} MB")
    try:
        with wave.open(io.BytesIO(data)) as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
                raise ValueError()
            duration = audio.getnframes() / 16000
            if not 0 < duration <= 30:
                raise ValueError()
            if len(audio.readframes(audio.getnframes())) != audio.getnframes() * 2:
                raise ValueError()
    except (wave.Error, EOFError, ValueError):
        raise HTTPException(422, "Envie WAV PCM mono 16 kHz de até 30 segundos.")
    digest = hashlib.sha256(data).hexdigest()
    chunk = db.get(LiveChunk, chunk_id)
    if chunk:
        if (chunk.sha256, chunk.start, chunk.final) != (digest, start, final):
            raise HTTPException(409, "Esta revisão já contém outro áudio. O trecho salvo foi preservado.")
        if chunk.status != "failed":
            return {"id": chunk.id, "status": chunk.status}
        chunk.status, chunk.error = "queued", None
        db.commit()
    else:
        if session.status not in ("recording", "stopping"):
            raise HTTPException(409, "Esta captura já foi encerrada.")
        existing_final = db.scalar(select(LiveChunk.id).where(LiveChunk.job_id == job_id, LiveChunk.sequence == sequence, LiveChunk.final.is_(True)))
        if existing_final:
            raise HTTPException(409, "Este trecho já tem uma versão final.")
        if session.expected_chunks is not None and sequence >= session.expected_chunks:
            raise HTTPException(409, "Trecho fora da captura encerrada.")
        directory = get_settings().uploads_dir / "live" / job_id
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{sequence}-{revision}.wav"
        path.write_bytes(data)
        chunk = LiveChunk(id=chunk_id, job_id=job_id, sequence=sequence, revision=revision, start=start, duration=duration,
                          final=final, path=str(path.relative_to(get_settings().uploads_dir)), sha256=digest)
        db.add(chunk)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "Este trecho já foi recebido. Consulte o estado da captura.")
    try:
        get_queue().enqueue("app.live_tasks.process_live_chunk", chunk.id, job_id=f"live-{chunk.id}", job_timeout=1800)
    except Exception:
        chunk.status, chunk.error = "failed", "Fila indisponível. O áudio foi preservado para nova tentativa."
        db.commit()
        raise HTTPException(503, chunk.error)
    return {"id": chunk.id, "status": chunk.status}


class StopIn(BaseModel):
    expected_chunks: int = Field(ge=0, le=20000)
    duration: float = Field(ge=0, le=86400)


@router.post("/{job_id}/stop", status_code=202)
def stop_live(job_id: str, payload: StopIn, db: Session = Depends(get_db)):
    session = get_live(db, job_id)
    if session.status == "completed":
        return {"status": "completed"}
    if session.expected_chunks is not None and session.expected_chunks != payload.expected_chunks:
        raise HTTPException(409, "O encerramento já foi solicitado com outro número de trechos.")
    if session.status == "cancelled":
        raise HTTPException(409, "Esta captura foi cancelada. O áudio recebido continua preservado.")
    session.status, session.expected_chunks, session.duration = "stopping", payload.expected_chunks, payload.duration
    db.commit()
    try:
        get_queue().enqueue("app.live_tasks.finalize_live_session", job_id, job_id=f"finalize-{job_id}", job_timeout=1800)
    except Exception:
        # The stop is recorded; the worker's recovery also finalizes "stopping" sessions on restart.
        raise HTTPException(503, "Encerramento registrado, mas a fila está indisponível. Use Recuperar captura em instantes.")
    return {"status": "stopping"}


@router.post("/{job_id}/retry", status_code=202)
def retry_live(job_id: str, db: Session = Depends(get_db)):
    get_live(db, job_id)
    chunks = list(db.scalars(select(LiveChunk).where(LiveChunk.job_id == job_id, LiveChunk.status.in_(["failed", "processing"])) ))
    try:
        for chunk in chunks:
            # A currently running RQ job is allowed to finish; don't create concurrent copies.
            rq_id = f"live-{chunk.id}"
            queued = get_queue().fetch_job(rq_id)
            if queued and queued.get_status() in ("started", "queued"):
                continue
            chunk.status, chunk.error = "queued", None
            db.commit()
            get_queue().enqueue("app.live_tasks.process_live_chunk", chunk.id, job_id=rq_id, job_timeout=1800)
        get_queue().enqueue("app.live_tasks.finalize_live_session", job_id, job_timeout=1800)
    except RedisError:
        raise HTTPException(503, "A fila está indisponível. Os trechos continuam salvos; tente recuperar novamente.")
    return {"status": "recovering", "chunks": len(chunks)}
