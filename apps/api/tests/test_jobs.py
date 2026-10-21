def _upload_media(client, fixture_path, name="tiny.wav"):
    with open(fixture_path(name), "rb") as f:
        resp = client.post("/api/media/upload", files={"file": (name, f, "audio/wav")})
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _create_job(client, media_id, **overrides):
    payload = {"media_file_id": media_id, "settings": {"model_name": "small", **overrides}}
    return client.post("/api/jobs", json=payload)


def test_create_job(client, fixture_path):
    media_id = _upload_media(client, fixture_path)
    resp = _create_job(client, media_id)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "queued"
    assert body["progress"] == 0.0
    assert body["media_file_id"] == media_id


def test_create_job_missing_media_returns_404(client):
    resp = _create_job(client, "does-not-exist")
    assert resp.status_code == 404


def test_get_and_list_jobs(client, fixture_path):
    media_id = _upload_media(client, fixture_path)
    created = _create_job(client, media_id).json()

    got = client.get(f"/api/jobs/{created['id']}")
    assert got.status_code == 200
    assert got.json()["id"] == created["id"]

    listed = client.get("/api/jobs")
    assert any(j["id"] == created["id"] for j in listed.json())


def test_cancel_queued_job(client, fixture_path):
    media_id = _upload_media(client, fixture_path)
    job = _create_job(client, media_id).json()

    resp = client.post(f"/api/jobs/{job['id']}/cancel")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "cancelled"
    assert resp.json()["cancel_requested"] is True
    assert client.get(f"/api/jobs/{job['id']}").json()["cancel_requested"] is True


def test_cancel_terminal_job_fails(client, fixture_path):
    media_id = _upload_media(client, fixture_path)
    job = _create_job(client, media_id).json()
    client.post(f"/api/jobs/{job['id']}/cancel")

    resp = client.post(f"/api/jobs/{job['id']}/cancel")
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_cancel_running_job_is_cooperative_without_process_signals(client, fixture_path, monkeypatch):
    from unittest.mock import Mock
    import rq.command
    from app.services import job_service

    media_id = _upload_media(client, fixture_path)
    job = _create_job(client, media_id).json()
    running = Mock(worker_name="local-worker")
    running.get_status.return_value = "started"
    monkeypatch.setattr(job_service.RqJob, "fetch", Mock(return_value=running))
    command = Mock()
    monkeypatch.setattr(rq.command, "send_command", command)
    response = client.post(f"/api/jobs/{job['id']}/cancel")
    assert response.status_code == 200
    assert response.json()["cancel_requested"] is True
    command.assert_not_called()


def test_retry_requires_terminal_state(client, fixture_path):
    media_id = _upload_media(client, fixture_path)
    job = _create_job(client, media_id).json()

    resp = client.post(f"/api/jobs/{job['id']}/retry")
    assert resp.status_code == 422


def test_retry_after_cancel_requeues(client, fixture_path):
    media_id = _upload_media(client, fixture_path)
    job = _create_job(client, media_id).json()
    client.post(f"/api/jobs/{job['id']}/cancel")

    resp = client.post(f"/api/jobs/{job['id']}/retry")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "queued"
    assert body["error_code"] is None


def test_job_not_found(client):
    assert client.get("/api/jobs/nope").status_code == 404
    assert client.post("/api/jobs/nope/cancel").status_code == 404
    assert client.post("/api/jobs/nope/retry").status_code == 404
