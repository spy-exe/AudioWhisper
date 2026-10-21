from pathlib import Path


def test_uploaded_file_stored_by_generated_id_not_original_name(client, unique_wav, settings):
    before = set(settings.uploads_dir.glob("*.wav"))
    with open(unique_wav(), "rb") as f:
        resp = client.post(
            "/api/media/upload",
            files={"file": ("../../../evil name <>.wav", f, "audio/wav")},
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    new_files = set(settings.uploads_dir.glob("*.wav")) - before
    assert len(new_files) == 1
    new_file = new_files.pop()
    assert new_file.name == f"{body['id']}.wav"
    # nothing escaped the uploads directory
    assert new_file.resolve().parent == settings.uploads_dir.resolve()


def test_upload_rejects_file_over_max_size(client, fixture_path, settings, monkeypatch):
    before = set(settings.uploads_dir.glob("*.wav"))
    monkeypatch.setattr(settings, "max_upload_bytes", 100)
    with open(fixture_path("tiny.wav"), "rb") as f:
        resp = client.post("/api/media/upload", files={"file": ("tiny.wav", f, "audio/wav")})
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "FILE_TOO_LARGE"

    # the partial file must not be left behind on disk
    assert set(settings.uploads_dir.glob("*.wav")) == before


def test_upload_control_characters_in_filename_are_stripped(client, fixture_path):
    with open(fixture_path("tiny.wav"), "rb") as f:
        resp = client.post(
            "/api/media/upload",
            files={"file": ("evil\x00\x01name.wav", f, "audio/wav")},
        )
    assert resp.status_code == 200, resp.text
    assert "\x00" not in resp.json()["original_name"]


def test_ws_unknown_job_closes_with_error(client):
    with client.websocket_connect("/ws/jobs/does-not-exist") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "error"
