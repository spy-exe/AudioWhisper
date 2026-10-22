def test_bookmark_crud_and_ordering(client, make_completed_job):
    job = make_completed_job([("Abertura", 0, 5), ("Decisão importante", 5, 10)])
    url = f"/api/jobs/{job['job_id']}/bookmarks"
    later = client.post(url, json={"start": 7.5, "label": "  Decisão  ", "note": "Confirmar com o time", "color": "violet",
                                   "segment_id": job["segment_ids"][1]})
    assert later.status_code == 201, later.text
    assert later.json()["label"] == "Decisão"
    earlier = client.post(url, json={"start": 1, "label": "Abertura"}).json()
    assert earlier["color"] == "amber" and earlier["note"] == ""
    assert [b["label"] for b in client.get(url).json()] == ["Abertura", "Decisão"]

    patched = client.patch(f"/api/bookmarks/{earlier['id']}", json={"label": "Boas-vindas", "start": 2, "color": "blue"})
    assert patched.status_code == 200
    assert (patched.json()["label"], patched.json()["start"], patched.json()["color"]) == ("Boas-vindas", 2, "blue")
    assert client.delete(f"/api/bookmarks/{earlier['id']}").status_code == 204
    assert [b["id"] for b in client.get(url).json()] == [later.json()["id"]]
    assert client.delete(f"/api/bookmarks/{earlier['id']}").status_code == 404


def test_bookmark_validation(client, make_completed_job):
    job = make_completed_job([("Texto", 0, 5)], duration=60)
    other = make_completed_job([("Outro", 0, 5)])
    url = f"/api/jobs/{job['job_id']}/bookmarks"
    assert client.post(url, json={"start": 1, "label": "   "}).status_code == 422
    assert client.post(url, json={"start": -1, "label": "x"}).status_code == 422
    assert client.post(url, json={"start": 1, "label": "x", "color": "neon"}).status_code == 422
    beyond = client.post(url, json={"start": 120, "label": "Depois do fim"})
    assert beyond.status_code == 422
    assert beyond.json()["error"]["details"]["duration_seconds"] == 60
    foreign = client.post(url, json={"start": 1, "label": "x", "segment_id": other["segment_ids"][0]})
    assert foreign.status_code == 404
    created = client.post(url, json={"start": 1, "label": "ok"}).json()
    assert client.patch(f"/api/bookmarks/{created['id']}", json={"label": "  "}).status_code == 422
    assert client.patch(f"/api/bookmarks/{created['id']}", json={"start": 500}).status_code == 422
    assert client.patch("/api/bookmarks/nao-existe", json={"label": "x"}).status_code == 404
    assert client.get("/api/jobs/nao-existe/bookmarks").status_code == 404


def test_bookmark_limit_per_job(client, make_completed_job, monkeypatch):
    from app.routers import bookmarks
    monkeypatch.setattr(bookmarks, "MAX_BOOKMARKS_PER_JOB", 2)
    job = make_completed_job([("Texto", 0, 5)])
    url = f"/api/jobs/{job['job_id']}/bookmarks"
    for i in range(2):
        assert client.post(url, json={"start": i, "label": f"m{i}"}).status_code == 201
    response = client.post(url, json={"start": 3, "label": "excesso"})
    assert response.status_code == 422
    assert "Limite" in response.json()["error"]["message"]


def test_bookmarks_are_removed_with_the_recording(client, make_completed_job):
    job = make_completed_job([("Texto", 0, 5)])
    bookmark = client.post(f"/api/jobs/{job['job_id']}/bookmarks", json={"start": 1, "label": "x"}).json()
    assert client.delete(f"/api/jobs/{job['job_id']}").status_code == 204
    assert client.patch(f"/api/bookmarks/{bookmark['id']}", json={"label": "y"}).status_code == 404
