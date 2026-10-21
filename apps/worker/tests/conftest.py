import os
import shutil
import uuid
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"
_session_tmp_root = Path(__file__).parent / ".pytest_data" / uuid.uuid4().hex[:8]


def _configure_env(tmp_root: Path) -> None:
    os.environ["DB_PATH"] = str(tmp_root / "db" / "audiowhisper.db")
    os.environ["UPLOADS_DIR"] = str(tmp_root / "uploads")
    os.environ["EXPORTS_DIR"] = str(tmp_root / "exports")
    os.environ["TMP_DIR"] = str(tmp_root / "tmp")
    os.environ["MODEL_CACHE_DIR"] = str(Path(__file__).parents[3] / ".devdata" / "models")
    os.environ["REDIS_URL"] = "redis://localhost:6379/0"
    os.environ["JOB_QUEUE_NAME"] = f"test-worker-{uuid.uuid4().hex[:8]}"
    os.environ["TRANSCRIPTION_DEVICE"] = "cpu"
    os.environ["TRANSCRIPTION_COMPUTE_TYPE"] = "int8"
    os.environ["DEFAULT_MODEL"] = "tiny"
    os.environ["ENVIRONMENT"] = "test"
    os.environ["LOG_LEVEL"] = "WARNING"


_configure_env(_session_tmp_root)

from alembic import command  # noqa: E402
from alembic.config import Config as AlembicConfig  # noqa: E402

from audiowhisper_core.config import get_settings  # noqa: E402
from audiowhisper_core.db import get_engine, get_session_factory  # noqa: E402


def _run_migrations() -> None:
    core_dir = Path(__file__).parents[3] / "packages" / "core"
    cfg = AlembicConfig(str(core_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(core_dir / "migrations"))
    command.upgrade(cfg, "head")


_run_migrations()


@pytest.fixture(scope="session", autouse=True)
def _cleanup_session():
    yield
    get_engine().dispose()
    shutil.rmtree(_session_tmp_root, ignore_errors=True)


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def db_session():
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def fixture_path():
    def _fixture_path(name: str) -> Path:
        return FIXTURES_DIR / name

    return _fixture_path


@pytest.fixture
def make_media_and_job(db_session, settings):
    """Copies a fixture into the uploads dir and creates real MediaFile + TranscriptionJob rows,
    mirroring exactly what the API's upload+create-job flow would have produced."""
    import json
    import subprocess

    from audiowhisper_core.enums import JobStatus, MediaType
    from audiowhisper_core.models import MediaFile, TranscriptionJob

    def _make(fixture_name: str = "speech.wav", **job_overrides) -> tuple[MediaFile, TranscriptionJob]:
        media_id = str(uuid.uuid4())
        stored_name = f"{media_id}.wav"
        dest = settings.uploads_dir / stored_name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(FIXTURES_DIR / fixture_name, dest)

        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", str(dest)],
            capture_output=True, text=True, check=True,
        )
        duration = float(json.loads(probe.stdout)["format"]["duration"])

        media = MediaFile(
            id=media_id,
            original_name=fixture_name,
            stored_name=stored_name,
            mime_type="audio/x-wav",
            extension="wav",
            size_bytes=dest.stat().st_size,
            sha256=uuid.uuid4().hex,
            duration_seconds=duration,
            media_type=MediaType.AUDIO,
            metadata_json="{}",
        )
        db_session.add(media)

        job_settings = {
            "model_name": "tiny",
            "language": None,
            "device": "cpu",
            "compute_type": "int8",
            "beam_size": 5,
            "vad_enabled": True,
            "word_timestamps": True,
            "translate_to_english": False,
            "temperature": 0.0,
        }
        job_settings.update(job_overrides.pop("settings", {}))

        job = TranscriptionJob(
            media_file_id=media_id,
            status=job_overrides.pop("status", JobStatus.QUEUED),
            model_name=job_settings["model_name"],
            language_requested=job_settings["language"],
            compute_type=job_settings["compute_type"],
            device=job_settings["device"],
            settings_json=json.dumps(job_settings),
            **job_overrides,
        )
        db_session.add(job)
        db_session.commit()
        db_session.refresh(media)
        db_session.refresh(job)
        return media, job

    return _make
