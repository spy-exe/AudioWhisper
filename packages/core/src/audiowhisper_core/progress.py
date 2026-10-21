"""Redis pub/sub channel + key naming shared between api and worker."""

from audiowhisper_core.config import Settings


def progress_channel(settings: Settings, job_id: str) -> str:
    return f"{settings.progress_channel_prefix}{job_id}"


def job_queue_name(settings: Settings) -> str:
    return settings.job_queue_name
