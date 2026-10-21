import hashlib
import json
import re
import secrets
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from audiowhisper_core.config import get_settings
from audiowhisper_core.models import DocumentDelivery, DocumentShare
from app.dependencies import get_db
from app.routers.documents import get_document, require_reviewed

router = APIRouter(tags=["sharing"])


class ShareIn(BaseModel):
    expires_hours: int = Field(default=24, ge=1, le=720)


@router.post("/api/documents/{document_id}/shares")
def create_share(document_id: str, payload: ShareIn, db: Session = Depends(get_db)):
    document = get_document(db, document_id)
    require_reviewed(db, document)
    token = secrets.token_urlsafe(32)
    share = DocumentShare(document_id=document.id, token_hash=hashlib.sha256(token.encode()).hexdigest(),
                          expires_at=datetime.now(timezone.utc) + timedelta(hours=payload.expires_hours))
    db.add(share)
    db.commit()
    return {"id": share.id, "path": f"/shared/{token}", "expires_at": share.expires_at}


@router.get("/api/documents/{document_id}/shares")
def list_shares(document_id: str, db: Session = Depends(get_db)):
    get_document(db, document_id)
    return [{"id": s.id, "expires_at": s.expires_at, "revoked": s.revoked} for s in db.scalars(select(DocumentShare).where(DocumentShare.document_id == document_id).order_by(DocumentShare.created_at.desc()).limit(100))]


@router.delete("/api/shares/{share_id}")
def revoke_share(share_id: str, db: Session = Depends(get_db)):
    share = db.get(DocumentShare, share_id)
    if not share:
        raise HTTPException(404, "Link não encontrado")
    share.revoked = True
    db.commit()
    return {"revoked": True}


@router.get("/api/shared/{token}")
def read_shared(token: str, db: Session = Depends(get_db)):
    share = db.scalar(select(DocumentShare).where(DocumentShare.token_hash == hashlib.sha256(token.encode()).hexdigest()))
    if not share or share.revoked or share.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
        raise HTTPException(404, "Link expirado ou revogado")
    document = get_document(db, share.document_id)
    require_reviewed(db, document)
    return Response(json.dumps({"markdown": document.markdown, "expires_at": share.expires_at.isoformat()}, ensure_ascii=False),
                    media_type="application/json", headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow"})


@router.get("/api/documents/{document_id}/download")
def download_document(document_id: str, format: Literal["pdf", "docx", "markdown", "txt", "json"] = "markdown", db: Session = Depends(get_db)):
    document = get_document(db, document_id)
    if document.status not in ("generated", "reviewed"):
        raise HTTPException(409, "O documento ainda não está pronto.")
    if format in ("pdf", "docx"):
        from audiowhisper_core.document_exports import export_document
        content = export_document(format, "AudioWhisper", document.markdown)
        mime = "application/pdf" if format == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif format == "json":
        content = json.dumps({"markdown": document.markdown, "items": json.loads(document.content_json)}, ensure_ascii=False)
        mime = "application/json"
    else:
        content, mime = document.markdown, "text/plain; charset=utf-8"
    extension = "md" if format == "markdown" else format
    return Response(content, media_type=mime, headers={"Content-Disposition": f'attachment; filename="audiowhisper.{extension}"', "Cache-Control": "no-store"})


@router.get("/api/integrations")
def integrations():
    settings = get_settings()
    return {"smtp_available": bool(settings.smtp_host and settings.smtp_from), "diarization_configured": bool(settings.hf_token or settings.diarization_model != "pyannote/speaker-diarization-community-1")}


class EmailIn(BaseModel):
    recipient: str = Field(min_length=3, max_length=254)
    subject: str = Field(min_length=1, max_length=200)
    request_id: UUID


@router.post("/api/documents/{document_id}/email")
def send_email(document_id: str, payload: EmailIn, db: Session = Depends(get_db)):
    document = get_document(db, document_id)
    require_reviewed(db, document)
    if not re.fullmatch(r"[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+", payload.recipient) or any(c in payload.subject for c in "\r\n"):
        raise HTTPException(422, "Informe um destinatário e assunto válidos.")
    settings = get_settings()
    if not settings.smtp_host or not settings.smtp_from:
        raise HTTPException(503, "Configure SMTP_HOST e SMTP_FROM no servidor.")
    digest = hashlib.sha256(json.dumps([document_id, document.markdown, payload.recipient, payload.subject]).encode()).hexdigest()
    existing = db.get(DocumentDelivery, str(payload.request_id))
    if existing:
        if existing.payload_hash != digest:
            raise HTTPException(409, "A identificação deste envio já foi usada com outro conteúdo.")
        return {"status": existing.status}
    delivery = DocumentDelivery(id=str(payload.request_id), document_id=document_id, payload_hash=digest, status="sending")
    db.add(delivery)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Este envio já está em andamento. Não o repita.")
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = settings.smtp_from, payload.recipient, payload.subject
    message.set_content(document.markdown)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
            if settings.smtp_starttls:
                smtp.starttls(context=ssl.create_default_context())
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password or "")
            smtp.send_message(message)
        delivery.status = "sent"
    except (OSError, smtplib.SMTPException):
        delivery.status = "uncertain"
    db.commit()
    return {"status": delivery.status}
