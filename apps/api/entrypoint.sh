#!/bin/sh
set -e

# `docker compose run --rm api <cmd>` (alembic one-offs, a shell, cleanup commands, ...) must run
# exactly that command — so only auto-migrate-and-serve when no arguments were passed.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

echo "[api] running database migrations..."
python -m alembic -c /packages/core/alembic.ini upgrade head

echo "[api] starting uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log
