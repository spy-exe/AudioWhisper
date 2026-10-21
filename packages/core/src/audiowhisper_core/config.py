from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Storage
    data_dir: Path = Path("/data")
    db_path: Path = Path("/data/db/audiowhisper.db")
    uploads_dir: Path = Path("/data/uploads")
    exports_dir: Path = Path("/data/exports")
    tmp_dir: Path = Path("/data/tmp")
    model_cache_dir: Path = Path("/data/models")

    # Redis / queue
    redis_url: str = "redis://redis:6379/0"
    job_queue_name: str = "transcription"
    progress_channel_prefix: str = "job:progress:"
    gpu_diagnostics_key: str = "worker:gpu_diagnostics"
    worker_heartbeat_key: str = "worker:heartbeat"

    # Uploads
    max_upload_bytes: int = 5 * 1024 * 1024 * 1024  # 5 GiB
    # Plain comma-separated strings (not tuple/list) for CORS/extensions: pydantic-settings
    # tries to JSON-decode env values for list/tuple-typed fields, which raises on a plain
    # empty string (the common case for "unset" here) rather than treating it as "no values".
    allowed_extensions_raw: str = Field(
        default="wav,mp3,m4a,aac,flac,ogg,opus,mp4,mkv,mov,webm,avi",
        alias="ALLOWED_EXTENSIONS",
    )

    # Transcription defaults (overridable via ApplicationSettings table at runtime)
    default_model: str = "turbo"
    transcription_device: str = "cuda"
    # float16 (not int8_float16) is the safest default: int8 cuBLAS kernels are unsupported on
    # some newer GPU architectures (observed on RTX 50-series/Blackwell — CUBLAS_STATUS_NOT_SUPPORTED),
    # while float16 is broadly compatible and still fast. The worker's fallback ladder tries other
    # compute types automatically regardless of this default; see apps/worker/app/model_manager.py.
    transcription_compute_type: str = "float16"
    default_beam_size: int = 5
    default_vad_enabled: bool = True
    default_word_timestamps: bool = True
    default_translate_to_english: bool = False

    # Auth
    access_token: str | None = Field(default=None, repr=False)
    ollama_url: str = "http://host.docker.internal:11434"
    ollama_timeout_seconds: int = 300
    hf_token: str | None = Field(default=None, repr=False)
    diarization_model: str = "pyannote/speaker-diarization-community-1"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = Field(default=None, repr=False)
    smtp_from: str | None = None
    smtp_starttls: bool = True

    # Misc
    log_level: str = "INFO"
    environment: str = "production"
    cors_allow_origins_raw: str = Field(default="", alias="CORS_ALLOW_ORIGINS")
    request_id_header: str = "X-Request-ID"

    @property
    def allowed_extensions(self) -> tuple[str, ...]:
        return tuple(e.strip().lower() for e in self.allowed_extensions_raw.split(",") if e.strip())

    @property
    def cors_allow_origins(self) -> tuple[str, ...]:
        return tuple(o.strip() for o in self.cors_allow_origins_raw.split(",") if o.strip())

    def ensure_directories(self) -> None:
        for path in (
            self.db_path.parent,
            self.uploads_dir,
            self.exports_dir,
            self.tmp_dir,
            self.model_cache_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_directories()
    return settings
