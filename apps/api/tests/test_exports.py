def _job_with_segments(client, fixture_path, seed_segments):
    with open(fixture_path("tiny.wav"), "rb") as f:
        media = client.post("/api/media/upload", files={"file": ("tiny.wav", f, "audio/wav")}).json()
    job = client.post(
        "/api/jobs", json={"media_file_id": media["id"], "settings": {"model_name": "small"}}
    ).json()
    seed_segments(job["id"], ["Primeira frase de teste.", "Segunda frase de teste."])
    return job


def test_generate_all_export_formats(client, fixture_path, seed_segments):
    job = _job_with_segments(client, fixture_path, seed_segments)

    resp = client.post(
        f"/api/jobs/{job['id']}/exports",
        json={"formats": ["txt", "markdown", "json", "srt", "vtt"]},
    )
    assert resp.status_code == 200, resp.text
    exports = resp.json()
    assert {e["format"] for e in exports} == {"txt", "markdown", "json", "srt", "vtt"}
    assert all(e["size_bytes"] > 0 for e in exports)


def test_list_exports(client, fixture_path, seed_segments):
    job = _job_with_segments(client, fixture_path, seed_segments)
    client.post(f"/api/jobs/{job['id']}/exports", json={"formats": ["txt"]})

    resp = client.get(f"/api/jobs/{job['id']}/exports")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["format"] == "txt"


def test_download_srt_contains_valid_cues(client, fixture_path, seed_segments):
    job = _job_with_segments(client, fixture_path, seed_segments)
    export = client.post(f"/api/jobs/{job['id']}/exports", json={"formats": ["srt"]}).json()[0]

    resp = client.get(f"/api/exports/{export['id']}/download")
    assert resp.status_code == 200
    assert "-->" in resp.text
    assert "Primeira frase de teste." in resp.text
    assert resp.headers["content-type"].startswith("application/x-subrip")


def test_download_vtt_starts_with_webvtt_header(client, fixture_path, seed_segments):
    job = _job_with_segments(client, fixture_path, seed_segments)
    export = client.post(f"/api/jobs/{job['id']}/exports", json={"formats": ["vtt"]}).json()[0]

    resp = client.get(f"/api/exports/{export['id']}/download")
    assert resp.text.startswith("WEBVTT")


def test_download_json_is_structured(client, fixture_path, seed_segments):
    job = _job_with_segments(client, fixture_path, seed_segments)
    export = client.post(f"/api/jobs/{job['id']}/exports", json={"formats": ["json"]}).json()[0]

    resp = client.get(f"/api/exports/{export['id']}/download")
    payload = resp.json()
    assert len(payload["segments"]) == 2
    assert payload["segments"][0]["text"] == "Primeira frase de teste."


def test_markdown_includes_metadata_table(client, fixture_path, seed_segments):
    job = _job_with_segments(client, fixture_path, seed_segments)
    export = client.post(f"/api/jobs/{job['id']}/exports", json={"formats": ["markdown"]}).json()[0]

    resp = client.get(f"/api/exports/{export['id']}/download")
    assert "| Idioma |" in resp.text
    assert "| Modelo |" in resp.text


def test_download_missing_export_returns_404(client):
    resp = client.get("/api/exports/does-not-exist/download")
    assert resp.status_code == 404


def test_download_rejects_path_traversal_in_stored_path(client, fixture_path, seed_segments, settings):
    """Defence in depth: even if an ExportFile row somehow pointed outside the exports dir,
    the download endpoint must refuse to serve it."""
    job = _job_with_segments(client, fixture_path, seed_segments)

    from audiowhisper_core.db import session_scope
    from audiowhisper_core.models import ExportFile

    with session_scope() as db:
        malicious = ExportFile(
            id="malicious-export",
            job_id=job["id"],
            format="txt",
            path="../../../../etc/passwd",
            size_bytes=10,
        )
        db.add(malicious)

    resp = client.get("/api/exports/malicious-export/download")
    assert resp.status_code == 404
