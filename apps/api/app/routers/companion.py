"""The native companion uses the same durable live pipeline as the Studio."""
import hashlib
import os
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from audiowhisper_core.config import Settings, get_settings
from audiowhisper_core.models import TranscriptSegment
from audiowhisper_core.schemas import TranscriptSegmentOut
from app.dependencies import get_db
from app.services.job_service import get_job_or_404
from app.services.settings_service import get_all_settings

router = APIRouter(prefix="/api/companion", tags=["companion"])


def installation_id(settings: Settings) -> str:
    path = settings.db_path.with_suffix(".instance-id")
    if not path.exists():
        temporary = path.with_name(path.name + "." + uuid.uuid4().hex)
        try:
            with open(temporary, "x", encoding="ascii") as target:
                os.chmod(temporary, 0o600)
                target.write(str(uuid.uuid4()))
                target.flush()
                os.fsync(target.fileno())
            try:
                os.link(temporary, path)
            except FileExistsError:
                pass
        finally:
            temporary.unlink(missing_ok=True)
    return str(uuid.UUID(path.read_text(encoding="ascii").strip()))


@router.get("")
def companion(db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    defaults = get_all_settings(db, settings)
    return {
        "service": "audiowhisper", "protocol_version": 1, "instance_id": installation_id(settings),
        "name": "AudioWhisper Studio", "authentication_required": bool(settings.access_token),
        "audio": {"sample_rate": 16000, "channels": 1, "sample_width": 2, "chunk_seconds": 4, "max_chunk_seconds": 30},
        "defaults": {"model_name": defaults["default_model"], "device": defaults["transcription_device"],
                     "compute_type": defaults["transcription_compute_type"], "language": defaults.get("default_language") or None,
                     "word_timestamps": defaults["default_word_timestamps"], "vad_enabled": defaults["default_vad_enabled"]},
    }


@router.get("/captures/{job_id}/transcript")
def transcript(job_id: str, after_index: int = Query(default=-1, ge=-1),
               limit: int = Query(default=200, ge=1, le=500),
               known_hash: str | None = Query(default=None, pattern=r"^[a-f0-9]{64}$"),
               db: Session = Depends(get_db)):
    job = get_job_or_404(db, job_id)
    # One SELECT keeps the checksum and the returned page in the same snapshot.
    # An index alone cannot detect a late worker result or an edit to older text.
    segments = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.job_id == job_id)
        .order_by(TranscriptSegment.segment_index, TranscriptSegment.id)))
    hashes = [hashlib.sha256().hexdigest()]
    digest = hashlib.sha256()
    prefix_count = 0
    for segment in segments:
        digest.update(TranscriptSegmentOut.model_validate(segment).model_dump_json().encode())
        digest.update(b"\n")
        hashes.append(digest.hexdigest())
        if segment.segment_index <= after_index:
            prefix_count += 1
    reset = known_hash is not None and known_hash != hashes[prefix_count]
    offset = 0 if reset else prefix_count
    page = segments[offset:offset + limit]
    return {"job_id": job.id, "status": job.status, "stage": job.current_stage, "error": job.error_message,
            "reset": reset, "has_more": offset + len(page) < len(segments),
            "prefix_hash": hashes[offset + len(page)],
            "segments": [TranscriptSegmentOut.model_validate(segment) for segment in page]}
