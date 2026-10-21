from types import SimpleNamespace
from unittest.mock import Mock
import pytest
from audiowhisper_core.db import session_scope
from audiowhisper_core.models import AIDocument, LiveChunk, LiveSession, TranscriptionJob, TranscriptSegment, WorkspaceItem
from app.recovery import recover_pending
from app.diarization import best_speaker


def test_restart_rebuilds_an_interrupted_transcript_but_preserves_completed_work(make_media_and_job):
    _, interrupted = make_media_and_job(status="transcribing", progress=55)
    _, completed = make_media_and_job(status="completed", progress=100)
    with session_scope() as db:
        for job in [interrupted, completed]:
            db.add(TranscriptSegment(job_id=job.id, segment_index=0, start=0, end=1, text="Trecho persistido"))
    queue = SimpleNamespace(get_job_ids=lambda: [], enqueue=Mock())
    recover_pending(queue)
    with session_scope() as db:
        assert db.get(TranscriptionJob, interrupted.id).status == "queued"
        assert db.get(TranscriptionJob, interrupted.id).progress == 0
        assert db.query(TranscriptSegment).filter_by(job_id=interrupted.id).count() == 0
        assert db.query(TranscriptSegment).filter_by(job_id=completed.id).count() == 1
    assert any(call.args == ("app.tasks.process_transcription_job", interrupted.id) for call in queue.enqueue.call_args_list)
    assert not any(completed.id in call.args for call in queue.enqueue.call_args_list)


@pytest.mark.parametrize("already_queued", [False, True])
def test_restart_recovers_durable_tasks_without_duplicating_queued_work(make_media_and_job, already_queued):
    _, normal = make_media_and_job(status="queued")
    _, live = make_media_and_job(status="transcribing")
    chunk_id = f"{live.id}-0"
    with session_scope() as db:
        document = AIDocument(job_id=normal.id, kind="minutes", model="local", source_hash="fixture", status="generating")
        db.add(document)
        db.add(WorkspaceItem(job_id=normal.id, diarization_status="processing"))
        db.add(LiveSession(job_id=live.id, source="microphone", status="stopping", expected_chunks=1))
        db.flush()
        db.add(LiveChunk(id=chunk_id, job_id=live.id, sequence=0, revision=1, start=0, duration=2, final=True, path="fixture.wav", sha256="fixture", status="processing"))
        db.flush()
        document_id = document.id
    ids = [normal.id, f"document-{document_id}", f"diarize-{normal.id}", f"live-{chunk_id}"] if already_queued else []
    queue = SimpleNamespace(get_job_ids=lambda: ids, enqueue=Mock())
    recover_pending(queue)
    calls = [call.args for call in queue.enqueue.call_args_list]
    for task, identifier in [("app.tasks.process_transcription_job", normal.id), ("app.ai_tasks.run_document", document_id), ("app.diarization.diarize_job", normal.id), ("app.live_tasks.process_live_chunk", chunk_id)]:
        assert ((task, identifier) in calls) is not already_queued
    assert ("app.tasks.process_transcription_job", live.id) not in calls
    assert ("app.live_tasks.finalize_live_session", live.id) in calls
    with session_scope() as db:
        assert db.get(AIDocument, document_id).status == ("generating" if already_queued else "queued")
        assert db.get(LiveChunk, chunk_id).status == ("processing" if already_queued else "queued")


@pytest.mark.parametrize("start,end,turns,expected", [
    (2, 5, [(0, 3, "a"), (3, 8, "b")], "b"),
    (0, 5, [(0, 2, "a"), (2, 3, "b"), (3, 5, "a")], "a"),
    (9, 10, [(0, 3, "a")], None),
    (3, 3, [(0, 3, "a")], None),
    (0, 2, [], None),
])
def test_speaker_assignment_uses_total_temporal_overlap(start, end, turns, expected):
    assert best_speaker(start, end, turns) == expected
