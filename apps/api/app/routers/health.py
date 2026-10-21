import json
import time

from fastapi import APIRouter, Depends
from redis.exceptions import RedisError
from sqlalchemy import text
from sqlalchemy.orm import Session

from audiowhisper_core.config import Settings, get_settings
from audiowhisper_core.schemas import GpuDiagnostics

from app.dependencies import get_db
from app.queue import get_redis_connection

router = APIRouter(prefix="/api/health", tags=["health"])

STALE_HEARTBEAT_SECONDS = 30


@router.get("")
def health(db: Session = Depends(get_db)) -> dict:
    db_ok = True
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False

    redis_ok = True
    try:
        get_redis_connection().ping()
    except RedisError:
        redis_ok = False

    return {
        "status": "ok" if (db_ok and redis_ok) else "degraded",
        "service": "api",
        "database": db_ok,
        "redis": redis_ok,
        "time": time.time(),
    }


@router.get("/gpu", response_model=GpuDiagnostics)
def health_gpu(settings: Settings = Depends(get_settings)) -> GpuDiagnostics:
    try:
        conn = get_redis_connection()
        raw = conn.get(settings.gpu_diagnostics_key)
        heartbeat = conn.get(settings.worker_heartbeat_key)
    except RedisError as exc:
        return GpuDiagnostics(gpu_available=False, error=f"Redis indisponível: {exc}")

    if raw is None:
        return GpuDiagnostics(
            gpu_available=False,
            error="O worker ainda não publicou um diagnóstico de GPU (ainda inicializando?)",
        )

    data = json.loads(raw)

    if heartbeat is not None:
        last_beat = float(heartbeat)
        if time.time() - last_beat > STALE_HEARTBEAT_SECONDS:
            data["error"] = "worker sem heartbeat recente — diagnóstico pode estar desatualizado"

    return GpuDiagnostics(**data)
