SHELL := /bin/sh
COMPOSE := docker compose
GPU_FILES := -f docker-compose.yml -f docker-compose.gpu.yml

.PHONY: setup build up up-cpu down logs test test-api test-worker test-web test-e2e gpu-check lint clean-temp migrate

setup:
	@[ -f .env ] || cp .env.example .env
	@echo "Edite .env se necessário. Depois rode: make build && make up"

build:
	$(COMPOSE) build

## Starts the full stack with GPU access granted to the worker (RTX 5060 etc).
up:
	$(COMPOSE) $(GPU_FILES) up -d
	@echo "Acesse http://localhost:$${HOST_PORT:-8080}"

## Starts the full stack without requesting a GPU device — worker runs on CPU.
up-cpu:
	TRANSCRIPTION_DEVICE=cpu $(COMPOSE) up -d
	@echo "Acesse http://localhost:$${HOST_PORT:-8080} (modo CPU)"

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f --tail=200

migrate:
	$(COMPOSE) run --rm api python -m alembic -c /packages/core/alembic.ini upgrade head

test: test-api test-worker test-web

test-api:
	cd apps/api && python -m pytest -q

test-worker:
	cd apps/worker && python -m pytest -q

test-web:
	cd apps/web && npm test

test-e2e:
	cd apps/web && npm run test:e2e

## Real GPU diagnostics: nvidia-smi inside the worker container + the CTranslate2 smoke test.
gpu-check:
	$(COMPOSE) $(GPU_FILES) run --rm worker nvidia-smi
	$(COMPOSE) $(GPU_FILES) run --rm worker python -m app.diagnostics.gpu
	$(COMPOSE) $(GPU_FILES) run --rm worker python -m app.diagnostics.smoke_test

lint:
	cd apps/web && npm run lint && npm run typecheck

clean-temp:
	$(COMPOSE) run --rm api sh -c "rm -rf /data/tmp/*"
	$(COMPOSE) run --rm worker sh -c "rm -rf /data/tmp/*"
