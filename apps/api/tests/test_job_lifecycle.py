import json
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from redis.exceptions import ConnectionError as RedisConnectionError

from audiowhisper_core.db import session_scope
from audiowhisper_core.models import AIDocument, ExportFile, LiveSession, MediaFile, TranscriptionJob, TranscriptSegment, WorkspaceItem


def test_delete_removes_rows_exports_live_chunks_and_unshared_media(client, make_completed_job, settings):
    job = make_completed_job([("Primeira", 0, 1), ("Segunda", 1, 2)], title="Reunião", speakers={"S1": "Ana"})
    export = client.post(f"/api/jobs/{job['job_id']}/exports", json={"formats": ["txt"]}).json()[0]
    live_dir = settings.uploads_dir / "live" / job["job_id"]
    live_dir.mkdir(parents=True)
    (live_dir / "0-0.wav").write_bytes(b"x")
    with session_scope() as db:
        db.add(AIDocument(job_id=job["job_id"], kind="summary", model="m", status="generated", source_hash="h"))
    media_path = settings.uploads_dir / job["stored_name"]
    assert media_path.exists()

    assert client.delete(f"/api/jobs/{job['job_id']}").status_code == 204
    with session_scope() as db:
        assert db.get(TranscriptionJob, job["job_id"]) is None
        assert db.get(MediaFile, job["media_id"]) is None
        assert db.get(WorkspaceItem, job["job_id"]) is None
        assert db.get(ExportFile, export["id"]) is None
        assert db.query(TranscriptSegment).filter_by(job_id=job["job_id"]).count() == 0
        assert db.query(AIDocument).filter_by(job_id=job["job_id"]).count() == 0
    assert not media_path.exists()
    assert not (settings.exports_dir / job["job_id"]).exists()
    assert not live_dir.exists()
    assert client.get(f"/api/jobs/{job['job_id']}").status_code == 404


def test_delete_keeps_media_still_used_by_another_run(client, make_completed_job, settings):
    job = make_completed_job([("Texto", 0, 1)])
    rerun = client.post(f"/api/jobs/{job['job_id']}/retranscribe", json={"model_name": "small"}).json()
    client.post(f"/api/jobs/{rerun['id']}/cancel")
    assert client.delete(f"/api/jobs/{job['job_id']}").status_code == 204
    assert (settings.uploads_dir / job["stored_name"]).exists()
    with session_scope() as db:
        assert db.get(MediaFile, job["media_id"]) is not None


def test_active_jobs_cannot_be_deleted(client, make_completed_job):
    job = make_completed_job([("Texto", 0, 1)], status="transcribing")
    response = client.delete(f"/api/jobs/{job['job_id']}")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CONFLICT"
    assert client.delete("/api/jobs/nao-existe").status_code == 404


def test_recordings_with_derived_work_in_progress_cannot_be_deleted(client, make_completed_job):
    diarizing = make_completed_job([("Texto", 0, 1)], title="Falantes")
    with session_scope() as db:
        db.get(WorkspaceItem, diarizing["job_id"]).diarization_status = "processing"
    response = client.delete(f"/api/jobs/{diarizing['job_id']}")
    assert response.status_code == 409 and "identificação de falantes" in response.json()["error"]["message"]

    documenting = make_completed_job([("Texto", 0, 1)])
    with session_scope() as db:
        db.add(AIDocument(job_id=documenting["job_id"], kind="summary", model="m", status="generating", source_hash="h"))
    response = client.delete(f"/api/jobs/{documenting['job_id']}")
    assert response.status_code == 409 and "geração do documento" in response.json()["error"]["message"]
    with session_scope() as db:
        db.query(AIDocument).filter_by(job_id=documenting["job_id"]).update({"status": "failed"})
    assert client.delete(f"/api/jobs/{documenting['job_id']}").status_code == 204


def test_retranscribe_creates_a_new_run_and_copies_organization(client, make_completed_job):
    job = make_completed_job([("Original", 0, 1)], title="Diretoria", folder="Reuniões", tags=["q4"], speakers={"S1": "Ana"})
    response = client.post(f"/api/jobs/{job['job_id']}/retranscribe",
                           json={"model_name": "large-v3", "language": "pt", "initial_prompt": "  AudioWhisper,   Ollama "})
    assert response.status_code == 201, response.text
    new = response.json()
    assert new["id"] != job["job_id"] and new["media_file_id"] == job["media_id"]
    assert (new["status"], new["model_name"], new["language_requested"]) == ("queued", "large-v3", "pt")
    organization = client.get(f"/api/library/{new['id']}").json()
    assert (organization["title"], organization["folder"], organization["tags"]) == ("Diretoria", "Reuniões", ["q4"])
    assert organization["speakers"] == {}
    with session_scope() as db:
        stored = json.loads(db.get(TranscriptionJob, new["id"]).settings_json)
        assert stored["initial_prompt"] == "AudioWhisper, Ollama"
        assert db.query(TranscriptSegment).filter_by(job_id=job["job_id"]).count() == 1


def test_retranscribe_requires_the_original_file(client, make_completed_job):
    job = make_completed_job([("Texto", 0, 1)], with_file=False)
    response = client.post(f"/api/jobs/{job['job_id']}/retranscribe", json={"model_name": "small"})
    assert response.status_code == 409
    assert "arquivo original" in response.json()["error"]["message"]


@pytest.mark.parametrize("payload", [
    {"model_name": "gpt-4"}, {"model_name": "small", "device": "tpu"}, {"model_name": "small", "compute_type": "int4"},
    {"model_name": "small", "language": "portugues"}, {"model_name": "small", "initial_prompt": "x" * 1001},
])
def test_transcription_settings_are_validated(client, make_completed_job, payload):
    job = make_completed_job([("Texto", 0, 1)])
    response = client.post(f"/api/jobs/{job['job_id']}/retranscribe", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_queue_outage_marks_the_job_failed_instead_of_stuck(client, fixture_path, monkeypatch):
    from app.services import job_service
    monkeypatch.setattr(job_service, "enqueue_transcription", Mock(side_effect=RedisConnectionError("down")))
    with open(fixture_path("tiny.mp3"), "rb") as f:
        media = client.post("/api/media/upload", files={"file": ("tiny.mp3", f, "audio/mpeg")}).json()
    response = client.post("/api/jobs", json={"media_file_id": media["id"], "settings": {"model_name": "small"}})
    assert response.status_code == 503
    body = response.json()["error"]
    assert body["code"] == "QUEUE_UNAVAILABLE"
    job = client.get(f"/api/jobs/{body['details']['job_id']}").json()
    assert (job["status"], job["error_code"]) == ("failed", "QUEUE_UNAVAILABLE")
    monkeypatch.undo()
    retried = client.post(f"/api/jobs/{job['id']}/retry")
    assert retried.status_code == 200 and retried.json()["status"] == "queued"


def test_unexpected_errors_return_a_json_body_with_request_id(make_completed_job, monkeypatch):
    from app.main import app
    from app.services import job_service
    job = make_completed_job([("Texto", 0, 1)])
    monkeypatch.setattr(job_service, "get_job_or_404", Mock(side_effect=RuntimeError("segredo interno")))
    client = TestClient(app, raise_server_exceptions=False)
    response = client.get(f"/api/jobs/{job['job_id']}", headers={"X-Request-ID": "req-123"})
    assert response.status_code == 500
    error = response.json()["error"]
    assert error["code"] == "INTERNAL_ERROR"
    assert error["request_id"] == "req-123"
    assert "segredo" not in response.text
    assert response.headers["x-request-id"] == "req-123"


def test_stats_endpoint_reports_speakers_and_uncertain_segments(client, make_completed_job):
    job = make_completed_job([
        ("Bom dia, vamos revisar o orçamento?", 0, 4, {"speaker": "S1", "confidence": 0.95}),
        ("Sim, o orçamento de marketing.", 4, 7, {"speaker": "S2", "confidence": 0.4}),
        ("O orçamento fecha amanhã.", 8, 10, {"speaker": "S1", "confidence": 0.8}),
    ], speakers={"S1": "Ana", "S2": "Bruno"}, duration=12)
    stats = client.get(f"/api/jobs/{job['job_id']}/stats").json()
    assert stats["segment_count"] == 3 and stats["questions"] == 1
    assert [s["name"] for s in stats["speakers"]] == ["Ana", "Bruno"]
    assert stats["low_confidence"]["segment_ids"] == [job["segment_ids"][1]]
    assert stats["keywords"][0] == {"term": "orçamento", "count": 3}
    strict = client.get(f"/api/jobs/{job['job_id']}/stats", params={"threshold": 0.9}).json()
    assert strict["low_confidence"]["segments"] == 2
    assert client.get(f"/api/jobs/{job['job_id']}/stats", params={"threshold": 2}).status_code == 422


def test_stats_threshold_defaults_to_the_saved_setting(client, make_completed_job):
    job = make_completed_job([("A", 0, 1, {"confidence": 0.7})])
    client.put("/api/settings", json={"values": {"low_confidence_threshold": 0.75}})
    try:
        assert client.get(f"/api/jobs/{job['job_id']}/stats").json()["low_confidence"]["segments"] == 1
    finally:
        client.put("/api/settings", json={"values": {"low_confidence_threshold": 0.6}})


def test_cancelled_live_capture_cannot_be_stopped_again(client, monkeypatch):
    monkeypatch.setattr("app.routers.live.get_queue", lambda: Mock())
    job = client.post("/api/live", json={"title": "Ao vivo", "settings": {"model_name": "small"}}).json()
    assert client.post(f"/api/jobs/{job['id']}/cancel").status_code == 200
    with session_scope() as db:
        assert db.get(LiveSession, job["id"]).status == "cancelled"
    assert client.post(f"/api/live/{job['id']}/stop", json={"expected_chunks": 0, "duration": 0}).status_code == 409
