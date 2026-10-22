import os
import shutil
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from redis.exceptions import RedisError
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from audiowhisper_core.config import Settings, get_settings
from audiowhisper_core.enums import TERMINAL_STATUSES
from audiowhisper_core.models import AIDocument, ExportFile, MediaFile, TranscriptionJob, TranscriptSegment, WorkspaceItem
from app.dependencies import get_db
from app.queue import get_queue, get_redis_connection

router = APIRouter(prefix="/api/system", tags=["system"])

TMP_GRACE_SECONDS = 15 * 60
WORKER_STALE_SECONDS = 60


def directory_size(path: Path) -> tuple[int, int]:
    total = files = 0
    if not path.exists():
        return 0, 0
    for root, _, names in os.walk(path):
        for name in names:
            try:
                total += (Path(root) / name).stat().st_size
                files += 1
            except OSError:
                continue  # removed while walking (e.g. a temporary file finished)
    return total, files


@router.get("/storage")
def storage(db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    directories = {}
    for name, path in (("uploads", settings.uploads_dir), ("exports", settings.exports_dir),
                       ("tmp", settings.tmp_dir), ("models", settings.model_cache_dir)):
        size, files = directory_size(path)
        directories[name] = {"bytes": size, "files": files}
    db_size = sum(p.stat().st_size for p in settings.db_path.parent.glob(settings.db_path.name + "*") if p.is_file())
    directories["database"] = {"bytes": db_size, "files": 1}
    usage = shutil.disk_usage(settings.uploads_dir)
    return {
        "directories": directories,
        "disk": {"total_bytes": usage.total, "free_bytes": usage.free, "used_bytes": usage.used},
        "counts": {
            "media": db.scalar(select(func.count()).select_from(MediaFile)) or 0,
            "jobs": db.scalar(select(func.count()).select_from(TranscriptionJob)) or 0,
            "segments": db.scalar(select(func.count()).select_from(TranscriptSegment)) or 0,
            "documents": db.scalar(select(func.count()).select_from(AIDocument)) or 0,
            "exports": db.scalar(select(func.count()).select_from(ExportFile)) or 0,
        },
    }


class CleanupIn(BaseModel):
    target: Literal["tmp", "exports"]


@router.post("/cleanup")
def cleanup(payload: CleanupIn, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    """Only regenerable data: temporary audio of finished work and stored export files.
    Uploads, transcripts, documents and models are never touched here."""
    freed = removed = 0
    if payload.target == "tmp":
        active = set(db.scalars(select(TranscriptionJob.id).where(TranscriptionJob.status.not_in(TERMINAL_STATUSES))))
        now = time.time()
        for path in settings.tmp_dir.glob("*") if settings.tmp_dir.exists() else []:
            if not path.is_file() or any(job_id in path.name for job_id in active):
                continue
            stat = path.stat()
            if now - stat.st_mtime < TMP_GRACE_SECONDS:
                continue  # may belong to a diarization or document run that just started
            path.unlink(missing_ok=True)
            freed += stat.st_size
            removed += 1
    else:
        root = settings.exports_dir.resolve()
        for export in list(db.scalars(select(ExportFile))):
            path = (settings.exports_dir / export.path).resolve()
            if root in path.parents and path.is_file():
                freed += path.stat().st_size
                path.unlink(missing_ok=True)
            db.delete(export)
            removed += 1
        db.commit()
        for directory in settings.exports_dir.glob("*"):
            if directory.is_dir() and not any(directory.iterdir()):
                directory.rmdir()
    return {"target": payload.target, "freed_bytes": freed, "removed": removed}


@router.get("/queue")
def queue_status(db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    unfinished = TranscriptionJob.status.not_in(TERMINAL_STATUSES)
    # Work in progress first, then the waiting line in arrival order.
    active = db.execute(
        select(TranscriptionJob, MediaFile.original_name, WorkspaceItem.title).join(MediaFile)
        .outerjoin(WorkspaceItem).where(unfinished)
        .order_by(case((TranscriptionJob.status == "queued", 1), else_=0), TranscriptionJob.created_at).limit(20)).all()
    active_count = db.scalar(select(func.count()).select_from(TranscriptionJob).where(unfinished)) or 0
    pending_documents = db.scalar(select(func.count()).select_from(AIDocument)
                                  .where(AIDocument.status.in_(["queued", "generating"]))) or 0
    queued, worker_online, error = None, False, None
    try:
        queued = get_queue().count
        heartbeat = get_redis_connection().get(settings.worker_heartbeat_key)
        worker_online = heartbeat is not None and time.time() - float(heartbeat) < WORKER_STALE_SECONDS
    except RedisError:
        error = "Redis indisponível: a fila não pode ser consultada."
    return {
        "queued": queued,
        "worker_online": worker_online,
        "pending_documents": pending_documents,
        "active_count": active_count,
        "active_jobs": [{"id": job.id, "status": job.status, "progress": job.progress,
                         "current_stage": job.current_stage, "title": title or name} for job, name, title in active],
        "error": error,
    }
