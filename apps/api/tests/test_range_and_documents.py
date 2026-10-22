import uuid
from unittest.mock import Mock

import pytest
from redis.exceptions import ConnectionError as RedisConnectionError

from audiowhisper_core.db import session_scope
from audiowhisper_core.intelligence import transcript_hash
from audiowhisper_core.models import AIDocument, DocumentShare, LiveSession, TranscriptSegment


@pytest.fixture
def media(client, make_completed_job, settings):
    job = make_completed_job([("Texto", 0, 1)])
    size = (settings.uploads_dir / job["stored_name"]).stat().st_size
    return job["media_id"], size, (settings.uploads_dir / job["stored_name"]).read_bytes()


def test_suffix_range_returns_the_end_of_the_file(client, media):
    media_id, size, data = media
    response = client.get(f"/api/media/{media_id}/stream", headers={"Range": "bytes=-100"})
    assert response.status_code == 206
    assert response.headers["content-range"] == f"bytes {size - 100}-{size - 1}/{size}"
    assert response.content == data[-100:]
    whole = client.get(f"/api/media/{media_id}/stream", headers={"Range": f"bytes=-{size * 2}"})
    assert whole.status_code == 206 and whole.content == data


@pytest.mark.parametrize("header,status", [("bytes=-0", 416), ("bytes=abc", 416), ("bytes=", 416),
                                           ("items=0-10", 416), ("bytes=999999999-", 416)])
def test_invalid_ranges_are_rejected(client, media, header, status):
    media_id, size, _ = media
    response = client.get(f"/api/media/{media_id}/stream", headers={"Range": header})
    assert response.status_code == status
    assert response.headers["content-range"] == f"bytes */{size}"


def test_open_and_multi_ranges(client, media):
    media_id, size, data = media
    tail = client.get(f"/api/media/{media_id}/stream", headers={"Range": "bytes=10-"})
    assert tail.status_code == 206 and tail.content == data[10:]
    multi = client.get(f"/api/media/{media_id}/stream", headers={"Range": "bytes=0-1,5-6"})
    assert multi.status_code == 200 and multi.content == data
    assert multi.headers["accept-ranges"] == "bytes"


def _document(status="generated", text="Precisamos revisar os backups."):
    with session_scope() as db:
        from audiowhisper_core.models import MediaFile, TranscriptionJob, WorkspaceItem
        media = MediaFile(original_name="Comitê.wav", stored_name=f"{uuid.uuid4()}.wav", mime_type="audio/wav", extension="wav",
                          size_bytes=44, sha256=uuid.uuid4().hex, media_type="audio")
        db.add(media)
        db.flush()
        job = TranscriptionJob(media_file_id=media.id, status="completed", model_name="tiny", device="cpu", compute_type="int8")
        db.add(job)
        db.flush()
        db.add(WorkspaceItem(job_id=job.id, title="Comitê de Obras"))
        segment = TranscriptSegment(job_id=job.id, segment_index=0, start=0, end=1, text=text)
        db.add(segment)
        db.flush()
        document = AIDocument(job_id=job.id, kind="minutes", model="local", status=status,
                              markdown="# Ata da reunião\n\n- **Revisar** backups\n  Fontes: 00:00:00",
                              source_hash=transcript_hash([segment], {}))
        db.add(document)
        db.commit()
        return document.id


def test_document_downloads_use_kind_and_recording_title(client):
    document_id = _document()
    response = client.get(f"/api/documents/{document_id}/download", params={"format": "pdf"})
    assert response.status_code == 200
    assert 'filename="Ata da reuniao - Comite de Obras.pdf"' in response.headers["content-disposition"]
    assert response.content.startswith(b"%PDF")
    markdown = client.get(f"/api/documents/{document_id}/download", params={"format": "markdown"})
    assert markdown.headers["content-disposition"].endswith(".md")


def test_documents_can_be_deleted_except_while_generating(client):
    document_id = _document()
    client.put(f"/api/documents/{document_id}", json={"markdown": "Ata revisada", "reviewed": True})
    share = client.post(f"/api/documents/{document_id}/shares", json={"expires_hours": 1}).json()
    assert client.delete(f"/api/documents/{document_id}").status_code == 204
    with session_scope() as db:
        assert db.get(DocumentShare, share["id"]) is None
    assert client.get(f"/api/shared/{share['path'].split('/')[-1]}").status_code == 404
    assert client.delete(f"/api/documents/{document_id}").status_code == 404
    generating = _document(status="generating")
    assert client.delete(f"/api/documents/{generating}").status_code == 409


def test_live_stop_reports_a_queue_outage_but_keeps_the_stop_recorded(client, monkeypatch):
    monkeypatch.setattr("app.routers.live.get_queue", lambda: Mock())
    job = client.post("/api/live", json={"title": "Fila caída", "settings": {"model_name": "small"}}).json()
    broken = Mock()
    broken.enqueue.side_effect = RedisConnectionError("down")
    monkeypatch.setattr("app.routers.live.get_queue", lambda: broken)
    response = client.post(f"/api/live/{job['id']}/stop", json={"expected_chunks": 0, "duration": 3})
    assert response.status_code == 503
    with session_scope() as db:
        session = db.get(LiveSession, job["id"])
        assert (session.status, session.expected_chunks) == ("stopping", 0)
    broken.fetch_job.return_value = None
    assert client.post(f"/api/live/{job['id']}/retry").status_code == 503
    monkeypatch.setattr("app.routers.live.get_queue", lambda: Mock())
    recovered = client.post(f"/api/live/{job['id']}/retry")
    assert recovered.status_code == 202 and recovered.json()["status"] == "recovering"
