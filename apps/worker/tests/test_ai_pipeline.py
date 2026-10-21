import json
from types import SimpleNamespace
from audiowhisper_core.db import session_scope
from audiowhisper_core.intelligence import EvidenceOutput, transcript_hash
from audiowhisper_core.models import AIDocument, TranscriptSegment
from app.ai_tasks import run_document


def test_ai_documents_keep_validated_sources_and_unknown_fields(make_media_and_job, monkeypatch):
    _, job = make_media_and_job("speech.wav")
    with session_scope() as db:
        segment = TranscriptSegment(job_id=job.id, segment_index=0, start=0, end=2, text="Precisamos revisar os backups.")
        db.add(segment)
        db.flush()
        source_id = segment.id
        document = AIDocument(job_id=job.id, kind="minutes", model="local", source_hash=transcript_hash([segment]))
        db.add(document)
        db.commit()
        document_id = document.id
    output = EvidenceOutput.model_validate({"items": [{"kind": "action", "text": "Revisar os backups", "source_segment_ids": [source_id], "evidence_quotes": ["revisar os backups"], "assignee": None, "due_date": None}]})
    monkeypatch.setattr("app.ai_tasks.OllamaProvider", lambda *a: SimpleNamespace(generate=lambda *a: output))
    run_document(document_id)
    with session_scope() as db:
        document = db.get(AIDocument, document_id)
        assert document.status == "generated"
        assert json.loads(document.content_json)[0]["source_segment_ids"] == [source_id]
        assert "Não definido na conversa" in document.markdown
        assert document.reviewed_at is None


def test_document_pipeline_persists_original_quotes_from_model_selected_segments(make_media_and_job, monkeypatch):
    from audiowhisper_core.intelligence import OllamaProvider
    _, job = make_media_and_job("speech.wav")
    text = " Precisamos revisar os backups…\nantes da próxima reunião. "
    with session_scope() as db:
        segment = TranscriptSegment(job_id=job.id, segment_index=0, start=0, end=2, text=text)
        db.add(segment)
        db.flush()
        source_id = segment.id
        document = AIDocument(job_id=job.id, kind="summary", model="local", source_hash=transcript_hash([segment]))
        db.add(document)
        db.flush()
        document_id = document.id

    def respond(self, path, payload=None):
        if path == "/api/tags":
            return {"models": [{"name": "local"}]}
        return {"message": {"content": json.dumps({"items": [{"kind": "summary", "text": "Revisão dos backups", "source_segment_ids": [source_id]}]})}}

    monkeypatch.setattr(OllamaProvider, "_request", respond)
    run_document(document_id)
    with session_scope() as db:
        document = db.get(AIDocument, document_id)
        assert document.status == "generated"
        assert json.loads(document.content_json)[0]["evidence_quotes"] == [text]
        assert document.reviewed_at is None
