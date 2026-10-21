import json
import uuid
import smtplib
from unittest.mock import MagicMock
import pytest
from audiowhisper_core.db import session_scope
from audiowhisper_core.intelligence import transcript_hash
from audiowhisper_core.models import AIDocument, MediaFile, TranscriptionJob, TranscriptSegment


@pytest.fixture
def document_id():
    with session_scope() as db:
        media = MediaFile(original_name="Reunião.wav", stored_name=f"{uuid.uuid4()}.wav", mime_type="audio/wav", extension="wav", size_bytes=44, sha256=uuid.uuid4().hex, media_type="audio")
        db.add(media)
        db.flush()
        job = TranscriptionJob(media_file_id=media.id, status="completed", model_name="tiny", device="cpu", compute_type="int8")
        db.add(job)
        db.flush()
        segment = TranscriptSegment(job_id=job.id, segment_index=0, start=0, end=1, text="Precisamos revisar os backups.")
        db.add(segment)
        db.flush()
        document = AIDocument(job_id=job.id, kind="minutes", model="local", status="generated", markdown="# Ata\nRevisar os backups.", source_hash=transcript_hash([segment]))
        db.add(document)
        db.commit()
        return document.id


def test_sharing_requires_review_and_revocation_removes_access(client, document_id):
    assert client.post(f"/api/documents/{document_id}/shares", json={}).status_code == 409
    review = client.put(f"/api/documents/{document_id}", json={"markdown": "# Ata\nRevisar os backups.", "reviewed": True})
    assert review.status_code == 200
    share = client.post(f"/api/documents/{document_id}/shares", json={"expires_hours": 1}).json()
    token = share["path"].split("/")[-1]
    public = client.get(f"/api/shared/{token}")
    assert public.status_code == 200
    assert set(public.json()) == {"markdown", "expires_at"}
    assert public.headers["cache-control"] == "no-store"
    assert client.delete(f"/api/shares/{share['id']}").status_code == 200
    assert client.get(f"/api/shared/{token}").status_code == 404


def test_source_edits_invalidate_review_and_public_link(client, document_id):
    client.put(f"/api/documents/{document_id}", json={"markdown": "Ata revisada", "reviewed": True})
    share = client.post(f"/api/documents/{document_id}/shares", json={}).json()
    with session_scope() as db:
        document = db.get(AIDocument, document_id)
        segment = db.query(TranscriptSegment).filter_by(job_id=document.job_id).first()
        segment.text = "A conversa foi corrigida."
        db.commit()
    assert client.get("/api/" + share["path"].lstrip("/")).status_code == 409
    assert client.post(f"/api/documents/{document_id}/shares", json={}).status_code == 409


def test_document_exports_support_accents_and_escape_markup(client, document_id):
    pdf = client.get(f"/api/documents/{document_id}/download?format=pdf")
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF-")
    docx = client.get(f"/api/documents/{document_id}/download?format=docx")
    assert docx.status_code == 200
    assert docx.content.startswith(b"PK")
    from docx import Document
    from io import BytesIO
    assert any("backups" in p.text for p in Document(BytesIO(docx.content)).paragraphs)


def test_login_protects_api_and_cookie_authenticates_media_requests(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "access_token", "a-long-local-access-token")
    client.cookies.clear()
    assert client.get("/api/library").status_code == 401
    assert client.post("/api/session", json={"token": "wrong"}).status_code == 401
    response = client.post("/api/session", json={"token": "a-long-local-access-token"})
    assert "HttpOnly" in response.headers["set-cookie"]
    assert client.get("/api/library").status_code == 200
    assert client.delete("/api/session").status_code == 200
    assert client.get("/api/library").status_code == 401


def test_email_requires_review_before_contacting_smtp(client, document_id, monkeypatch):
    smtp = MagicMock(side_effect=AssertionError("A draft must not be sent"))
    monkeypatch.setattr("app.routers.sharing.smtplib.SMTP", smtp)
    response = client.post(f"/api/documents/{document_id}/email", json={
        "recipient": "person@example.test", "subject": "Ata", "request_id": str(uuid.uuid4()),
    })
    assert response.status_code == 409
    smtp.assert_not_called()


@pytest.mark.parametrize("uncertain", [False, True])
def test_email_delivery_is_idempotent_even_when_the_result_is_uncertain(client, document_id, settings, monkeypatch, uncertain):
    client.put(f"/api/documents/{document_id}", json={"markdown": "# Ata\nRevisar os backups.", "reviewed": True})
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "smtp_from", "studio@example.test")
    monkeypatch.setattr(settings, "smtp_username", "studio")
    monkeypatch.setattr(settings, "smtp_password", "test-only-password")
    monkeypatch.setattr(settings, "smtp_starttls", True)
    connection = MagicMock()
    connection.__enter__.return_value = connection
    if uncertain:
        connection.send_message.side_effect = smtplib.SMTPServerDisconnected("Connection lost after sending")
    smtp = MagicMock(return_value=connection)
    monkeypatch.setattr("app.routers.sharing.smtplib.SMTP", smtp)
    payload = {"recipient": "person@example.test", "subject": "Ata", "request_id": str(uuid.uuid4())}
    url = f"/api/documents/{document_id}/email"
    expected = "uncertain" if uncertain else "sent"
    first = client.post(url, json=payload)
    assert first.status_code == 200
    assert first.json()["status"] == expected
    assert client.post(url, json=payload).json()["status"] == expected
    assert client.post(url, json={**payload, "recipient": "another@example.test"}).status_code == 409
    smtp.assert_called_once()
    connection.starttls.assert_called_once()
    connection.login.assert_called_once_with("studio", "test-only-password")
    connection.send_message.assert_called_once()
