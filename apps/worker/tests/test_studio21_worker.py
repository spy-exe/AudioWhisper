"""Vocabulary hints, ETA, document/diarization failure paths, live consolidation and the worker loop."""
import json
import sys
import threading
import types
import uuid
import wave
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from audiowhisper_core.db import session_scope
from audiowhisper_core.intelligence import EvidenceOutput, transcript_hash
from audiowhisper_core.models import AIDocument, LiveChunk, LiveSession, TranscriptionJob, TranscriptSegment, WorkspaceItem
from app.tasks import estimate_remaining, process_transcription_job, transcribe_options


def _fake_model(segments, calls=None, language="pt"):
    def transcribe(*args, **kwargs):
        if calls is not None:
            calls.append(kwargs)
        return iter(segments), SimpleNamespace(language=language)
    return SimpleNamespace(model=SimpleNamespace(transcribe=transcribe), model_name="tiny", device="cpu", compute_type="int8")


def test_transcribe_options_only_send_vocabulary_when_present():
    base = transcribe_options({"language": "", "beam_size": 3, "vad_enabled": False})
    assert base == {"language": None, "task": "transcribe", "beam_size": 3, "vad_filter": False}
    full = transcribe_options({"language": "pt", "translate_to_english": True, "initial_prompt": "Opikode", "hotwords": "Trofi"})
    assert full["task"] == "translate" and full["initial_prompt"] == "Opikode" and full["hotwords"] == "Trofi"


@pytest.mark.parametrize("elapsed,processed,total,expected", [
    (10, 20, 60, 20.0), (0.5, 20, 60, None), (10, 0, 60, None), (10, 60, 60, None), (10, 20, 0, None),
])
def test_estimate_remaining(elapsed, processed, total, expected):
    assert estimate_remaining(elapsed, processed, total) == expected


def test_pipeline_passes_vocabulary_and_publishes_eta(make_media_and_job, monkeypatch):
    _, job = make_media_and_job("speech.wav", settings={"initial_prompt": "AudioWhisper, Ollama", "hotwords": "Opikode"})
    events, calls = [], []
    publisher = SimpleNamespace(publish=lambda channel, payload: events.append(json.loads(payload)), close=lambda: None)
    segments = [SimpleNamespace(start=0.0, end=1.0, text="Primeiro", words=None, avg_logprob=-0.2)]
    clock = iter([100.0, 103.0, 103.0, 103.0, 103.0])
    monkeypatch.setattr("app.tasks.redis.from_url", lambda *a: publisher)
    monkeypatch.setattr("app.tasks.get_model_manager", lambda *a: SimpleNamespace(get_model=lambda *a: _fake_model(segments, calls)))
    monkeypatch.setattr("app.tasks.time.monotonic", lambda: next(clock, 103.0))
    process_transcription_job(job.id)
    assert calls[0]["initial_prompt"] == "AudioWhisper, Ollama" and calls[0]["hotwords"] == "Opikode"
    transcribing = [e for e in events if e["status"] == "transcribing"]
    assert transcribing and transcribing[0]["eta_seconds"] is not None and transcribing[0]["eta_seconds"] > 0
    with session_scope() as db:
        assert db.get(TranscriptionJob, job.id).status == "completed"


def test_unexpected_pipeline_errors_end_in_a_failed_state(make_media_and_job, monkeypatch):
    _, job = make_media_and_job("speech.wav")
    monkeypatch.setattr("app.tasks.get_model_manager", lambda *a: SimpleNamespace(get_model=Mock(side_effect=RuntimeError("boom"))))
    process_transcription_job(job.id)
    with session_scope() as db:
        failed = db.get(TranscriptionJob, job.id)
        assert (failed.status, failed.error_code) == ("failed", "INTERNAL_ERROR")
        assert "boom" not in failed.error_message


def test_missing_job_is_ignored():
    process_transcription_job(str(uuid.uuid4()))


def _document(job_id, text="Precisamos revisar os backups.", status="queued"):
    with session_scope() as db:
        segment = TranscriptSegment(job_id=job_id, segment_index=0, start=0, end=2, text=text)
        db.add(segment)
        db.flush()
        document = AIDocument(job_id=job_id, kind="summary", model="local", status=status, source_hash=transcript_hash([segment]))
        db.add(document)
        db.commit()
        return document.id, segment.id


def test_documents_fail_clearly_when_the_source_changed_before_generation(make_media_and_job, monkeypatch):
    _, job = make_media_and_job("speech.wav")
    document_id, segment_id = _document(job.id)
    with session_scope() as db:
        db.get(TranscriptSegment, segment_id).text = "Texto editado"
    monkeypatch.setattr("app.ai_tasks.OllamaProvider", Mock())
    from app.ai_tasks import run_document
    run_document(document_id)
    with session_scope() as db:
        document = db.get(AIDocument, document_id)
        assert document.status == "failed" and "mudou" in document.error


def test_documents_fail_when_the_source_is_edited_during_generation(make_media_and_job, monkeypatch):
    _, job = make_media_and_job("speech.wav")
    document_id, segment_id = _document(job.id)

    def generate(*args):
        with session_scope() as db:
            db.get(TranscriptSegment, segment_id).text = "Editado durante a geração"
        return EvidenceOutput(items=[])
    monkeypatch.setattr("app.ai_tasks.OllamaProvider", lambda *a: SimpleNamespace(generate=generate))
    from app.ai_tasks import run_document
    run_document(document_id)
    with session_scope() as db:
        assert "editado durante a geração" in db.get(AIDocument, document_id).error


def test_unexpected_document_errors_are_reported_without_internals(make_media_and_job, monkeypatch):
    _, job = make_media_and_job("speech.wav")
    document_id, _ = _document(job.id)
    monkeypatch.setattr("app.ai_tasks.OllamaProvider", lambda *a: SimpleNamespace(generate=Mock(side_effect=KeyError("x"))))
    from app.ai_tasks import run_document
    run_document(document_id)
    run_document(str(uuid.uuid4()))  # unknown documents are ignored
    with session_scope() as db:
        document = db.get(AIDocument, document_id)
        assert document.status == "failed" and document.error.startswith("Falha na geração local")


@pytest.fixture
def fake_pyannote(monkeypatch):
    """A stand-in pyannote.audio exposing Pipeline.from_pretrained, as the real package does."""
    state = SimpleNamespace(pipeline=None, calls=[])
    audio = types.ModuleType("pyannote.audio")

    class Pipeline:
        @staticmethod
        def from_pretrained(model, token=None):
            state.calls.append((model, token))
            return state.pipeline
    audio.Pipeline = Pipeline
    package = types.ModuleType("pyannote")
    package.audio = audio
    monkeypatch.setitem(sys.modules, "pyannote", package)
    monkeypatch.setitem(sys.modules, "pyannote.audio", audio)
    return state


def _diarization_job(make_media_and_job):
    _, job = make_media_and_job("speech.wav", status="completed")
    with session_scope() as db:
        for index, (start, end) in enumerate([(0, 1.5), (1.5, 3.5)]):
            db.add(TranscriptSegment(job_id=job.id, segment_index=index, start=start, end=end, text=f"t{index}"))
        db.add(WorkspaceItem(job_id=job.id, diarization_status="queued", speakers_json=json.dumps({"SPEAKER_00": "Ana"})))
        db.commit()
    return job


def test_diarization_assigns_speakers_by_overlap_and_names_new_ones(make_media_and_job, fake_pyannote, settings, monkeypatch):
    job = _diarization_job(make_media_and_job)
    turn = lambda start, end: SimpleNamespace(start=start, end=end)  # noqa: E731
    output = SimpleNamespace(exclusive_speaker_diarization=[(turn(0, 1.4), "SPEAKER_00"), (turn(1.4, 3.6), "SPEAKER_01")])
    fake_pyannote.pipeline = lambda path: output
    monkeypatch.setattr(settings, "hf_token", "hf_x")
    from app.diarization import diarize_job
    diarize_job(job.id)
    with session_scope() as db:
        item = db.get(WorkspaceItem, job.id)
        assert item.diarization_status == "completed" and item.diarization_error is None
        assert json.loads(item.speakers_json) == {"SPEAKER_00": "Ana", "SPEAKER_01": "Falante 2"}
        speakers = [s.speaker_id for s in db.query(TranscriptSegment).filter_by(job_id=job.id).order_by(TranscriptSegment.segment_index)]
        assert speakers == ["SPEAKER_00", "SPEAKER_01"]
    assert fake_pyannote.calls == [(settings.diarization_model, "hf_x")]
    assert not (settings.tmp_dir / f"diarize-{job.id}.wav").exists()


def test_diarization_failures_are_explained(make_media_and_job, fake_pyannote, settings, monkeypatch):
    from app.diarization import diarize_job
    job = _diarization_job(make_media_and_job)
    fake_pyannote.pipeline = None
    diarize_job(job.id)
    with session_scope() as db:
        assert "Hugging Face" in db.get(WorkspaceItem, job.id).diarization_error

    other = _diarization_job(make_media_and_job)
    monkeypatch.setattr(settings, "diarization_model", "https://example.com/remote")
    diarize_job(other.id)
    with session_scope() as db:
        assert "remotos" in db.get(WorkspaceItem, other.id).diarization_error

    crash = _diarization_job(make_media_and_job)
    monkeypatch.setattr(settings, "diarization_model", "pyannote/speaker-diarization-community-1")
    fake_pyannote.pipeline = Mock(side_effect=MemoryError())
    diarize_job(crash.id)
    with session_scope() as db:
        item = db.get(WorkspaceItem, crash.id)
        assert item.diarization_status == "failed" and item.diarization_error.startswith("Não foi possível")
    diarize_job(str(uuid.uuid4()))  # no workspace item: nothing to do


def test_diarization_without_the_optional_package(make_media_and_job, monkeypatch):
    from app.diarization import diarize_job
    job = _diarization_job(make_media_and_job)
    monkeypatch.setitem(sys.modules, "pyannote.audio", None)
    diarize_job(job.id)
    with session_scope() as db:
        assert "Instale o extra de diarização" in db.get(WorkspaceItem, job.id).diarization_error


def _wav(path, seconds, value=1000):
    with wave.open(str(path), "wb") as target:
        target.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        target.writeframes(value.to_bytes(2, "little", signed=True) * int(seconds * 16000))


def _live_job(make_media_and_job, settings, chunks, expected, duration):
    media, job = make_media_and_job("speech.wav", status="transcribing")
    directory = settings.uploads_dir / "live" / job.id
    directory.mkdir(parents=True, exist_ok=True)
    with session_scope() as db:
        db.add(LiveSession(job_id=job.id, source="microphone", status="stopping", expected_chunks=expected, duration=duration))
        db.flush()
        for sequence, start, seconds, status in chunks:
            path = directory / f"{sequence}-0.wav"
            _wav(path, seconds)
            db.add(LiveChunk(id=f"{job.id}-{sequence}-0", job_id=job.id, sequence=sequence, revision=0, start=start,
                             duration=seconds, final=True, path=str(path.relative_to(settings.uploads_dir)), sha256="x",
                             status=status))
        db.commit()
    return media, job


def test_finalize_waits_for_pending_chunks(make_media_and_job, settings, monkeypatch):
    from app.live_tasks import finalize_live_session
    monkeypatch.setattr("app.live_tasks.notify", lambda *a, **k: None)
    _, job = _live_job(make_media_and_job, settings, [(0, 0, 1, "completed"), (1, 1, 1, "failed")], expected=2, duration=2)
    finalize_live_session(job.id)
    with session_scope() as db:
        refreshed = db.get(TranscriptionJob, job.id)
        assert refreshed.status == "transcribing" and "Aguardando" in refreshed.current_stage


def test_finalize_rebuilds_silence_between_chunks_and_trims_overlap(make_media_and_job, settings, monkeypatch):
    from app.live_tasks import finalize_live_session
    monkeypatch.setattr("app.live_tasks.notify", lambda *a, **k: None)
    media, job = _live_job(make_media_and_job, settings, [(0, 0.5, 1, "completed"), (1, 1.25, 1, "completed")], expected=2, duration=4)
    finalize_live_session(job.id)
    with wave.open(str(settings.uploads_dir / media.stored_name)) as output:
        frames = output.readframes(output.getnframes())
        assert output.getnframes() == 4 * 16000
    samples = [int.from_bytes(frames[i:i + 2], "little", signed=True) for i in range(0, len(frames), 2)]
    assert samples[0] == 0 and samples[8000] == 1000          # leading silence, then the first chunk
    assert samples[int(2.25 * 16000) - 1] == 1000 and samples[int(2.25 * 16000) + 10] == 0  # overlap trimmed, tail padded
    with session_scope() as db:
        assert db.get(TranscriptionJob, job.id).status == "completed"
        assert db.get(LiveSession, job.id).status == "completed"


def test_live_chunks_skip_cancelled_superseded_and_report_failures(make_media_and_job, settings, monkeypatch):
    from app.live_tasks import process_live_chunk
    notified = []
    monkeypatch.setattr("app.live_tasks.notify", lambda *a, **k: notified.append(a))
    media, job = make_media_and_job("speech.wav", status="transcribing")
    with session_scope() as db:
        db.add(LiveSession(job_id=job.id, source="microphone"))
        db.flush()
        for revision in (0, 1):
            db.add(LiveChunk(id=f"{job.id}-0-{revision}", job_id=job.id, sequence=0, revision=revision, start=0, duration=1,
                             final=False, path=media.stored_name, sha256="x"))
        db.add(LiveChunk(id=f"{job.id}-1-0", job_id=job.id, sequence=1, revision=0, start=1, duration=1, final=True,
                         path=media.stored_name, sha256="x"))
        db.commit()
    process_live_chunk(f"{job.id}-0-0")
    with session_scope() as db:
        assert db.get(LiveChunk, f"{job.id}-0-0").status == "superseded"
    monkeypatch.setattr("app.live_tasks.get_model_manager", lambda *a: SimpleNamespace(get_model=Mock(side_effect=RuntimeError("gpu"))))
    process_live_chunk(f"{job.id}-1-0")
    with session_scope() as db:
        failed = db.get(LiveChunk, f"{job.id}-1-0")
        assert failed.status == "failed" and "tente recuperar" in failed.error
        db.get(TranscriptionJob, job.id).cancel_requested = True
    process_live_chunk(f"{job.id}-0-1")
    with session_scope() as db:
        assert db.get(LiveChunk, f"{job.id}-0-1").status == "queued"
    process_live_chunk("nao-existe")


def test_live_provisional_text_is_published_for_drafts(make_media_and_job, settings, monkeypatch):
    from app import live_tasks
    events = []
    connection = SimpleNamespace(publish=lambda channel, payload: events.append(json.loads(payload)), close=lambda: None)
    monkeypatch.setattr(live_tasks.redis, "from_url", lambda *a: connection)
    media, job = make_media_and_job("speech.wav", status="transcribing")
    with session_scope() as db:
        db.add(LiveSession(job_id=job.id, source="microphone"))
        db.flush()
        db.add(LiveChunk(id=f"{job.id}-0-0", job_id=job.id, sequence=0, revision=0, start=0, duration=1, final=False,
                         path=media.stored_name, sha256="x"))
        db.commit()
    segments = [SimpleNamespace(start=0, end=1, text="rascunho", words=None, avg_logprob=-0.1)]
    monkeypatch.setattr(live_tasks, "get_model_manager", lambda *a: SimpleNamespace(get_model=lambda *a: _fake_model(segments)))
    live_tasks.process_live_chunk(f"{job.id}-0-0")
    assert events[-1]["new_segments"] == []
    assert [s["text"] for s in events[-1]["provisional_segments"]] == ["rascunho"]


def test_heartbeat_publishes_diagnostics_and_survives_errors(settings):
    from app import worker_main
    stop = threading.Event()
    connection = Mock()

    def record(*args, **kwargs):
        if connection.set.call_count >= 2:  # call_count is incremented before side_effect runs
            stop.set()
    connection.set.side_effect = record
    worker_main._heartbeat_loop(connection, settings, SimpleNamespace(current=None), stop)
    assert [c.args[0] for c in connection.set.call_args_list] == [settings.gpu_diagnostics_key, settings.worker_heartbeat_key]

    failing = Mock()

    def explode(*args, **kwargs):
        stop.set()
        raise RuntimeError("redis")
    failing.set.side_effect = explode
    stop.clear()
    worker_main._heartbeat_loop(failing, settings, SimpleNamespace(current=None), stop)  # logged, never raised
    assert failing.set.call_count == 1


def test_worker_main_recovers_before_working(monkeypatch):
    from app import worker_main
    order = []
    monkeypatch.setattr(worker_main.redis, "from_url", lambda *a: Mock())
    monkeypatch.setattr(worker_main, "Queue", lambda *a, **k: "queue")
    monkeypatch.setattr(worker_main, "get_model_manager", lambda *a: SimpleNamespace(current=None))
    monkeypatch.setattr(worker_main, "_heartbeat_loop", lambda *a: None)
    monkeypatch.setattr("app.recovery.recover_pending", lambda queue: order.append(("recover", queue)))
    worker = Mock()
    worker.work.side_effect = lambda **kwargs: order.append(("work", kwargs["with_scheduler"]))
    monkeypatch.setattr(worker_main, "SimpleWorker", lambda queues, connection: worker)
    worker_main.main()
    assert order == [("recover", "queue"), ("work", False)]
