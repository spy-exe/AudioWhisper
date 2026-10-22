import json
import uuid

from audiowhisper_core.db import session_scope
from audiowhisper_core.models import MediaFile, TranscriptionJob, TranscriptSegment, WorkspaceItem


def seed(project=None, text="Ana revisará os alertas de backup_200% amanhã."):
    with session_scope() as db:
        media = MediaFile(original_name="Reunião de infraestrutura.wav", stored_name=f"{uuid.uuid4()}.wav", mime_type="audio/wav",
                          extension="wav", size_bytes=44, sha256=uuid.uuid4().hex, media_type="audio", duration_seconds=120)
        db.add(media)
        db.flush()
        job = TranscriptionJob(media_file_id=media.id, status="completed", model_name="tiny", device="cpu", compute_type="int8")
        db.add(job)
        db.flush()
        segment = TranscriptSegment(job_id=job.id, segment_index=0, start=12, end=18, text=text, speaker_id="s1")
        db.add(segment)
        if project:
            db.add(WorkspaceItem(job_id=job.id, project=project, speakers_json=json.dumps({"s1": "Ana"})))
        db.flush()
        return job.id, segment.id


def test_projects_include_legacy_organization_and_preserve_recordings(client):
    name = f"Infra-{uuid.uuid4().hex}"
    job, _ = seed(name)
    result = client.get("/api/projects", params={"q": name}).json()
    assert result["total"] == 1
    assert result["items"][0]["recording_count"] == 1
    assert result["items"][0]["duration_seconds"] == 120
    response = client.put(f"/api/projects/{name}", json={"description": "Confiabilidade", "color": "amber"})
    assert response.status_code == 200
    detail = client.get(f"/api/projects/{name}").json()
    assert detail["description"] == "Confiabilidade"
    assert detail["participants"] == ["Ana"]
    assert detail["recordings"]["items"][0]["job"]["id"] == job


def test_project_creation_rejects_duplicate_blank_and_invalid_color(client):
    payload = {"name": f"Produto-{uuid.uuid4().hex}", "description": "Lançamento", "color": "violet"}
    assert client.post("/api/projects", json=payload).status_code == 201
    assert client.post("/api/projects", json=payload).status_code == 409
    assert client.post("/api/projects", json={**payload, "name": "  "}).status_code == 422
    assert client.post("/api/projects", json={**payload, "color": "red"}).status_code == 422
    assert client.get("/api/projects/inexistente").status_code == 404


def test_evidence_search_returns_exact_sources_and_isolates_project_speaker_and_page(client):
    name = f"Search-{uuid.uuid4().hex}"
    job, segment = seed(name)
    seed(f"Outro-{uuid.uuid4().hex}")
    query = {"q": "backup_200%", "project": name, "speaker": "Ana", "limit": 1}
    response = client.get("/api/search", params=query)
    assert response.status_code == 200
    page = response.json()
    assert page["total"] == 1
    item = page["items"][0]
    assert (item["job_id"], item["segment_id"], item["start"], item["speaker"]) == (job, segment, 12, "Ana")
    assert "backup_200%" in item["text"]
    assert client.get("/api/search", params={**query, "offset": 1}).json()["items"] == []
    assert client.get("/api/search", params={**query, "q": "backup_20_%"}).json()["total"] == 0
    assert client.get("/api/search", params={**query, "speaker": "Pessoa ausente"}).json()["total"] == 0
    assert client.get("/api/search", params={"q": ""}).json()["items"] == []
    assert client.get("/api/search", params={"q": "a", "limit": 10000}).status_code == 422
