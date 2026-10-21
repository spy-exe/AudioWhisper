def _upload(client, fixture_path, name, content_type="application/octet-stream", as_name=None):
    path = fixture_path(name)
    with open(path, "rb") as f:
        return client.post(
            "/api/media/upload",
            files={"file": (as_name or name, f, content_type)},
        )


def test_upload_valid_wav(client, unique_wav):
    with open(unique_wav(), "rb") as f:
        resp = client.post("/api/media/upload", files={"file": ("tiny.wav", f, "audio/wav")})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["extension"] == "wav"
    assert body["media_type"] == "audio"
    assert body["duration_seconds"] > 0
    assert body["is_duplicate"] is False
    assert len(body["sha256"]) == 64


def test_upload_valid_mp4_detects_video(client, fixture_path):
    resp = _upload(client, fixture_path, "tiny.mp4")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["media_type"] == "video"
    assert body["metadata"]["has_video"] is True
    assert body["metadata"]["has_audio"] is True


def test_upload_rejects_unsupported_extension(client, fixture_path):
    resp = _upload(client, fixture_path, "fake.mp3", as_name="malware.exe")
    assert resp.status_code == 415
    assert resp.json()["error"]["code"] == "UNSUPPORTED_FORMAT"


def test_upload_rejects_disguised_file(client, fixture_path):
    resp = _upload(client, fixture_path, "fake.mp3")
    assert resp.status_code == 415
    body = resp.json()
    assert body["error"]["code"] == "UNSUPPORTED_FORMAT"
    assert "detected_mime" in body["error"]["details"]


def test_upload_rejects_file_without_audio_track(client, fixture_path):
    resp = _upload(client, fixture_path, "novoice.mp4")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "NO_AUDIO_TRACK"


def test_upload_rejects_corrupt_file(client, fixture_path):
    resp = _upload(client, fixture_path, "corrupt.wav")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "FFPROBE_FAILED"


def test_upload_flags_duplicate_by_hash(client, fixture_path):
    first = _upload(client, fixture_path, "tiny.mp3")
    assert first.status_code == 200
    second = _upload(client, fixture_path, "tiny.mp3", as_name="copy-of-tiny.mp3")
    assert second.status_code == 200
    body = second.json()
    assert body["is_duplicate"] is True
    assert body["id"] == first.json()["id"]


def test_upload_sanitizes_path_traversal_filename(client, fixture_path):
    resp = _upload(client, fixture_path, "tiny.wav", as_name="../../../etc/passwd.wav")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "/" not in body["original_name"]
    assert ".." not in body["original_name"]


def test_get_and_list_media(client, fixture_path):
    upload = _upload(client, fixture_path, "tiny.wav")
    media_id = upload.json()["id"]

    got = client.get(f"/api/media/{media_id}")
    assert got.status_code == 200
    assert got.json()["id"] == media_id

    listed = client.get("/api/media")
    assert listed.status_code == 200
    assert any(m["id"] == media_id for m in listed.json())


def test_get_missing_media_returns_404(client):
    resp = client.get("/api/media/does-not-exist")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_stream_media_returns_file_content(client, fixture_path):
    upload = _upload(client, fixture_path, "tiny.wav")
    media_id = upload.json()["id"]

    resp = client.get(f"/api/media/{media_id}/stream")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "audio/x-wav"
    assert resp.headers.get("accept-ranges") == "bytes"
    assert len(resp.content) == fixture_path("tiny.wav").stat().st_size


def test_stream_media_supports_range_requests(client, fixture_path):
    upload = _upload(client, fixture_path, "tiny.wav")
    media_id = upload.json()["id"]

    resp = client.get(f"/api/media/{media_id}/stream", headers={"Range": "bytes=0-99"})
    assert resp.status_code == 206
    assert len(resp.content) == 100
    assert resp.headers["content-range"].startswith("bytes 0-99/")


def test_stream_missing_media_returns_404(client):
    resp = client.get("/api/media/does-not-exist/stream")
    assert resp.status_code == 404


def test_delete_media(client, fixture_path):
    upload = _upload(client, fixture_path, "tiny.wav")
    media_id = upload.json()["id"]
    resp = client.delete(f"/api/media/{media_id}")
    assert resp.status_code == 204
    assert client.get(f"/api/media/{media_id}").status_code == 404
