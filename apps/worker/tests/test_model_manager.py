import pytest

from app.model_manager import ModelManager


def test_build_fallback_plan_on_cuda_covers_compute_type_model_and_cpu(settings):
    manager = ModelManager(settings)
    plan = manager._build_fallback_plan("large-v3", "cuda", "float16")

    assert plan[0] == ("large-v3", "cuda", "float16")
    assert ("large-v3", "cuda", "int8_float16") in plan
    assert ("large-v3", "cuda", "int8") in plan
    assert ("turbo", "cuda", "float16") in plan
    assert ("medium", "cuda", "float16") in plan
    assert ("small", "cuda", "float16") in plan
    assert plan[-1] == ("large-v3", "cpu", "int8")


def test_build_fallback_plan_on_cpu_is_single_attempt(settings):
    manager = ModelManager(settings)
    plan = manager._build_fallback_plan("small", "cpu", "int8")
    assert plan == [("small", "cpu", "int8")]


def test_get_model_loads_real_tiny_model_on_cpu(settings):
    manager = ModelManager(settings)
    loaded = manager.get_model("tiny", "cpu", "int8", job_id="test-job")
    assert loaded.model_name == "tiny"
    assert loaded.device == "cpu"
    assert manager.current is loaded


def test_get_model_reuses_cached_instance_for_same_config(settings):
    manager = ModelManager(settings)
    first = manager.get_model("tiny", "cpu", "int8", job_id="job-1")
    second = manager.get_model("tiny", "cpu", "int8", job_id="job-2")
    assert first is second


def test_get_model_falls_back_through_bad_configs(settings, monkeypatch):
    manager = ModelManager(settings)
    calls = []

    import app.model_manager as mm

    real_whisper_model = mm.WhisperModel

    def flaky_whisper_model(model_name, device, compute_type, download_root):
        calls.append((model_name, device, compute_type))
        if len(calls) < 3:
            raise RuntimeError("CUDA failed with error out of memory")
        return real_whisper_model(model_name, device="cpu", compute_type="int8", download_root=download_root)

    monkeypatch.setattr(mm, "WhisperModel", flaky_whisper_model)

    loaded = manager.get_model("tiny", "cuda", "float16", job_id="job-fallback")
    assert len(calls) == 3
    assert loaded is not None


def test_get_model_releases_previous_model_when_config_changes(settings, monkeypatch):
    """Regression test for a real VRAM leak found during development: swapping to a new
    (model, device, compute_type) used to leave the previous CTranslate2 model resident in
    GPU memory until Python's GC got around to collecting it, which — across many config
    changes on a long-running worker — eventually exhausted an 8 GiB GPU."""
    manager = ModelManager(settings)
    manager.get_model("tiny", "cpu", "int8", job_id="job-1")

    import app.model_manager as mm

    released: list[object] = []
    monkeypatch.setattr(mm, "_free_gpu_model", lambda model: released.append(model))

    manager.get_model("tiny", "cpu", "float32", job_id="job-2")
    assert len(released) == 1


def test_get_model_releases_failed_attempt_before_retrying(settings, monkeypatch):
    """A model that constructs successfully but fails the load-time validation transcribe
    (e.g. CUBLAS_STATUS_NOT_SUPPORTED) must still be released before the next fallback
    attempt, not left dangling until GC gets to it."""
    manager = ModelManager(settings)
    import app.model_manager as mm

    real_whisper_model = mm.WhisperModel
    released: list[object] = []
    monkeypatch.setattr(mm, "_free_gpu_model", lambda model: released.append(model))

    class FailingModel:
        def transcribe(self, *args, **kwargs):
            raise RuntimeError("cuBLAS failed with status CUBLAS_STATUS_NOT_SUPPORTED")

    call_count = 0

    def flaky_whisper_model(model_name, device, compute_type, download_root):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return FailingModel()
        return real_whisper_model(model_name, device="cpu", compute_type="int8", download_root=download_root)

    monkeypatch.setattr(mm, "WhisperModel", flaky_whisper_model)

    loaded = manager.get_model("tiny", "cuda", "float16", job_id="job-validation-fail")
    assert loaded is not None
    assert len(released) == 1
    assert isinstance(released[0], FailingModel)


def test_get_model_raises_app_error_when_every_attempt_fails(settings, monkeypatch):
    manager = ModelManager(settings)
    import app.model_manager as mm

    def always_fails(*args, **kwargs):
        raise RuntimeError("out of memory")

    monkeypatch.setattr(mm, "WhisperModel", always_fails)

    from audiowhisper_core.errors import AppError

    with pytest.raises(AppError):
        manager.get_model("tiny", "cpu", "int8", job_id="job-fail")
