import os
import time
from unittest.mock import Mock

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from audiowhisper_core.db import session_scope
from audiowhisper_core.models import ExportFile


def test_storage_reports_directories_disk_and_counts(client, make_completed_job, settings):
    make_completed_job([("Texto", 0, 1)])
    body = client.get("/api/system/storage").json()
    assert set(body["directories"]) == {"uploads", "exports", "tmp", "models", "database"}
    assert body["directories"]["uploads"]["bytes"] > 0 and body["directories"]["uploads"]["files"] >= 1
    assert body["directories"]["database"]["bytes"] > 0
    assert body["disk"]["total_bytes"] >= body["disk"]["free_bytes"] > 0
    assert body["counts"]["jobs"] >= 1 and body["counts"]["segments"] >= 1


def test_tmp_cleanup_spares_active_jobs_and_recent_files(client, make_completed_job, settings):
    active = make_completed_job([("Texto", 0, 1)], status="transcribing")
    settings.tmp_dir.mkdir(parents=True, exist_ok=True)
    stale = settings.tmp_dir / "finished-job.wav"
    busy = settings.tmp_dir / f"{active['job_id']}.wav"
    fresh = settings.tmp_dir / "diarize-new.wav"
    for path in (stale, busy, fresh):
        path.write_bytes(b"0" * 1000)
    old = time.time() - 3600
    os.utime(stale, (old, old))
    os.utime(busy, (old, old))
    result = client.post("/api/system/cleanup", json={"target": "tmp"}).json()
    assert result["removed"] >= 1 and result["freed_bytes"] >= 1000
    assert not stale.exists()
    assert busy.exists() and fresh.exists()
    for path in (busy, fresh):
        path.unlink()


def test_exports_cleanup_removes_regenerable_files_only(client, make_completed_job, settings):
    job = make_completed_job([("Texto", 0, 1)])
    export = client.post(f"/api/jobs/{job['job_id']}/exports", json={"formats": ["txt", "srt"]}).json()
    result = client.post("/api/system/cleanup", json={"target": "exports"}).json()
    assert result["removed"] >= 2
    with session_scope() as db:
        assert db.get(ExportFile, export[0]["id"]) is None
    assert not (settings.exports_dir / job["job_id"]).exists()
    assert (settings.uploads_dir / job["stored_name"]).exists()
    assert client.get(f"/api/jobs/{job['job_id']}/segments").json()[0]["text"] == "Texto"
    assert client.post("/api/system/cleanup", json={"target": "uploads"}).status_code == 422


def test_queue_status_lists_active_work_and_worker_presence(client, make_completed_job, settings):
    active = make_completed_job([("Texto", 0, 1)], status="transcribing", title="Em andamento")
    from app.queue import get_redis_connection
    get_redis_connection().set(settings.worker_heartbeat_key, str(time.time()))
    body = client.get("/api/system/queue").json()
    assert body["worker_online"] is True and body["error"] is None
    assert isinstance(body["queued"], int)
    assert body["active_jobs"][0]["status"] != "queued"
    assert any(job["id"] == active["job_id"] and job["title"] == "Em andamento" for job in body["active_jobs"])
    assert body["active_count"] >= len(body["active_jobs"])
    get_redis_connection().set(settings.worker_heartbeat_key, str(time.time() - 600))
    assert client.get("/api/system/queue").json()["worker_online"] is False
    get_redis_connection().delete(settings.worker_heartbeat_key)


def test_queue_and_health_survive_a_redis_outage(client, monkeypatch):
    broken = Mock()
    broken.ping.side_effect = RedisConnectionError("down")
    broken.get.side_effect = RedisConnectionError("down")
    monkeypatch.setattr("app.routers.system.get_redis_connection", lambda: broken)
    monkeypatch.setattr("app.routers.system.get_queue", Mock(side_effect=RedisConnectionError("down")))
    body = client.get("/api/system/queue").json()
    assert body["queued"] is None and body["worker_online"] is False and "Redis" in body["error"]
    monkeypatch.setattr("app.routers.health.get_redis_connection", lambda: broken)
    health = client.get("/api/health").json()
    assert (health["status"], health["redis"], health["worker"]) == ("degraded", False, False)


def test_health_reports_worker_without_degrading_the_api(client, settings):
    from app.queue import get_redis_connection
    get_redis_connection().delete(settings.worker_heartbeat_key)
    health = client.get("/api/health").json()
    assert health["status"] == "ok" and health["worker"] is False
    get_redis_connection().set(settings.worker_heartbeat_key, str(time.time()))
    assert client.get("/api/health").json()["worker"] is True
    get_redis_connection().delete(settings.worker_heartbeat_key)


def test_new_settings_have_defaults(client):
    body = client.get("/api/settings").json()
    for key in ("default_language", "vocabulary", "hotwords", "low_confidence_threshold", "notifications_enabled"):
        assert key in body


@pytest.mark.parametrize("values", [
    {"default_model": "gpt-4"}, {"transcription_device": "tpu"}, {"transcription_compute_type": "int4"},
    {"default_beam_size": 0}, {"default_beam_size": 11}, {"default_beam_size": True}, {"default_beam_size": "5"},
    {"default_vad_enabled": "sim"}, {"low_confidence_threshold": 1.5}, {"default_language": "portugues"},
    {"vocabulary": "x" * 1001}, {"hotwords": 42}, {"ai_template": "poema"},
])
def test_invalid_settings_are_rejected_without_partial_writes(client, values):
    before = client.get("/api/settings").json()
    response = client.put("/api/settings", json={"values": {"visual_effects_enabled": not before["visual_effects_enabled"], **values}})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert set(response.json()["error"]["details"]["fields"]) == set(values)
    assert client.get("/api/settings").json() == before


def test_valid_settings_are_normalized(client):
    response = client.put("/api/settings", json={"values": {
        "vocabulary": "  Opikode,\n  AudioWhisper  ", "default_language": "pt", "low_confidence_threshold": 1 / 2,
        "notifications_enabled": True}})
    assert response.status_code == 200
    assert response.json()["vocabulary"] == "Opikode, AudioWhisper"
    saved = client.get("/api/settings").json()
    assert (saved["default_language"], saved["low_confidence_threshold"], saved["notifications_enabled"]) == ("pt", 0.5, True)
    client.put("/api/settings", json={"values": {"vocabulary": "", "default_language": "", "low_confidence_threshold": 0.6,
                                                 "notifications_enabled": False}})


def test_openapi_schema_lists_the_new_endpoints(client):
    paths = client.get("/api/openapi.json").json()["paths"]
    for path in ("/api/search", "/api/jobs/{job_id}/bookmarks", "/api/jobs/{job_id}/segments/merge",
                 "/api/system/storage", "/api/library/facets", "/api/jobs/{job_id}/exports/bundle"):
        assert path in paths
    assert client.get("/docs").status_code == 404


def test_openapi_schema_requires_the_access_token(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "access_token", "segredo")
    assert client.get("/api/openapi.json").status_code == 401
    assert client.get("/api/openapi.json", headers={"X-Access-Token": "segredo"}).status_code == 200
