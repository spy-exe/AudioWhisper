from sqlalchemy import select

from audiowhisper_core.db import session_scope
from audiowhisper_core.enums import JobStatus
from audiowhisper_core.models import ExportFile, TranscriptionJob, TranscriptSegment

from app.tasks import process_transcription_job


def test_full_pipeline_transcribes_real_speech(make_media_and_job):
    media, job = make_media_and_job("speech.wav")

    process_transcription_job(job.id)

    with session_scope() as db:
        refreshed = db.get(TranscriptionJob, job.id)
        assert refreshed.status == JobStatus.COMPLETED
        assert refreshed.progress == 1.0
        assert refreshed.language_detected == "en"
        assert refreshed.processing_seconds is not None
        assert refreshed.real_time_factor is not None

        segments = list(
            db.execute(
                select(TranscriptSegment)
                .where(TranscriptSegment.job_id == job.id)
                .order_by(TranscriptSegment.segment_index)
            ).scalars()
        )
        assert len(segments) >= 1
        full_text = " ".join(s.text for s in segments).lower()
        assert "test" in full_text or "transcription" in full_text

        exports = list(
            db.execute(select(ExportFile).where(ExportFile.job_id == job.id)).scalars()
        )
        assert {e.format for e in exports} == {"txt", "markdown", "json", "srt", "vtt"}
        for export in exports:
            from audiowhisper_core.config import get_settings

            path = get_settings().exports_dir / export.path
            assert path.exists()
            assert path.stat().st_size > 0


def test_pipeline_honors_cancel_requested_before_start(make_media_and_job):
    media, job = make_media_and_job("speech.wav", cancel_requested=True)

    process_transcription_job(job.id)

    with session_scope() as db:
        refreshed = db.get(TranscriptionJob, job.id)
        assert refreshed.status == JobStatus.CANCELLED

        segments = list(
            db.execute(
                select(TranscriptSegment).where(TranscriptSegment.job_id == job.id)
            ).scalars()
        )
        assert segments == []


def test_pipeline_fails_gracefully_when_source_file_missing(make_media_and_job, settings):
    media, job = make_media_and_job("speech.wav")
    (settings.uploads_dir / media.stored_name).unlink()

    process_transcription_job(job.id)

    with session_scope() as db:
        refreshed = db.get(TranscriptionJob, job.id)
        assert refreshed.status == JobStatus.FAILED
        assert refreshed.error_code == "FFMPEG_FAILED"
        assert refreshed.failed_at is not None


def test_cancel_during_extraction_does_not_load_a_model(make_media_and_job, monkeypatch):
    from unittest.mock import Mock
    from app import tasks
    _, job = make_media_and_job("speech.wav")
    original_extract = tasks.extract_mono_wav

    def extract_then_cancel(*args):
        original_extract(*args)
        with session_scope() as db:
            db.get(TranscriptionJob, job.id).cancel_requested = True

    manager = Mock()
    monkeypatch.setattr(tasks, "extract_mono_wav", extract_then_cancel)
    monkeypatch.setattr(tasks, "get_model_manager", manager)
    process_transcription_job(job.id)
    manager.assert_not_called()
    with session_scope() as db:
        assert db.get(TranscriptionJob, job.id).status == JobStatus.CANCELLED


def test_pipeline_records_word_timestamps(make_media_and_job):
    import json

    media, job = make_media_and_job("speech.wav", settings={"word_timestamps": True})
    process_transcription_job(job.id)

    with session_scope() as db:
        segments = list(
            db.execute(
                select(TranscriptSegment).where(TranscriptSegment.job_id == job.id)
            ).scalars()
        )
        assert any(s.words_json for s in segments)
        words = json.loads(next(s.words_json for s in segments if s.words_json))
        assert "word" in words[0]
        assert "start" in words[0]
        assert "probability" in words[0]
