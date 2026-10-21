import gc
import json
from sqlalchemy import select
from audiowhisper_core.config import get_settings
from audiowhisper_core.db import session_scope
from audiowhisper_core.intelligence import OllamaProvider, document_markdown, evidence_batches, transcript_hash
from audiowhisper_core.models import AIDocument, TranscriptSegment, WorkspaceItem


def run_document(document_id):
    settings = get_settings()
    with session_scope() as db:
        document = db.get(AIDocument, document_id)
        if not document or document.status not in ("queued", "failed"):
            return
        try:
            document.status, document.error = "generating", None
            db.commit()
            from app.tasks import get_model_manager
            manager = get_model_manager(settings)
            manager.current = None
            gc.collect()  # Release faster-whisper before a local LLM requests GPU memory.
            segments = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.job_id == document.job_id).order_by(TranscriptSegment.segment_index)))
            organization = db.get(WorkspaceItem, document.job_id)
            speakers = json.loads(organization.speakers_json) if organization else {}
            if transcript_hash(segments, speakers) != document.source_hash:
                raise ValueError("A transcrição mudou. Gere um novo documento com o texto atualizado.")
            # Process every segment; never silently truncate long meetings to a context window.
            batches = evidence_batches(segments, speakers)
            provider = OllamaProvider(settings.ollama_url, settings.ollama_timeout_seconds)
            items = []
            for batch in batches:
                items.extend(item.model_dump() for item in provider.generate(document.model, document.kind, document.instruction, batch, speakers).items)
            # Re-read sources before persisting, in case the user edited during inference.
            db.expire_all()
            fresh = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.job_id == document.job_id).order_by(TranscriptSegment.segment_index)))
            organization = db.get(WorkspaceItem, document.job_id)
            names = json.loads(organization.speakers_json) if organization else {}
            if transcript_hash(fresh, names) != document.source_hash:
                raise ValueError("O texto-fonte foi editado durante a geração. Gere novamente.")
            document.content_json = json.dumps(items, ensure_ascii=False)
            document.markdown = document_markdown(document.kind, items, fresh)
            document.status = "generated"
            db.commit()
        except Exception as exc:
            db.rollback()
            document = db.get(AIDocument, document_id)
            document.status = "failed"
            document.error = str(exc) if isinstance(exc, ValueError) else "Falha na geração local. Verifique o serviço e tente novamente."
            db.commit()
