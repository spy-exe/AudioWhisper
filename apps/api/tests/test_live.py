from unittest.mock import Mock
from audiowhisper_core.db import session_scope
from audiowhisper_core.models import LiveChunk


def test_live_ingestion_is_validated_and_idempotent(client, fixture_path, monkeypatch):
    queue = Mock()
    monkeypatch.setattr("app.routers.live.get_queue", lambda: queue)
    response = client.post("/api/live", json={"title": "Reunião", "source": "microphone", "settings": {"model_name": "small"}})
    assert response.status_code == 201
    job = response.json()
    url = f"/api/live/{job['id']}/chunks/0?start=0&revision=1&final=true"
    data = fixture_path("speech.wav").read_bytes()
    first = client.post(url, files={"file": ("chunk.wav", data, "audio/wav")})
    assert first.status_code == 202, first.text
    assert client.post(url, files={"file": ("chunk.wav", data, "audio/wav")}).status_code == 202
    assert queue.enqueue.call_count == 1
    assert client.post(url.replace("start=0", "start=1"), files={"file": ("chunk.wav", data, "audio/wav")}).status_code == 409
    assert client.post(f"/api/live/{job['id']}/chunks/1?start=1", files={"file": ("bad.wav", b"broken", "audio/wav")}).status_code == 422
    assert client.post(f"/api/live/{job['id']}/stop", json={"expected_chunks": 1, "duration": 20}).status_code == 202
    with session_scope() as db:
        assert db.query(LiveChunk).filter_by(job_id=job["id"]).count() == 1
