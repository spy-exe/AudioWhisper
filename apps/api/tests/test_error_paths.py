"""Failure and edge paths of documents, live capture and progress streaming."""
import json
import time
from unittest.mock import Mock

from audiowhisper_core.db import session_scope
from audiowhisper_core.models import AIDocument, LiveChunk


def test_intelligence_status_reports_an_unreachable_ollama(client, monkeypatch, settings):
    monkeypatch.setattr(settings, "ollama_url", "http://127.0.0.1:9")
    body = client.get("/api/intelligence").json()
    assert body["available"] is False and body["models"] == [] and "Ollama" in body["error"]
    assert "minutes" in body["templates"]


def test_document_generation_preconditions(client, make_completed_job, monkeypatch):
    queue = Mock()
    monkeypatch.setattr("app.routers.documents.get_queue", lambda: queue)
    payload = {"kind": "summary", "model": "qwen3:4b"}
    running = make_completed_job([("Texto", 0, 1)], status="transcribing")
    assert client.post(f"/api/jobs/{running['job_id']}/documents", json=payload).status_code == 409
    empty = make_completed_job([])
    assert "não tem texto" in client.post(f"/api/jobs/{empty['job_id']}/documents", json=payload).json()["error"]["message"]
    job = make_completed_job([("Texto", 0, 1)])
    assert client.post(f"/api/jobs/{job['job_id']}/documents", json={**payload, "kind": "poema"}).status_code == 422
    created = client.post(f"/api/jobs/{job['job_id']}/documents", json=payload)
    assert created.status_code == 202 and created.json()["status"] == "queued" and created.json()["stale"] is False
    queue.enqueue.assert_called_once()
    assert client.post(f"/api/jobs/{job['job_id']}/documents", json=payload).status_code == 409  # one at a time
    listed = client.get(f"/api/jobs/{job['job_id']}/documents").json()
    assert [d["id"] for d in listed] == [created.json()["id"]]


def test_document_generation_survives_a_queue_outage(client, make_completed_job, monkeypatch):
    broken = Mock()
    broken.enqueue.side_effect = RuntimeError("down")
    monkeypatch.setattr("app.routers.documents.get_queue", lambda: broken)
    job = make_completed_job([("Texto", 0, 1)])
    response = client.post(f"/api/jobs/{job['job_id']}/documents", json={"kind": "summary", "model": "m"})
    assert response.status_code == 503
    with session_scope() as db:
        document = db.query(AIDocument).filter_by(job_id=job["job_id"]).one()
        assert document.status == "failed" and "fila" in document.error.lower()


def test_review_requires_a_generated_document_from_the_current_source(client, make_completed_job):
    job = make_completed_job([("Texto", 0, 1)])
    with session_scope() as db:
        queued = AIDocument(job_id=job["job_id"], kind="summary", model="m", status="queued", source_hash="x")
        db.add(queued)
        db.commit()
        queued_id = queued.id
    assert client.put(f"/api/documents/{queued_id}", json={"markdown": "x", "reviewed": True}).status_code == 409
    assert client.put("/api/documents/nao-existe", json={"markdown": "x"}).status_code == 404
    assert client.get(f"/api/documents/{queued_id}/download").status_code == 409


def _live(client):
    return client.post("/api/live", json={"title": "Ao vivo", "source": "mixed", "settings": {"model_name": "small"}}).json()


def test_live_chunk_validation_and_state(client, fixture_path, monkeypatch):
    queue = Mock()
    monkeypatch.setattr("app.routers.live.get_queue", lambda: queue)
    job = _live(client)
    audio = fixture_path("speech.wav").read_bytes()
    base = f"/api/live/{job['id']}/chunks"
    assert client.post(f"{base}/20001?start=0", files={"file": ("c.wav", audio, "audio/wav")}).status_code == 422
    # A reduced limit keeps the oversized case cheap: 2 MB through the multipart parser is ~2 min under coverage.
    monkeypatch.setattr("app.routers.live.MAX_CHUNK_BYTES", 1_000)
    assert client.post(f"{base}/0?start=0", files={"file": ("c.wav", b"0" * 1_001, "audio/wav")}).status_code == 413
    monkeypatch.undo()
    monkeypatch.setattr("app.routers.live.get_queue", lambda: queue)
    import io
    import wave
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as other_rate:
        other_rate.setnchannels(1), other_rate.setsampwidth(2), other_rate.setframerate(44100)
        other_rate.writeframes(b"\0\0" * 4410)
    assert client.post(f"{base}/0?start=0", files={"file": ("c.wav", buffer.getvalue(), "audio/wav")}).status_code == 422
    assert client.post(f"{base}/0?start=0&final=true", files={"file": ("c.wav", audio, "audio/wav")}).status_code == 202
    duplicate_final = client.post(f"{base}/0?start=0&revision=2&final=true", files={"file": ("c.wav", audio, "audio/wav")})
    assert duplicate_final.status_code == 409
    status = client.get(f"/api/live/{job['id']}").json()
    assert status["status"] == "recording" and status["chunks"] == [{"sequence": 0, "status": "queued", "error": None}]
    assert client.get("/api/live/nao-existe").status_code == 404

    assert client.post(f"/api/live/{job['id']}/stop", json={"expected_chunks": 1, "duration": 3}).status_code == 202
    assert client.post(f"/api/live/{job['id']}/stop", json={"expected_chunks": 2, "duration": 3}).status_code == 409
    outside = client.post(f"{base}/1?start=3&final=true", files={"file": ("c.wav", audio, "audio/wav")})
    assert outside.status_code == 409


def test_failed_chunks_are_requeued_and_ingest_reports_queue_outages(client, fixture_path, monkeypatch):
    queue = Mock()
    queue.fetch_job.return_value = None
    monkeypatch.setattr("app.routers.live.get_queue", lambda: queue)
    job = _live(client)
    audio = fixture_path("speech.wav").read_bytes()
    url = f"/api/live/{job['id']}/chunks/0?start=0&final=true"
    client.post(url, files={"file": ("c.wav", audio, "audio/wav")})
    with session_scope() as db:
        db.query(LiveChunk).filter_by(job_id=job["id"]).update({"status": "failed", "error": "falhou"})
    again = client.post(url, files={"file": ("c.wav", audio, "audio/wav")})
    assert again.status_code == 202 and again.json()["status"] == "queued"

    queue.enqueue.side_effect = RuntimeError("down")
    lost = client.post(f"/api/live/{job['id']}/chunks/1?start=3&final=true", files={"file": ("c.wav", audio, "audio/wav")})
    assert lost.status_code == 503
    with session_scope() as db:
        chunk = db.query(LiveChunk).filter_by(job_id=job["id"], sequence=1).one()
        assert chunk.status == "failed" and "preservado" in chunk.error


def test_completed_capture_stop_is_idempotent(client, monkeypatch):
    monkeypatch.setattr("app.routers.live.get_queue", lambda: Mock())
    job = _live(client)
    from audiowhisper_core.models import LiveSession
    with session_scope() as db:
        db.get(LiveSession, job["id"]).status = "completed"
    assert client.post(f"/api/live/{job['id']}/stop", json={"expected_chunks": 5, "duration": 1}).json() == {"status": "completed"}


def test_ws_snapshot_includes_provisional_live_text_until_its_final_version(client, fixture_path, monkeypatch):
    monkeypatch.setattr("app.routers.live.get_queue", lambda: Mock())
    job = _live(client)
    audio = fixture_path("speech.wav").read_bytes()
    client.post(f"/api/live/{job['id']}/chunks/0?start=0&revision=1", files={"file": ("c.wav", audio, "audio/wav")})
    draft = [{"id": "draft-1", "text": "rascunho"}]
    with session_scope() as db:
        db.query(LiveChunk).filter_by(job_id=job["id"]).update({"status": "completed", "result_json": json.dumps(draft)})
    client.post(f"/api/jobs/{job['id']}/cancel")
    with client.websocket_connect(f"/ws/jobs/{job['id']}") as ws:
        snapshot = ws.receive_json()
        assert snapshot["provisional_segments"] == draft


def test_ws_forwards_progress_until_a_terminal_event(client, make_completed_job, settings):
    import threading
    import redis
    job = make_completed_job([("Texto", 0, 1)], status="transcribing")
    publisher = redis.from_url(settings.redis_url)
    channel = f"{settings.progress_channel_prefix}{job['job_id']}"

    def publish_later():
        time.sleep(0.4)
        publisher.publish(channel, json.dumps({"job_id": job["job_id"], "status": "transcribing", "progress": 0.5, "eta_seconds": 12}))
        publisher.publish(channel, json.dumps({"job_id": job["job_id"], "status": "completed", "progress": 1.0}))

    threading.Thread(target=publish_later, daemon=True).start()
    with client.websocket_connect(f"/ws/jobs/{job['job_id']}") as ws:
        assert ws.receive_json()["type"] == "snapshot"
        progress = ws.receive_json()
        assert (progress["type"], progress["progress"], progress["eta_seconds"]) == ("progress", 0.5, 12)
        assert ws.receive_json()["status"] == "completed"
    publisher.close()
