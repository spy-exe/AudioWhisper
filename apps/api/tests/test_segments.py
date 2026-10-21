def _upload_and_create_job(client, fixture_path):
    with open(fixture_path("tiny.wav"), "rb") as f:
        media = client.post("/api/media/upload", files={"file": ("tiny.wav", f, "audio/wav")}).json()
    job = client.post(
        "/api/jobs", json={"media_file_id": media["id"], "settings": {"model_name": "small"}}
    ).json()
    return media, job


def test_get_segments_empty_before_processing(client, fixture_path):
    _, job = _upload_and_create_job(client, fixture_path)
    resp = client.get(f"/api/jobs/{job['id']}/segments")
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_segments_returns_seeded_data(client, fixture_path, seed_segments):
    _, job = _upload_and_create_job(client, fixture_path)
    seed_segments(job["id"], ["Olá mundo.", "Segundo segmento."])

    resp = client.get(f"/api/jobs/{job['id']}/segments")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    assert body[0]["text"] == "Olá mundo."
    assert body[0]["edited"] is False


def test_patch_segment_marks_edited(client, fixture_path, seed_segments):
    _, job = _upload_and_create_job(client, fixture_path)
    [seg_id, _] = seed_segments(job["id"], ["Original um.", "Original dois."])

    resp = client.patch(
        f"/api/jobs/{job['id']}/segments/{seg_id}", json={"text": "Texto corrigido."}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["text"] == "Texto corrigido."
    assert body["edited"] is True


def test_patch_missing_segment_returns_404(client, fixture_path):
    _, job = _upload_and_create_job(client, fixture_path)
    resp = client.patch(f"/api/jobs/{job['id']}/segments/nope", json={"text": "x"})
    assert resp.status_code == 404


def test_put_transcript_replaces_all_segments(client, fixture_path, seed_segments):
    _, job = _upload_and_create_job(client, fixture_path)
    seed_segments(job["id"], ["Um.", "Dois.", "Três."])

    resp = client.put(
        f"/api/jobs/{job['id']}/transcript",
        json={"segments": [{"text": "A."}, {"text": "B."}, {"text": "C."}]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [s["text"] for s in body] == ["A.", "B.", "C."]
    assert all(s["edited"] for s in body)


def test_put_transcript_length_mismatch_rejected(client, fixture_path, seed_segments):
    _, job = _upload_and_create_job(client, fixture_path)
    seed_segments(job["id"], ["Um.", "Dois."])

    resp = client.put(
        f"/api/jobs/{job['id']}/transcript", json={"segments": [{"text": "Só um."}]}
    )
    assert resp.status_code == 422


def test_segments_survive_reload(client, fixture_path, seed_segments):
    """Simulates the 'edits survive a restart' requirement at the persistence layer:
    a fresh request against the same DB sees the edit."""
    _, job = _upload_and_create_job(client, fixture_path)
    [seg_id] = seed_segments(job["id"], ["Antes."])
    client.patch(f"/api/jobs/{job['id']}/segments/{seg_id}", json={"text": "Depois."})

    fresh = client.get(f"/api/jobs/{job['id']}/segments")
    assert fresh.json()[0]["text"] == "Depois."
