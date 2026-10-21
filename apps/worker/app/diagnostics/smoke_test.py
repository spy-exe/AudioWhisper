"""End-to-end GPU smoke test, runnable directly:

    python -m app.diagnostics.smoke_test

Steps (per project spec section 16):
  1. detect CUDA
  2. initialize CTranslate2
  3. load the configured model
  4. process a small bundled audio fixture
  5. confirm the GPU was actually used (VRAM delta + device actually used)

Exits non-zero on any failure so it can gate a deploy/CI step.
"""

import sys
import time
from pathlib import Path

from audiowhisper_core.config import get_settings

from app.diagnostics.gpu import run_nvidia_smi, collect
from app.model_manager import ModelManager

FIXTURE = Path(__file__).parent / "fixtures" / "smoke.wav"


def main() -> int:
    settings = get_settings()
    print("== AudioWhisper GPU smoke test ==")

    print("\n[1/5] Detectando CUDA via nvidia-smi...")
    before = run_nvidia_smi()
    if before is None:
        print("  AVISO: nvidia-smi não disponível — seguindo em modo CPU se configurado.")
    else:
        print(f"  GPU: {before['name']} | driver {before['driver_version']} | "
              f"livre {before['free_memory_mb']:.0f} / {before['total_memory_mb']:.0f} MiB")

    print("\n[2/5] Inicializando CTranslate2...")
    try:
        import ctranslate2
        cuda_count = ctranslate2.get_cuda_device_count()
        print(f"  CTranslate2 {ctranslate2.__version__} — dispositivos CUDA visíveis: {cuda_count}")
    except Exception as exc:
        print(f"  ERRO: falha ao inicializar CTranslate2: {exc}")
        return 1

    device = settings.transcription_device
    compute_type = settings.transcription_compute_type
    model_name = settings.default_model
    print(f"\n[3/5] Carregando modelo '{model_name}' (device={device}, compute_type={compute_type})...")
    manager = ModelManager(settings)
    t0 = time.time()
    try:
        loaded = manager.get_model(model_name, device, compute_type, job_id="smoke-test")
    except Exception as exc:
        print(f"  ERRO: falha ao carregar modelo: {exc}")
        return 1
    print(f"  Modelo carregado em {time.time() - t0:.1f}s "
          f"(config efetiva: {loaded.model_name}/{loaded.device}/{loaded.compute_type})")

    print(f"\n[4/5] Transcrevendo áudio de teste ({FIXTURE.name})...")
    t0 = time.time()
    segments, info = loaded.model.transcribe(str(FIXTURE), vad_filter=True, beam_size=5)
    segments = list(segments)
    elapsed = time.time() - t0
    print(f"  Idioma detectado: {info.language} (p={info.language_probability:.2f})")
    print(f"  Duração do áudio: {info.duration:.2f}s | tempo de processamento: {elapsed:.2f}s")
    for seg in segments:
        print(f"  [{seg.start:.2f}-{seg.end:.2f}] {seg.text.strip()}")

    if not segments:
        print("  ERRO: nenhum segmento transcrito — fixture de áudio pode estar quebrada.")
        return 1

    print("\n[5/5] Confirmando uso real da GPU...")
    after = run_nvidia_smi()
    used_cuda = loaded.device == "cuda"
    if not used_cuda:
        print(f"  device efetivo = '{loaded.device}' (não é 'cuda') — GPU NÃO foi utilizada nesta execução.")
        if device == "cuda":
            print("  O fallback controlado foi acionado; veja os logs 'loading_model_attempt_failed' acima.")
            return 1
        print("  Configuração solicitada era CPU — resultado esperado.")
        return 0

    if before is not None and after is not None:
        delta = before["free_memory_mb"] - after["free_memory_mb"]
        print(f"  VRAM livre antes: {before['free_memory_mb']:.0f} MiB | depois: {after['free_memory_mb']:.0f} MiB "
              f"| delta consumido: {delta:.0f} MiB")
        if delta <= 0:
            print("  AVISO: nenhuma redução de VRAM livre detectada — investigar.")
            return 1
    print("  GPU utilizada com sucesso.")

    diagnostics = collect(manager)
    print("\nDiagnóstico final:")
    print(diagnostics.model_dump_json(indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
