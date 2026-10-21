FROM python:3.12-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        libmagic1 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY packages/core/pyproject.toml /packages/core/pyproject.toml
RUN mkdir -p /packages/core/src/audiowhisper_core && pip install --no-cache-dir -e /packages/core

COPY apps/api/requirements.txt /srv/requirements.txt
RUN pip install --no-cache-dir -r /srv/requirements.txt
COPY packages/core /packages/core

COPY apps/api/app /srv/app
COPY apps/api/entrypoint.sh /srv/entrypoint.sh
RUN chmod +x /srv/entrypoint.sh

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

ENTRYPOINT ["/srv/entrypoint.sh"]
