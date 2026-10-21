import gc
from dataclasses import dataclass

import numpy as np
from faster_whisper import WhisperModel

from audiowhisper_core.config import Settings
from audiowhisper_core.enums import ErrorCode
from audiowhisper_core.errors import AppError
from audiowhisper_core.logging import configure_logging

logger = configure_logging("worker", "INFO")

VALID_MODELS = ("small", "medium", "turbo", "large-v3")

_MODEL_DOWNGRADE = {"large-v3": "turbo", "turbo": "medium", "medium": "small"}

# Not a strict "cheapest first" ladder: on some architectures (observed on RTX 50-series /
# Blackwell) int8 kernels aren't supported by cuBLAS at all and fail with
# CUBLAS_STATUS_NOT_SUPPORTED — no amount of retrying int8 helps, only switching precision does.
# float16 is tried first as the most broadly-supported fast GPU option, independent of which
# compute type was originally requested.
_COMPUTE_TYPE_FALLBACK_ORDER = ["float16", "int8_float16", "int8", "float32"]

# faster-whisper/CTranslate2 can construct a WhisperModel successfully even when the actual
# compute kernels for that (device, compute_type) aren't supported — the failure only surfaces
# on the first real forward pass. Running this trivial inference at load time means the
# fallback ladder below catches it, instead of a job failing after already reaching `transcribing`.
_VALIDATION_AUDIO = np.zeros(16000, dtype=np.float32)  # 1s of silence at 16kHz


@dataclass
class LoadedModel:
    model: WhisperModel
    model_name: str
    device: str
    compute_type: str


def _free_gpu_model(model: WhisperModel | None) -> None:
    """Explicitly drops the last Python reference to a CTranslate2-backed model and forces a
    collection cycle, instead of waiting for whenever the GC would otherwise get to it.

    This matters because CTranslate2 releases its CUDA allocations from the model's C++
    destructor, which only runs once the object's refcount hits zero — relying on lazy/deferred
    GC here is what caused a real VRAM leak during development: every failed fallback attempt
    (a normal, expected occurrence — see the ladder above) left its partially-constructed model
    resident in VRAM until Python got around to collecting it, and repeated swaps between
    configurations across a long-running worker process eventually exhausted an 8 GiB GPU."""
    if model is None:
        return
    del model
    gc.collect()


class ModelManager:
    """Keeps a single WhisperModel loaded across jobs (per spec section 6: 'Manter o modelo
    carregado entre trabalhos sempre que possível'), reloading only when the requested
    configuration changes, with a bounded, logged fallback ladder on load failure."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.current: LoadedModel | None = None

    def _build_fallback_plan(
        self, model_name: str, device: str, compute_type: str
    ) -> list[tuple[str, str, str]]:
        plan: list[tuple[str, str, str]] = [(model_name, device, compute_type)]

        if device == "cuda":
            for ct in _COMPUTE_TYPE_FALLBACK_ORDER:
                if ct != compute_type:
                    plan.append((model_name, device, ct))

            smaller = model_name
            while smaller in _MODEL_DOWNGRADE:
                smaller = _MODEL_DOWNGRADE[smaller]
                plan.append((smaller, device, compute_type))

            plan.append((model_name, "cpu", "int8"))

        seen: set[tuple[str, str, str]] = set()
        unique_plan = []
        for item in plan:
            if item not in seen:
                seen.add(item)
                unique_plan.append(item)
        return unique_plan

    def get_model(self, model_name: str, device: str, compute_type: str, job_id: str) -> LoadedModel:
        if (
            self.current is not None
            and self.current.model_name == model_name
            and self.current.device == device
            and self.current.compute_type == compute_type
        ):
            return self.current

        if self.current is not None:
            logger.info(
                "releasing_previous_model",
                extra={
                    "job_id": job_id,
                    "stage": "loading_model",
                    "previous": f"{self.current.model_name}/{self.current.device}/{self.current.compute_type}",
                },
            )
            previous_model = self.current.model
            self.current = None
            _free_gpu_model(previous_model)

        attempts = self._build_fallback_plan(model_name, device, compute_type)
        last_error: Exception | None = None

        for attempt_name, attempt_device, attempt_compute in attempts:
            logger.info(
                "loading_model_attempt",
                extra={
                    "job_id": job_id,
                    "stage": "loading_model",
                    "model": attempt_name,
                    "device": attempt_device,
                    "compute_type": attempt_compute,
                },
            )
            model: WhisperModel | None = None
            try:
                model = WhisperModel(
                    attempt_name,
                    device=attempt_device,
                    compute_type=attempt_compute,
                    download_root=str(self.settings.model_cache_dir),
                )
                # construction can succeed even when this (device, compute_type) combination's
                # kernels aren't actually usable — force one real forward pass now.
                list(model.transcribe(_VALIDATION_AUDIO, beam_size=1, vad_filter=False)[0])
            except Exception as exc:  # noqa: BLE001 — CUDA/OOM/runtime errors aren't a stable typed hierarchy
                last_error = exc
                logger.error(
                    "loading_model_attempt_failed",
                    extra={"job_id": job_id, "stage": "loading_model", "error": str(exc)},
                )
                _free_gpu_model(model)
                continue

            self.current = LoadedModel(model, attempt_name, attempt_device, attempt_compute)
            if (attempt_name, attempt_device, attempt_compute) != (model_name, device, compute_type):
                logger.warning(
                    "loading_model_fallback_applied",
                    extra={
                        "job_id": job_id,
                        "stage": "loading_model",
                        "requested": f"{model_name}/{device}/{compute_type}",
                        "used": f"{attempt_name}/{attempt_device}/{attempt_compute}",
                    },
                )
            return self.current

        raise AppError(
            ErrorCode.GPU_OUT_OF_MEMORY if device == "cuda" else ErrorCode.MODEL_LOAD_FAILED,
            "Não foi possível carregar o modelo em nenhuma configuração de fallback",
            {"last_error": str(last_error), "attempts": attempts},
        )
