import subprocess

from app.diagnostics import gpu


class _FakeCompletedProcess:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_collect_reports_unavailable_when_nvidia_smi_missing(monkeypatch):
    def fake_run(*args, **kwargs):
        raise FileNotFoundError

    monkeypatch.setattr(subprocess, "run", fake_run)
    diagnostics = gpu.collect()
    assert diagnostics.gpu_available is False
    assert diagnostics.gpu_name is None
    assert diagnostics.error is not None


def test_collect_parses_nvidia_smi_csv_output(monkeypatch):
    def fake_run(args, **kwargs):
        return _FakeCompletedProcess(
            returncode=0, stdout="NVIDIA GeForce RTX 5060, 8151, 6000, 591.86\n"
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    diagnostics = gpu.collect()
    assert diagnostics.gpu_name == "NVIDIA GeForce RTX 5060"
    assert diagnostics.total_memory_mb == 8151.0
    assert diagnostics.free_memory_mb == 6000.0
    assert diagnostics.driver_version == "591.86"


def test_collect_reports_loaded_model_from_manager(monkeypatch):
    def fake_run(args, **kwargs):
        return _FakeCompletedProcess(returncode=0, stdout="RTX 5060, 8151, 6000, 591.86\n")

    monkeypatch.setattr(subprocess, "run", fake_run)

    class FakeLoaded:
        model_name = "turbo"
        compute_type = "int8_float16"
        device = "cuda"

    class FakeManager:
        current = FakeLoaded()

    diagnostics = gpu.collect(FakeManager())
    assert diagnostics.loaded_model == "turbo"
    assert diagnostics.compute_type == "int8_float16"
    assert diagnostics.device_in_use == "cuda"
