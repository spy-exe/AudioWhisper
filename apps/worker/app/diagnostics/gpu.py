"""Standalone GPU/CTranslate2 diagnostics.

Runnable directly:  python -m app.diagnostics.gpu
Also used by worker_main.py to publish a live snapshot to Redis for the API's
/api/health/gpu endpoint to read.
"""

import json
import os
import subprocess
import time

from audiowhisper_core.schemas import GpuDiagnostics


def run_nvidia_smi() -> dict | None:
    try:
        proc = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.free,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except FileNotFoundError:
        return None
    if proc.returncode != 0 or not proc.stdout.strip():
        return None
    parts = [p.strip() for p in proc.stdout.strip().splitlines()[0].split(",")]
    if len(parts) < 4:
        return None
    name, total, free, driver = parts[:4]
    try:
        return {
            "name": name,
            "total_memory_mb": float(total),
            "free_memory_mb": float(free),
            "driver_version": driver,
        }
    except ValueError:
        return None


def collect(model_manager=None) -> GpuDiagnostics:
    smi = run_nvidia_smi()

    ct2_version: str | None = None
    ct2_cuda_count: int | None = None
    ct2_error: str | None = None
    try:
        import ctranslate2

        ct2_version = ctranslate2.__version__
        ct2_cuda_count = ctranslate2.get_cuda_device_count()
    except Exception as exc:  # noqa: BLE001 — surfaced to the diagnostics payload, not raised
        ct2_error = str(exc)

    gpu_available = bool(smi) and (ct2_cuda_count or 0) > 0

    loaded_model = compute_type = device_in_use = None
    if model_manager is not None and model_manager.current is not None:
        loaded_model = model_manager.current.model_name
        compute_type = model_manager.current.compute_type
        device_in_use = model_manager.current.device

    error = None
    if not smi:
        error = "nvidia-smi indisponível: sem GPU, driver não exposto ao container, ou modo CPU"
    elif ct2_error:
        error = f"CTranslate2 não conseguiu consultar CUDA: {ct2_error}"

    return GpuDiagnostics(
        gpu_available=gpu_available,
        gpu_name=smi["name"] if smi else None,
        total_memory_mb=smi["total_memory_mb"] if smi else None,
        free_memory_mb=smi["free_memory_mb"] if smi else None,
        driver_version=smi["driver_version"] if smi else None,
        cuda_runtime_version=os.environ.get("CUDA_BASE_IMAGE_VERSION"),
        ctranslate2_version=ct2_version,
        ctranslate2_cuda_device_count=ct2_cuda_count,
        loaded_model=loaded_model,
        compute_type=compute_type,
        device_in_use=device_in_use,
        checked_at=time.time(),
        error=error,
    )


if __name__ == "__main__":
    diagnostics = collect()
    print(json.dumps(diagnostics.model_dump(), indent=2, ensure_ascii=False))
