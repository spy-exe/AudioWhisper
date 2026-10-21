"""Recover durable work after a restart of the single local worker."""
import uuid
from sqlalchemy import select
from audiowhisper_core.db import session_scope
from audiowhisper_core.models import AIDocument, LiveChunk, LiveSession, TranscriptionJob, TranscriptSegment, WorkspaceItem


def recover_pending(queue):
    queued_ids = set(queue.get_job_ids())
    with session_scope() as db:
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
