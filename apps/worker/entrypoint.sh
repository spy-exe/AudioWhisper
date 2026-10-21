#!/bin/sh
set -e

# `docker compose run --rm worker <cmd>` (nvidia-smi, diagnostics, smoke test, a shell, ...)
# must run exactly that command, not the worker loop — so only default to the worker when no
# arguments were passed.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

echo "[worker] device=${TRANSCRIPTION_DEVICE:-cuda} model=${DEFAULT_MODEL:-turbo} compute_type=${TRANSCRIPTION_COMPUTE_TYPE:-int8_float16}"
exec python -m app.worker_main
