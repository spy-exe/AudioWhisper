"""Recover durable work after a restart of the single local worker."""
import uuid
from sqlalchemy import or_, select
from audiowhisper_core.db import session_scope
from audiowhisper_core.models import AIDocument, DocumentRecipe, KnowledgeQuestion, LiveChunk, LiveSession, RecipeRun, TranscriptionJob, TranscriptSegment, WorkspaceItem


def recover_pending(queue):
    queued_ids = set(queue.get_job_ids())
    with session_scope() as db:
        for model, statuses, task, prefix in (
            (KnowledgeQuestion, ["queued", "generating"], "app.workspace_tasks.run_question", "question"),
            (RecipeRun, ["queued", "running"], "app.workspace_tasks.run_recipe", "recipe"),
        ):
            for item in db.scalars(select(model).where(model.status.in_(statuses))):
                key = f"{prefix}-{item.id}"
                if key not in queued_ids:
                    item.status = "queued"
                    db.commit()
                    queue.enqueue(task, item.id, job_id=key, job_timeout=7200)
        live_ids = set(db.scalars(select(LiveSession.job_id)))
        for job in db.scalars(select(TranscriptionJob).where(TranscriptionJob.status.in_(["queued", "preparing", "extracting_audio", "loading_model", "transcribing", "generating_exports"]))):
            if job.id in live_ids or job.id in queued_ids:
                continue
            # Incomplete transcripts are rerun from the original media. Completed work is untouched.
            db.query(TranscriptSegment).filter_by(job_id=job.id).delete()
            job.status, job.progress, job.current_stage = "queued", 0, "Retomando após interrupção"
            db.commit()
            queue.enqueue("app.tasks.process_transcription_job", job.id, job_id=f"recover-{job.id}-{uuid.uuid4().hex[:8]}", job_timeout=21600)
        for document in db.scalars(select(AIDocument).where(AIDocument.status.in_(["queued", "generating"]))):
            if f"document-{document.id}" in queued_ids:
                continue
            document.status = "queued"
            db.commit()
            queue.enqueue("app.ai_tasks.run_document", document.id, job_id=f"document-{document.id}", job_timeout=7200)
        for item in db.scalars(select(WorkspaceItem).where(WorkspaceItem.diarization_status.in_(["queued", "processing"]))):
            if f"diarize-{item.job_id}" in queued_ids:
                continue
            item.diarization_status = "queued"
            db.commit()
            queue.enqueue("app.diarization.diarize_job", item.job_id, job_id=f"diarize-{item.job_id}", job_timeout=7200)
        for chunk in db.scalars(select(LiveChunk).where(LiveChunk.status.in_(["queued", "processing"]))):
            if f"live-{chunk.id}" in queued_ids:
                continue
            chunk.status = "queued"
            db.commit()
            queue.enqueue("app.live_tasks.process_live_chunk", chunk.id, job_id=f"live-{chunk.id}", job_timeout=1800)
        for session in db.scalars(select(LiveSession).where(LiveSession.status == "stopping")):
            queue.enqueue("app.live_tasks.finalize_live_session", session.job_id, job_timeout=1800)
        # Cover a crash between the completion commit and recipe scheduling.
        eligible = select(DocumentRecipe.id).where(DocumentRecipe.enabled.is_(True), DocumentRecipe.automatic.is_(True),
            DocumentRecipe.created_at <= TranscriptionJob.completed_at,
            or_(DocumentRecipe.project == "", DocumentRecipe.project == WorkspaceItem.project)).exists()
        completed = list(db.scalars(select(TranscriptionJob.id).outerjoin(WorkspaceItem).where(TranscriptionJob.status == "completed", eligible)))
        db.commit()
        from app.workspace_tasks import schedule_recipes
        for job_id in completed:
            schedule_recipes(job_id, queue)
