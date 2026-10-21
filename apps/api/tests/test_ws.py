def test_ws_sends_snapshot_for_queued_job(client, fixture_path):
    with open(fixture_path("tiny.wav"), "rb") as f:
        media = client.post("/api/media/upload", files={"file": ("tiny.wav", f, "audio/wav")}).json()
    job = client.post(
        "/api/jobs", json={"media_file_id": media["id"], "settings": {"model_name": "small"}}
    ).json()

    with client.websocket_connect(f"/ws/jobs/{job['id']}") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "snapshot"
        assert msg["job"]["id"] == job["id"]
        assert msg["job"]["status"] == "queued"
        ws.close()


def test_ws_closes_immediately_for_terminal_job(client, fixture_path):
    with open(fixture_path("tiny.wav"), "rb") as f:
        media = client.post("/api/media/upload", files={"file": ("tiny.wav", f, "audio/wav")}).json()
    job = client.post(
        "/api/jobs", json={"media_file_id": media["id"], "settings": {"model_name": "small"}}
    ).json()
    client.post(f"/api/jobs/{job['id']}/cancel")

    with client.websocket_connect(f"/ws/jobs/{job['id']}") as ws:
        msg = ws.receive_json()
        assert msg["job"]["status"] == "cancelled"


def test_reconnected_snapshot_contains_persisted_segments(client, fixture_path):
    from audiowhisper_core.db import session_scope
    from audiowhisper_core.models import TranscriptSegment

    with open(fixture_path("tiny.wav"), "rb") as f:
        media = client.post("/api/media/upload", files={"file": ("tiny.wav", f, "audio/wav")}).json()
    job = client.post("/api/jobs", json={"media_file_id": media["id"]}).json()
    client.post(f"/api/jobs/{job['id']}/cancel")
    with session_scope() as db:
        segment = TranscriptSegment(job_id=job["id"], segment_index=0, start=1, end=2, text="Confirmado")
        db.add(segment)
        db.commit()

    with client.websocket_connect(f"/ws/jobs/{job['id']}") as ws:
        snapshot = ws.receive_json()
        assert snapshot["segment_count"] == 1
        assert snapshot["segments"][0]["text"] == "Confirmado"
        assert snapshot["segments"][0]["segment_index"] == 0
