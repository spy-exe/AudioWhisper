import json
import uuid
import wave
from types import SimpleNamespace
from audiowhisper_core.db import session_scope
from audiowhisper_core.models import LiveChunk, LiveSession, MediaFile, TranscriptionJob, TranscriptSegment
from app.live_tasks import process_live_chunk, finalize_live_session


def test_live_final_chunks_keep_timestamps_and_finalize_once(make_media_and_job, settings, monkeypatch):
    media, job = make_media_and_job("speech.wav")
    with session_scope() as db:
        db.add(LiveSession(job_id=job.id, source="microphone", status="stopping", expected_chunks=1, duration=20))
        db.flush()
        chunk = LiveChunk(id=str(uuid.uuid4()), job_id=job.id, sequence=0, revision=1, start=2, duration=3, final=True, path=media.stored_name, sha256="x")
        db.add(chunk)
        db.commit()
        chunk_id = chunk.id
    model = SimpleNamespace(transcribe=lambda *a, **k: (iter([SimpleNamespace(start=.25, end=1, text="Test", words=[], avg_logprob=-.1)]), SimpleNamespace(language="en")))
    loaded = SimpleNamespace(model=model, model_name="tiny", device="cpu", compute_type="int8")
    monkeypatch.setattr("app.live_tasks.get_model_manager", lambda *a: SimpleNamespace(get_model=lambda *a: loaded))
    monkeypatch.setattr("app.live_tasks.notify", lambda *a: None)
    process_live_chunk(chunk_id)
    process_live_chunk(chunk_id)
    finalize_live_session(job.id)
    with session_scope() as db:
        segments = db.query(TranscriptSegment).filter_by(job_id=job.id).all()
        assert len(segments) == 1
        assert segments[0].start == 2.25
        assert db.get(TranscriptionJob, job.id).status == "completed"
        assert db.get(LiveSession, job.id).status == "completed"
        assert db.get(MediaFile, media.id).duration_seconds >= 20
    with wave.open(str(settings.uploads_dir / media.stored_name)) as output:
        assert output.getnframes() >= 20 * 16000
