import json
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from audiowhisper_core.config import get_settings
from audiowhisper_core.intelligence import OllamaProvider, TEMPLATES, transcript_hash
from audiowhisper_core.models import AIDocument, TranscriptSegment, WorkspaceItem
from app.dependencies import get_db
from app.queue import get_queue
from app.services.job_service import get_job_or_404

router = APIRouter(tags=["intelligence"])


def source_state(db, job_id):
    segments = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.job_id == job_id).order_by(TranscriptSegment.segment_index)))
    item = db.get(WorkspaceItem, job_id)
    speakers = json.loads(item.speakers_json) if item else {}
    return segments, transcript_hash(segments, speakers)


def document_out(document, current_hash):
    return {"id": document.id, "job_id": document.job_id, "kind": document.kind, "model": document.model,
            "status": document.status, "markdown": document.markdown, "items": json.loads(document.content_json),
            "error": document.error, "stale": document.source_hash != current_hash,
            "reviewed_at": document.reviewed_at, "created_at": document.created_at}


def get_document(db, document_id):
    document = db.get(AIDocument, document_id)
    if not document:
        raise HTTPException(404, "Documento não encontrado")
    return document


def require_reviewed(db, document):
    _, current_hash = source_state(db, document.job_id)
    if not document.reviewed_at or document.status != "reviewed" or document.source_hash != current_hash:
        raise HTTPException(409, "Revise o documento com a transcrição atual antes de compartilhar.")


@router.get("/api/intelligence")
def intelligence_status():
    settings = get_settings()
    try:
        models = OllamaProvider(settings.ollama_url, 5).models()
        return {"provider": "ollama", "available": True, "models": models, "templates": TEMPLATES, "error": None}
    except ValueError as exc:
        return {"provider": "ollama", "available": False, "models": [], "templates": TEMPLATES, "error": str(exc)}


class GenerateIn(BaseModel):
    kind: Literal["minutes", "briefing", "summary", "decisions", "actions", "risks", "questions", "email", "custom"]
    model: str = Field(min_length=1, max_length=128)
    instruction: str = Field(default="", max_length=4000)


@router.post("/api/jobs/{job_id}/documents", status_code=202)
def generate_document(job_id: str, payload: GenerateIn, db: Session = Depends(get_db)):
    job = get_job_or_404(db, job_id)
    if job.status != "completed":
        raise HTTPException(409, "Finalize a transcrição antes de gerar um documento.")
    segments, source_hash = source_state(db, job_id)
    if not segments:
        raise HTTPException(409, "A transcrição não tem texto para análise.")
    pending = db.scalar(select(AIDocument).where(AIDocument.job_id == job_id, AIDocument.status.in_(["queued", "generating"])))
    if pending:
        raise HTTPException(409, "Já existe um documento em geração para esta gravação.")
    document = AIDocument(job_id=job_id, kind=payload.kind, model=payload.model, instruction=payload.instruction, source_hash=source_hash)
    db.add(document)
    db.commit()
    try:
        get_queue().enqueue("app.ai_tasks.run_document", document.id, job_id=f"document-{document.id}", job_timeout=7200)
    except Exception:
        document.status, document.error = "failed", "A fila está indisponível. Tente gerar novamente."
        db.commit()
        raise HTTPException(503, document.error)
    return document_out(document, source_hash)


@router.get("/api/jobs/{job_id}/documents")
def list_documents(job_id: str, db: Session = Depends(get_db)):
    get_job_or_404(db, job_id)
    _, current_hash = source_state(db, job_id)
    return [document_out(d, current_hash) for d in db.scalars(select(AIDocument).where(AIDocument.job_id == job_id).order_by(AIDocument.created_at.desc()).limit(50))]


class ReviewIn(BaseModel):
    markdown: str = Field(min_length=1, max_length=200000)
    reviewed: bool = False


@router.put("/api/documents/{document_id}")
def review_document(document_id: str, payload: ReviewIn, db: Session = Depends(get_db)):
    document = get_document(db, document_id)
    _, current_hash = source_state(db, document.job_id)
    if document.status not in ("generated", "reviewed") or document.source_hash != current_hash:
        raise HTTPException(409, "O documento precisa ser gerado com a transcrição atual antes da revisão.")
    document.markdown = payload.markdown
    document.reviewed_at = datetime.now(timezone.utc) if payload.reviewed else None
    document.status = "reviewed" if payload.reviewed else "generated"
    db.commit()
    return document_out(document, current_hash)


@router.delete("/api/documents/{document_id}", status_code=204)
def delete_document(document_id: str, db: Session = Depends(get_db)):
    document = get_document(db, document_id)
    if document.status in ("queued", "generating"):
        raise HTTPException(409, "Aguarde a geração terminar antes de excluir o documento.")
    db.delete(document)  # shares and deliveries cascade: revoked links stop resolving immediately
    db.commit()
