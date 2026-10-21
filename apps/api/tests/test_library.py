from audiowhisper_core.db import session_scope
from audiowhisper_core.models import MediaFile, TranscriptionJob, TranscriptSegment


def seed(title, text):
    import uuid
    with session_scope() as db:
        media = MediaFile(original_name=title, stored_name=f"{uuid.uuid4()}.wav", mime_type="audio/wav", extension="wav",
                          size_bytes=44, sha256=uuid.uuid4().hex, media_type="audio")
        db.add(media)
        db.flush()
        job = TranscriptionJob(media_file_id=media.id, status="completed", model_name="tiny", device="cpu", compute_type="int8")
        db.add(job)
        db.flush()
        db.add(TranscriptSegment(job_id=job.id, segment_index=0, start=0, end=1, text=text))
        db.commit()
        return job.id


def test_library_searches_content_and_handles_literal_wildcards(client):
    job_id = seed("infra.wav", "Revisar backup_100% amanhã")
    result = client.get("/api/library", params={"q": "backup_100%"}).json()
    assert [i["job"]["id"] for i in result["items"]] == [job_id]
    assert client.get("/api/library", params={"q": "backup_10_%"}).json()["total"] == 0


def test_library_organization_and_pagination(client):
    job_id = seed("Equipe.wav", "Plano do projeto")
    payload = {"title": "Reunião técnica", "folder": "Reuniões", "project": "Infra", "tags": ["backup", "backup"], "speakers": {"SPEAKER_00": "Ana"}}
    assert client.put(f"/api/library/{job_id}", json=payload).status_code == 200
    result = client.get("/api/library", params={"q": "Reunião técnica", "tag": "backup", "project": "Infra", "limit": 1}).json()
    assert result["total"] == 1
    assert result["items"][0]["tags"] == ["backup"]
    assert client.get("/api/library", params={"q": "Reunião técnica", "offset": 1}).json()["items"] == []
    assert client.get("/api/library", params={"status": "unknown"}).status_code == 422
