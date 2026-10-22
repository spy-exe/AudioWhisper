import subprocess
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from audiowhisper_core.errors import AppError
from app.diagnostics import gpu, smoke_test
from app.pipeline import audio_extract


@pytest.mark.parametrize("stdout,returncode,expected", [
    ("NVIDIA GeForce RTX 5060, 8151, 7000, 591.86\n", 0, {"name": "NVIDIA GeForce RTX 5060", "total_memory_mb": 8151.0,
                                                          "free_memory_mb": 7000.0, "driver_version": "591.86"}),
    ("", 0, None), ("garbage", 0, None), ("A, x, y, 1\n", 0, None), ("A, 1, 2, 3", 9, None),
])
def test_nvidia_smi_parsing(monkeypatch, stdout, returncode, expected):
    monkeypatch.setattr(gpu.subprocess, "run", lambda *a, **k: SimpleNamespace(stdout=stdout, returncode=returncode))
    assert gpu.run_nvidia_smi() == expected


def test_nvidia_smi_missing(monkeypatch):
    monkeypatch.setattr(gpu.subprocess, "run", Mock(side_effect=FileNotFoundError()))
    assert gpu.run_nvidia_smi() is None


def test_collect_reports_loaded_model_and_ctranslate2_errors(monkeypatch):
    monkeypatch.setattr(gpu, "run_nvidia_smi", lambda: {"name": "GPU", "total_memory_mb": 8, "free_memory_mb": 4, "driver_version": "1"})
    broken = types.ModuleType("ctranslate2")
    broken.__version__ = "4.6"
    broken.get_cuda_device_count = Mock(side_effect=RuntimeError("driver"))
    monkeypatch.setitem(sys.modules, "ctranslate2", broken)
    manager = SimpleNamespace(current=SimpleNamespace(model_name="turbo", compute_type="float16", device="cuda"))
    result = gpu.collect(manager)
    assert result.gpu_available is False and "CTranslate2" in result.error
    assert (result.loaded_model, result.compute_type, result.device_in_use) == ("turbo", "float16", "cuda")
    broken.get_cuda_device_count = lambda: 1
    healthy = gpu.collect(manager)
    assert healthy.gpu_available is True and healthy.error is None and healthy.gpu_name == "GPU"


def test_ffmpeg_missing_or_slow_becomes_a_typed_error(monkeypatch, tmp_path):
    monkeypatch.setattr(audio_extract.subprocess, "run", Mock(side_effect=FileNotFoundError()))
    with pytest.raises(AppError, match="não está disponível"):
        audio_extract.extract_mono_wav(Path("in.wav"), tmp_path / "out.wav")
    monkeypatch.setattr(audio_extract.subprocess, "run", Mock(side_effect=subprocess.TimeoutExpired("ffmpeg", 1)))
    with pytest.raises(AppError, match="tempo limite"):
        audio_extract.extract_mono_wav(Path("in.wav"), tmp_path / "out.wav")


def test_smoke_test_runs_end_to_end_on_cpu(capsys):
    assert smoke_test.main() == 0
    output = capsys.readouterr().out
    assert "[4/5]" in output and "Configuração solicitada era CPU" in output


def test_smoke_test_fails_when_the_model_cannot_load(monkeypatch, capsys):
    monkeypatch.setattr(smoke_test, "ModelManager", lambda settings: SimpleNamespace(get_model=Mock(side_effect=RuntimeError("x"))))
    assert smoke_test.main() == 1
    assert "falha ao carregar modelo" in capsys.readouterr().out


def test_smoke_test_flags_a_silent_cuda_fallback(monkeypatch, settings, capsys):
    monkeypatch.setattr(settings, "transcription_device", "cuda")
    segment = SimpleNamespace(start=0, end=1, text="ok")
    info = SimpleNamespace(language="en", language_probability=0.9, duration=1.0)
    loaded = SimpleNamespace(model=SimpleNamespace(transcribe=lambda *a, **k: (iter([segment]), info)),
                             model_name="tiny", device="cpu", compute_type="int8")
    monkeypatch.setattr(smoke_test, "ModelManager", lambda s: SimpleNamespace(get_model=lambda *a, **k: loaded))
    assert smoke_test.main() == 1
    assert "fallback controlado" in capsys.readouterr().out


def test_smoke_test_checks_vram_when_cuda_is_used(monkeypatch, settings, capsys):
    monkeypatch.setattr(settings, "transcription_device", "cuda")
    readings = iter([{"name": "GPU", "driver_version": "1", "free_memory_mb": 7000, "total_memory_mb": 8000},
                     {"name": "GPU", "driver_version": "1", "free_memory_mb": 7000, "total_memory_mb": 8000}])
    monkeypatch.setattr(smoke_test, "run_nvidia_smi", lambda: next(readings))
    segment = SimpleNamespace(start=0, end=1, text="ok")
    info = SimpleNamespace(language="en", language_probability=0.9, duration=1.0)
    loaded = SimpleNamespace(model=SimpleNamespace(transcribe=lambda *a, **k: (iter([segment]), info)),
                             model_name="tiny", device="cuda", compute_type="float16")
    monkeypatch.setattr(smoke_test, "ModelManager", lambda s: SimpleNamespace(get_model=lambda *a, **k: loaded, current=None))
    assert smoke_test.main() == 1  # no VRAM delta: the GPU did not really work
    assert "nenhuma redução de VRAM" in capsys.readouterr().out


def test_smoke_test_rejects_an_empty_transcription(monkeypatch, capsys):
    info = SimpleNamespace(language="en", language_probability=0.9, duration=1.0)
    loaded = SimpleNamespace(model=SimpleNamespace(transcribe=lambda *a, **k: (iter([]), info)),
                             model_name="tiny", device="cpu", compute_type="int8")
    monkeypatch.setattr(smoke_test, "ModelManager", lambda s: SimpleNamespace(get_model=lambda *a, **k: loaded))
    assert smoke_test.main() == 1
    assert "nenhum segmento" in capsys.readouterr().out
