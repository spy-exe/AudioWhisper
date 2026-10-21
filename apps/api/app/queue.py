from functools import lru_cache

import redis
from rq import Queue

from audiowhisper_core.config import Settings, get_settings

JOB_TIMEOUT_SECONDS = 6 * 60 * 60  # a very long file should still not be killed prematurely
RESULT_TTL_SECONDS = 24 * 60 * 60


@lru_cache
def get_redis_connection() -> redis.Redis:
    settings = get_settings()
    return redis.from_url(settings.redis_url)


@lru_cache
def get_queue() -> Queue:
    settings: Settings = get_settings()
    return Queue(settings.job_queue_name, connection=get_redis_connection())


def enqueue_transcription(job_id: str) -> None:
    queue = get_queue()
    queue.enqueue(
        "app.tasks.process_transcription_job",
        job_id,
        job_id=job_id,
        job_timeout=JOB_TIMEOUT_SECONDS,
        result_ttl=RESULT_TTL_SECONDS,
        failure_ttl=RESULT_TTL_SECONDS,
    )
