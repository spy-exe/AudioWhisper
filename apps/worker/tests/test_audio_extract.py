import wave

import pytest

from audiowhisper_core.errors import AppError

from app.pipeline.audio_extract import extract_mono_wav


def test_extract_mono_wav_from_video(fixture_path, tmp_path):
    output = tmp_path / "out.wav"
    extract_mono_wav(fixture_path("tiny.mp4"), output)

    assert output.exists()
    with wave.open(str(output), "rb") as wf:
        assert wf.getnchannels() == 1
        assert wf.getframerate() == 16000
        assert wf.getnframes() > 0


def test_extract_mono_wav_from_audio(fixture_path, tmp_path):
    output = tmp_path / "out.wav"
    extract_mono_wav(fixture_path("speech.wav"), output)
    assert output.exists()
    assert output.stat().st_size > 0


def test_extract_mono_wav_raises_on_corrupt_input(fixture_path, tmp_path):
    output = tmp_path / "out.wav"
    with pytest.raises(AppError) as exc_info:
        extract_mono_wav(fixture_path("corrupt.wav"), output)
    assert exc_info.value.code.value == "FFMPEG_FAILED"


def test_extract_mono_wav_raises_on_missing_input(tmp_path):
    output = tmp_path / "out.wav"
    with pytest.raises(AppError):
        extract_mono_wav(tmp_path / "does-not-exist.wav", output)
