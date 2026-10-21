import os
import shutil
import uuid
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _configure_env(tmp_root: Path) -> None:
    os.environ["DB_PATH"] = str(tmp_root / "db" / "audiowhisper.db")
    os.environ["UPLOADS_DIR"] = str(tmp_root / "uploads")
    os.environ["EXPORTS_DIR"] = str(tmp_root / "exports")
    os.environ["TMP_DIR"] = str(tmp_root / "tmp")
    os.environ["MODEL_CACHE_DIR"] = str(tmp_root / "models")
    os.environ["REDIS_URL"] = "redis://localhost:6379/0"
    os.environ["JOB_QUEUE_NAME"] = f"test-{uuid.uuid4().hex[:8]}"
    os.environ["ENVIRONMENT"] = "test"
    os.environ["LOG_LEVEL"] = "WARNING"


_session_tmp_root = Path(__file__).parent / ".pytest_data" / uuid.uuid4().hex[:8]
_configure_env(_session_tmp_root)

# Imports below must happen AFTER env vars are set, since audiowhisper_core.config.get_settings()
# is lru_cache'd at first call and several modules call it at import time.
from alembic import command  # noqa: E402
from alembic.config import Config as AlembicConfig  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from audiowhisper_core.config import get_settings  # noqa: E402
from audiowhisper_core.db import get_engine  # noqa: E402


def _run_migrations() -> None:
    core_dir = Path(__file__).parents[3] / "packages" / "core"
    cfg = AlembicConfig(str(core_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(core_dir / "migrations"))
    command.upgrade(cfg, "head")


_run_migrations()

from app.main import app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _cleanup_session():
    yield
    get_engine().dispose()
    shutil.rmtree(_session_tmp_root, ignore_errors=True)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def fixture_path():
    def _fixture_path(name: str) -> Path:
        return FIXTURES_DIR / name

    return _fixture_path


_MIME_BY_EXT = {
    ".wav": "audio/x-wav",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".m4a": "audio/mp4",
    ".flac": "audio/x-flac",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".avi": "video/x-msvideo",
    ".aac": "audio/aac",
}


@pytest.fixture(autouse=True)
def _fake_libmagic(monkeypatch):
    """python-magic requires libmagic, which isn't reliably available on the Windows dev host.
    The real Docker image installs libmagic1, so this only stands in for local test runs."""

    def fake_sniff_mime(path: str) -> str:
        p = Path(path)
        head = p.read_bytes()[:32]
        if head.startswith(b"not a real"):
            return "text/plain"
        return _MIME_BY_EXT.get(p.suffix.lower(), "application/octet-stream")

    import app.services.media_service as ms

    monkeypatch.setattr(ms, "sniff_mime", fake_sniff_mime)


@pytest.fixture
def unique_wav(tmp_path):
    """Generates a fresh, valid, distinct-content WAV per call via ffmpeg — needed because
    tests share one session-scoped DB/uploads dir and must not collide with each other's
    duplicate-detection assertions."""
    import random
    import subprocess

    def _make(name: str = "unique.wav") -> Path:
        dest = tmp_path / name
        freq = random.randint(200, 2000)
        subprocess.run(
            [
                "ffmpeg", "-y", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration=1",
                "-ar", "16000", "-ac", "1", str(dest), "-loglevel", "error",
            ],
            check=True,
            timeout=15,
        )
        return dest

    return _make


@pytest.fixture
def seed_segments():
    from audiowhisper_core.db import session_scope
    from audiowhisper_core.models import TranscriptSegment

    def _seed(job_id: str, texts: list[str], segment_seconds: float = 3.0) -> list[str]:
        ids = []
        with session_scope() as db:
            for i, text in enumerate(texts):
                seg = TranscriptSegment(
                    job_id=job_id,
                    segment_index=i,
                    start=i * segment_seconds,
                    end=(i + 1) * segment_seconds,
                    text=text,
                    confidence=0.9,
                )
                db.add(seg)
                db.flush()
                ids.append(seg.id)
        return ids

    return _seed
