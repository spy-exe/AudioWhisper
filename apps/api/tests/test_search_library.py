import uuid

from audiowhisper_core.db import session_scope
from audiowhisper_core.models import AIDocument


def _unique(word):
    return f"{word}{uuid.uuid4().hex[:6]}"


def test_library_search_ignores_accents_and_case_and_returns_snippets(client, make_completed_job):
    marker = _unique("Orcamento")
    job = make_completed_job([
        ("Abertura sem relação.", 0, 3),
        (f"Precisamos aprovar o {marker.replace('Orc', 'orç')} da área de produto até sexta.", 3, 8, {"speaker": "S1"}),
    ], speakers={"S1": "Ana"})
    result = client.get("/api/library", params={"q": marker.upper()}).json()
    assert [item["job"]["id"] for item in result["items"]] == [job["job_id"]]
    item = result["items"][0]
    assert item["match_count"] == 1
    match = item["matches"][0]
    assert match["segment_id"] == job["segment_ids"][1] and match["start"] == 3
    assert match["match"].lower() == marker.replace("Orc", "orç").lower()
    assert match["before"].endswith("aprovar o ")
    assert "sexta" in match["after"]


def test_library_title_search_is_accent_insensitive(client, make_completed_job):
    title = _unique("Reunião de Diretoria ")
    job = make_completed_job([("Texto qualquer", 0, 1)], title=title)
    folded = title.replace("ã", "a").lower()
    result = client.get("/api/library", params={"q": folded}).json()
    assert [i["job"]["id"] for i in result["items"]] == [job["job_id"]]
    assert result["items"][0]["matches"] == []


def test_library_sorting(client, make_completed_job):
    folder = _unique("ordem")
    short = make_completed_job([("a", 0, 1)], title="Beta", folder=folder, duration=10)
    long = make_completed_job([("b", 0, 1)], title="alfa", folder=folder, duration=300)
    unknown = make_completed_job([("c", 0, 1)], title="Gama", folder=folder, duration=0)

    def order(sort):
        return [i["job"]["id"] for i in client.get("/api/library", params={"folder": folder, "sort": sort}).json()["items"]]
    assert order("recent") == [unknown["job_id"], long["job_id"], short["job_id"]]
    assert order("oldest") == [short["job_id"], long["job_id"], unknown["job_id"]]
    assert order("name") == [long["job_id"], short["job_id"], unknown["job_id"]]
    assert order("duration")[:2] == [long["job_id"], short["job_id"]]
    assert client.get("/api/library", params={"sort": "random"}).status_code == 422


def test_facets_list_existing_folders_projects_and_tags(client, make_completed_job):
    folder, tag = _unique("Pasta"), _unique("tag")
    make_completed_job([("a", 0, 1)], title="x", folder=folder, project="Infra", tags=[tag, "comum"])
    make_completed_job([("b", 0, 1)], title="y", folder=folder, tags=[tag])
    facets = client.get("/api/library/facets").json()
    assert {"value": folder, "count": 2} in facets["folders"]
    assert any(p["value"] == "Infra" for p in facets["projects"])
    assert {"value": tag, "count": 2} in facets["tags"]
    assert all(entry["value"] for entry in facets["folders"])


def test_library_stats_count_distinct_media_once(client, make_completed_job):
    before = client.get("/api/library/stats").json()
    job = make_completed_job([("um dois três", 0, 1), ("quatro cinco", 1, 2)], duration=90)
    rerun = client.post(f"/api/jobs/{job['job_id']}/retranscribe", json={"model_name": "small"}).json()
    with session_scope() as db:
        db.add(AIDocument(job_id=job["job_id"], kind="summary", model="m", status="reviewed", source_hash="h"))
    after = client.get("/api/library/stats").json()
    assert after["recordings"] == before["recordings"] + 2
    assert after["completed"] == before["completed"] + 1
    assert after["active"] == before["active"] + 1
    assert after["words"] == before["words"] + 5
    assert round(after["transcribed_seconds"] - before["transcribed_seconds"], 2) == 90
    assert after["documents"] == before["documents"] + 1
    assert after["last_7_days"] >= 2
    client.post(f"/api/jobs/{rerun['id']}/cancel")


def test_bulk_organize_and_delete_report_each_item(client, make_completed_job):
    folder = _unique("Lote")
    first = make_completed_job([("a", 0, 1)], tags=["antiga"], title="Primeira")
    second = make_completed_job([("b", 0, 1)])
    running = make_completed_job([("c", 0, 1)], status="transcribing")
    organized = client.post("/api/library/bulk", json={"action": "organize", "job_ids": [first["job_id"], second["job_id"]],
                                                        "folder": folder, "add_tags": ["revisar", "antiga"]}).json()
    assert organized["done"] == [first["job_id"], second["job_id"]]
    assert client.get(f"/api/library/{first['job_id']}").json()["tags"] == ["antiga", "revisar"]
    assert client.get(f"/api/library/{second['job_id']}").json()["folder"] == folder

    deleted = client.post("/api/library/bulk", json={"action": "delete",
                                                     "job_ids": [first["job_id"], running["job_id"], "nao-existe"]}).json()
    assert deleted["done"] == [first["job_id"]]
    assert {s["job_id"] for s in deleted["skipped"]} == {running["job_id"], "nao-existe"}
    assert client.get(f"/api/jobs/{running['job_id']}").status_code == 200
    assert client.post("/api/library/bulk", json={"action": "archive", "job_ids": ["x"]}).status_code == 422
    assert client.post("/api/library/bulk", json={"action": "delete", "job_ids": []}).status_code == 422


def test_global_search_lists_every_moment_with_titles_and_speakers(client, make_completed_job):
    term = _unique("Kubernetes")
    first = make_completed_job([(f"Migrar para {term} em março.", 12, 15, {"speaker": "S1"})], title="Infra", speakers={"S1": "Ana"})
    second = make_completed_job([("Nada aqui.", 0, 1), (f"O {term.lower()} já está pronto?", 30, 33)], name="planejamento.wav")
    make_completed_job([(f"{term} ainda processando", 0, 1)], status="transcribing")
    result = client.get("/api/search", params={"q": term}).json()
    assert result["total"] == 2
    hits = {hit["job_id"]: hit for hit in result["hits"]}
    assert hits[first["job_id"]]["speaker"] == "Ana" and hits[first["job_id"]]["title"] == "Infra"
    assert hits[second["job_id"]]["title"] == "planejamento.wav" and hits[second["job_id"]]["start"] == 30
    assert hits[second["job_id"]]["snippet"]["match"] == term.lower()
    page = client.get("/api/search", params={"q": term, "limit": 1, "offset": 1}).json()
    assert len(page["hits"]) == 1 and page["total"] == 2


def test_global_search_validation_and_literal_wildcards(client, make_completed_job):
    assert client.get("/api/search", params={"q": "a"}).status_code == 422
    assert client.get("/api/search", params={"q": "  "}).status_code == 422
    assert client.get("/api/search").status_code == 422
    marker = _unique("taxa")
    make_completed_job([(f"{marker} de 100% confirmada", 0, 1)])
    assert client.get("/api/search", params={"q": f"{marker} de 100%"}).json()["total"] == 1
    assert client.get("/api/search", params={"q": f"{marker}_de"}).json()["total"] == 0
