import threading
import time

import redis
from rq import Queue
from rq.worker import SimpleWorker

from audiowhisper_core.config import get_settings
from audiowhisper_core.logging import configure_logging

from app.diagnostics.gpu import collect
from app.tasks import get_model_manager

logger = configure_logging("worker", get_settings().log_level)

HEARTBEAT_INTERVAL_SECONDS = 15
REDIS_KEY_TTL_SECONDS = 120


def _heartbeat_loop(redis_conn, settings, manager, stop_event: threading.Event) -> None:
    while not stop_event.is_set():
        try:
            diagnostics = collect(manager)
            redis_conn.set(settings.gpu_diagnostics_key, diagnostics.model_dump_json(), ex=REDIS_KEY_TTL_SECONDS)
            redis_conn.set(settings.worker_heartbeat_key, str(time.time()), ex=REDIS_KEY_TTL_SECONDS)
        except Exception as exc:  # noqa: BLE001 — heartbeat must never crash the worker
            logger.error("heartbeat_failed", extra={"error": str(exc)})
        stop_event.wait(HEARTBEAT_INTERVAL_SECONDS)


def main() -> None:
    settings = get_settings()
    redis_conn = redis.from_url(settings.redis_url)
    manager = get_model_manager(settings)

    stop_event = threading.Event()
    heartbeat_thread = threading.Thread(
        target=_heartbeat_loop, args=(redis_conn, settings, manager, stop_event), daemon=True
    )
    heartbeat_thread.start()

    logger.info(
        "worker_starting",
        extra={"stage": "startup", "queue": settings.job_queue_name, "device": settings.transcription_device},
    )

    queue = Queue(settings.job_queue_name, connection=redis_conn)
    from app.recovery import recover_pending
    recover_pending(queue)
    # SimpleWorker (not the default forking Worker): runs jobs in this same process so the
    # loaded WhisperModel / CUDA context is reused across jobs instead of reloaded every time.
    worker = SimpleWorker([queue], connection=redis_conn)
    try:
        worker.work(with_scheduler=False, logging_level="INFO")
    finally:
        stop_event.set()


if __name__ == "__main__":
    main()
