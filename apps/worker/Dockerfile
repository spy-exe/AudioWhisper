# CUDA 12.4 + cuDNN 9 runtime, matching CTranslate2 >=4.5 requirements (CUDA >=12.3, cuDNN 9)
# and validated against the host's RTX 5060 (driver 591.86 / CUDA 13.1, backward compatible).
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV CUDA_BASE_IMAGE_VERSION=12.4.1-cudnn-runtime-ubuntu22.04 \
    DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        software-properties-common \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y --no-install-recommends \
        python3.12 python3.12-venv python3.12-dev \
        ffmpeg \
        curl \
    && curl -sS https://bootstrap.pypa.io/get-pip.py | python3.12 \
    && ln -sf /usr/bin/python3.12 /usr/local/bin/python \
    && ln -sf /usr/bin/python3.12 /usr/local/bin/python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY packages/core/pyproject.toml /packages/core/pyproject.toml
RUN mkdir -p /packages/core/src/audiowhisper_core && pip install --no-cache-dir -e /packages/core

COPY apps/worker/requirements.txt /srv/requirements.txt
RUN pip install --no-cache-dir -r /srv/requirements.txt
COPY apps/worker/requirements-diarization.txt /srv/requirements-diarization.txt
ARG INSTALL_DIARIZATION=true
RUN if [ "$INSTALL_DIARIZATION" = "true" ]; then pip install --no-cache-dir -r /srv/requirements-diarization.txt; fi
COPY packages/core /packages/core

COPY apps/worker/app /srv/app
COPY apps/worker/entrypoint.sh /srv/entrypoint.sh
RUN chmod +x /srv/entrypoint.sh

ENTRYPOINT ["/srv/entrypoint.sh"]
