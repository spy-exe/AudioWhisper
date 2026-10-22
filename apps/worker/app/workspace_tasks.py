"""Serial local inference and idempotent document recipes."""
import gc
import json
import logging
from types import SimpleNamespace

from sqlalchemy import or_, select

from audiowhisper_core.config import get_settings
from audiowhisper_core.db import session_scope
from audiowhisper_core.evidence import snapshots, source_map
from audiowhisper_core.intelligence import OllamaProvider, evidence_batches, transcript_hash, validate_evidence
from audiowhisper_core.models import AIDocument, DocumentRecipe, KnowledgeQuestion, RecipeRun, TranscriptSegment, TranscriptionJob, WorkspaceItem
from audiowhisper_core.workspace import ensure_recipe_run, indexed_matches

logger = logging.getLogger(__name__)


def run_question(question_id):
    settings = get_settings()
    with session_scope() as db:
        question = db.get(KnowledgeQuestion, question_id)
        if not question or question.status != "queued":
            return
        try:
            question.status, question.error = "generating", None
            db.commit()
            matches = indexed_matches(question.question, question=True)
            segments = []
            if matches is not None:
                query = select(TranscriptSegment).join(matches, matches.c.segment_id == TranscriptSegment.id).join(
                    TranscriptionJob, TranscriptionJob.id == TranscriptSegment.job_id).outerjoin(
                    WorkspaceItem, WorkspaceItem.job_id == TranscriptionJob.id).where(TranscriptionJob.status == "completed")
                if question.project:
                    query = query.where(WorkspaceItem.project == question.project)
                job_ids = json.loads(question.job_ids_json)
                if job_ids:
                    query = query.where(TranscriptSegment.job_id.in_(job_ids))
                segments = list(db.scalars(query.order_by(matches.c.rank, TranscriptionJob.created_at.desc(), TranscriptSegment.segment_index).limit(80)))
            sources = snapshots(db, [segment.id for segment in segments])
            question.retrieval_count = len(sources)
            question.sources_json = json.dumps(sources, ensure_ascii=False)
            db.commit()
            if not sources:
                question.items_json, question.status = "[]", "completed"
                db.commit()
                return
            # Freeze inference inputs; later reads must not mutate the evidence being checked.
            inputs = [SimpleNamespace(id=s["segment_id"], text=s["text"], start=s["start"], end=s["end"],
                                      speaker_id=s["segment_id"], recording=s["title"]) for s in sources]
            speakers = {s["segment_id"]: s["speaker"] for s in sources}
            from app.tasks import get_model_manager
            get_model_manager(settings).current = None
            gc.collect()
            provider = OllamaProvider(settings.ollama_url, settings.ollama_timeout_seconds)
            items = []
            for batch in evidence_batches(inputs, speakers):
                result = provider.generate(question.model, "custom", "Responda à pergunta usando somente os trechos recuperados. "
                    "Não conclua ausência de algo em toda a biblioteca com base nesta seleção. Se a pergunta não for respondida pelos trechos, retorne items vazio. "
                    "Títulos identificam gravações, não são evidência de fala. Pergunta: " + question.question, batch, speakers)
                result = validate_evidence(result, batch)
                originals = {s.id: s.text for s in batch}
                for item in result.items:
                    item.evidence_quotes = [originals[source] for source in item.source_segment_ids]
                    items.append(item.model_dump())
            db.expire_all()
            current = source_map(db, [question])
            if any(current.get(s["segment_id"]) != s["fingerprint"] for s in sources):
                raise ValueError("Uma fonte mudou durante a resposta. Faça a pergunta novamente.")
            used = {source for item in items for source in item["source_segment_ids"]}
            question.sources_json = json.dumps([source for source in sources if source["segment_id"] in used], ensure_ascii=False)
            question.items_json, question.status = json.dumps(items, ensure_ascii=False), "completed"
            db.commit()
        except Exception as exc:
            db.rollback()
            question = db.get(KnowledgeQuestion, question_id)
            question.status = "failed"
            question.error = str(exc) if isinstance(exc, ValueError) else "Falha na consulta local. Verifique o Ollama e tente novamente."
            db.commit()


def run_recipe(run_id):
    with session_scope() as db:
        run = db.get(RecipeRun, run_id)
        if not run or run.status != "queued":
            return
        try:
            run.status, run.error = "running", None
            db.commit()
            payload = json.loads(run.payload_json)
            job = db.get(TranscriptionJob, run.job_id)
            if not job or job.status != "completed":
                raise ValueError("A gravação precisa estar concluída para executar a receita.")
            segments = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.job_id == job.id).order_by(TranscriptSegment.segment_index)))
            if not segments:
                raise ValueError("A gravação não tem texto para gerar um documento.")
            workspace = db.get(WorkspaceItem, job.id)
            names = json.loads(workspace.speakers_json) if workspace else {}
            document = db.get(AIDocument, run.document_id) if run.document_id else None
            if not document:
                document = AIDocument(job_id=job.id, kind=payload["kind"], model=payload["model"], instruction=payload["instruction"], source_hash=transcript_hash(segments, names))
                db.add(document)
                db.flush()
                run.document_id = document.id
            elif document.status == "failed":
                document.status, document.source_hash, document.error = "queued", transcript_hash(segments, names), None
            db.commit()
            from app.ai_tasks import run_document
            run_document(document.id)
            db.expire_all()
            document = db.get(AIDocument, run.document_id)
            if document.status not in ("generated", "reviewed"):
                raise ValueError(document.error or "O documento não foi concluído. Repita a execução.")
            run.status = "completed"
            db.commit()
        except Exception as exc:
            db.rollback()
            run = db.get(RecipeRun, run_id)
            run.status = "failed"
            run.error = str(exc) if isinstance(exc, ValueError) else "Falha ao executar a receita. Tente novamente."
            db.commit()


def schedule_recipes(job_id, queue=None):
    # A recipe failure must never turn a successfully saved recording into a failed job.
    try:
        with session_scope() as db:
            job = db.get(TranscriptionJob, job_id)
            if not job or job.status != "completed" or not job.completed_at:
                return
            workspace = db.get(WorkspaceItem, job_id)
            project = workspace.project if workspace else ""
            recipes = list(db.scalars(select(DocumentRecipe).where(DocumentRecipe.enabled.is_(True), DocumentRecipe.automatic.is_(True),
                DocumentRecipe.created_at <= job.completed_at, or_(DocumentRecipe.project == "", DocumentRecipe.project == project))))
            for recipe in recipes:
                run, created = ensure_recipe_run(db, recipe, job_id)
                if not created:
                    continue
                db.commit()
                try:
                    if queue is None:
                        import redis
                        from rq import Queue
                        settings = get_settings()
                        queue = Queue(settings.job_queue_name, connection=redis.from_url(settings.redis_url))
                    queue.enqueue("app.workspace_tasks.run_recipe", run.id, job_id=f"recipe-{run.id}", job_timeout=7200)
                except Exception:
                    run.status, run.error = "failed", "Fila indisponível. Repita a execução em Receitas."
                    db.commit()
    except Exception:
        logger.exception("recipe_scheduling_failed", extra={"job_id": job_id})
