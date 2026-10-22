# Arquitetura

> A evolução para o Studio 2.0 está documentada em [STUDIO_2.md](STUDIO_2.md), incluindo os novos
> módulos e as mudanças de captura, falantes, IA, distribuição e autenticação. A fila de GPU continua
> serial; SQLite e os volumes existentes foram preservados.

## Visão geral

```
Browser ── http://localhost:8080 (ou http://IP-LAN:8080)
    │
    ▼
gateway (Caddy) ── única porta publicada no host
    ├── /            → web (Next.js)
    ├── /api/*        → api (FastAPI)
    └── /ws/*         → api (WebSocket)

api (FastAPI) ──enqueue──▶ Redis (RQ) ──dequeue──▶ worker (SimpleWorker, GPU)
   │                                                    │
   │ publica progresso via pub/sub Redis                │
   ▼                                                    ▼
SQLite (WAL) ◀────────────── grava segmentos/status ────┘
   │
volumes nomeados: db_data, uploads_data, exports_data, model_cache, tmp_data
```

Nenhum container além do `worker` enxerga a GPU (`docker-compose.gpu.yml` só adiciona a
reserva de dispositivo ao serviço `worker`). O frontend nunca conhece hostnames internos —
toda comunicação é via caminhos relativos (`/api/*`, `/ws/*`), resolvidos pelo gateway.

## Por que essas escolhas

**RQ + Redis em vez de Celery.** Um único worker processando um job por vez (GPU de 8 GiB não
comporta dois modelos grandes carregados simultaneamente) não precisa do roteamento
multi-fila/multi-worker do Celery. RQ é mais simples de operar, depurar e tem uma API de
remoção de jobs ainda na fila (`Job.cancel()`). Jobs em execução usam cancelamento cooperativo.

**RQ `SimpleWorker`, não o `Worker` padrão.** O `Worker` padrão do RQ faz fork de um processo
("work horse") por job, para isolamento. Isso destruiria o objetivo de manter o modelo
carregado entre trabalhos — cada job recarregaria o modelo do zero. O
`SimpleWorker` roda os jobs no mesmo processo, então `ModelManager` (um singleton em
`apps/worker/app/model_manager.py`) mantém o `WhisperModel`/contexto CUDA vivo entre jobs.
O cancelamento não envia sinais de processo: `SimpleWorker` não possui work-horse separado, e um sinal pode interromper o ffmpeg. O worker consulta `cancel_requested` entre extração, carga do modelo, segmentos e exportação (ver `apps/worker/app/tasks.py`).

**SQLite com WAL, não Postgres, no MVP.** Aplicação local single-user. `PRAGMA journal_mode=WAL`
+ `busy_timeout=5000` + transações curtas (commit logo após cada mutação, nunca uma transação
aberta durante o loop de transcrição) evita contention entre o processo `api` e o processo
`worker` escrevendo no mesmo arquivo. A camada de acesso (SQLAlchemy 2.0 declarative, em
`packages/core`) não vaza detalhes de SQLite para o resto do código — trocar por Postgres depois
é uma mudança de `DATABASE_URL` e de `alembic.ini`, não de lógica de domínio.

**Motores locais separados.** A transcrição usa faster-whisper/CTranslate2 e Silero VAD. O worker
2.0 inclui o extra PyTorch/pyannote para diarização CPU com Community-1, desabilitável no build por
`INSTALL_DIARIZATION=false`. Antes de análises com Ollama ou pyannote, o worker libera o modelo
Whisper. Não há inferência remota como fallback.

**Extração de áudio própria via ffmpeg, mesmo faster-whisper aceitando decodificar direto.**
Ainda que o `WhisperModel.transcribe()` do faster-whisper aceite qualquer arquivo de mídia
diretamente (decodifica via PyAV internamente), o worker primeiro normaliza para WAV mono 16kHz
com `ffmpeg` (`apps/worker/app/pipeline/audio_extract.py`, argumentos estruturados, nunca
`shell=True`). Isso produz um artefato intermediário determinístico e mais fácil de depurar, e garante que o pipeline funciona mesmo
que o container não tenha suporte completo a todo codec exótico via PyAV.

**Fallback de GPU limitado e logado, nunca silencioso.** `ModelManager._build_fallback_plan`
monta uma lista finita de tentativas: config solicitada → compute types mais leves (na mesma GPU)
→ modelo menor (na mesma GPU) → CPU como último recurso. Cada tentativa é logada
(`loading_model_attempt`, `loading_model_attempt_failed`, `loading_model_fallback_applied`) e a
config efetivamente usada é gravada de volta no `TranscriptionJob` (`model_name`, `device`,
`compute_type` podem diferir do solicitado se houve fallback).

**Streaming de upload e download com Range.** `apps/api/app/services/media_service.py` lê o
upload em chunks de 1 MiB, nunca materializando o arquivo inteiro em memória, calculando o
SHA-256 incrementalmente. O download do arquivo original (`GET /api/media/{id}/stream`) implementa
suporte a `Range` manualmente (`apps/api/app/range_response.py`) porque a versão do Starlette
usada pelo FastAPI ainda não suporta `Range` em `FileResponse` — sem isso, scrubbing em vídeo/áudio
no player não funcionaria corretamente.

**`python-magic` isolado atrás de um import tardio.** `apps/api/app/mime_sniff.py` só importa o
binding `magic` (libmagic) dentro da função, não no topo do módulo. Isso não é só estilo: no
Windows, `import magic` sem libmagic disponível **causa um crash de segmentação do processo
Python**, não apenas uma exceção capturável — foi descoberto durante o desenvolvimento local desta
aplicação. Isolar o import permite rodar a suíte de testes da API fora do container Linux (onde
`libmagic1` é instalado via apt) sem crashar o interpretador.

## Stack de renderização visual

| Superfície | Tecnologia | Responsabilidade |
|---|---|---|
| Abertura do Studio | SVG + CSS | Linhas espectrais, gradiente e movimento ambiente composto por transform/opacity |
| Processamento ao vivo | PixiJS 2D, carregado sob demanda | Visual de progresso sem carregar uma cena 3D na abertura |
| Waveform do editor | WaveSurfer.js | Navegação na mídia por tempo |
| Ícones de status | Motion + SVG | Estados de fila, processamento, conclusão e falha |
| Microinterações | Motion + CSS | Entrada de painéis, foco, hover e feedback de ações |
| Tipografia | next/font/local | Manrope e IBM Plex Sans variáveis, sem requisições a serviços de fontes |
| Documentos | react-markdown | Títulos e listas sem HTML ou imagens remotas |

`MotionPreferences` combina a preferência do sistema com `visual_effects_enabled`. CSS,
indicadores e Motion compartilham a política. A ilustração do Studio é leve e não inicia
contexto WebGL. A identidade, os tamanhos de texto e as regras responsivas estão em [DESIGN.md](DESIGN.md).

## Modelo de dados

Ver `packages/core/src/audiowhisper_core/models.py` para as definições completas (SQLAlchemy
2.0). Entidades: `MediaFile`, `TranscriptionJob`, `TranscriptSegment`, `ExportFile`,
`ApplicationSettings` e, a partir do Studio 2.0/2.1, `WorkspaceItem`, `AIDocument`, `DocumentShare`,
`DocumentDelivery`, `LiveSession`, `LiveChunk` e `Bookmark`. A conexão SQLite registra a função
`aw_fold` (dobra de acentos e maiúsculas) usada pela busca; ver [STUDIO_2.md](STUDIO_2.md#studio-21--revisão-e-busca). Migração inicial gerada via `alembic revision --autogenerate` a partir
desses modelos (`packages/core/migrations/versions/`).

## Estrutura de diretórios

```
AudioWhisper/
├── apps/
│   ├── web/              # Next.js (App Router, TS strict, Tailwind v4)
│   ├── api/               # FastAPI — upload, jobs, segments, exports, settings, WS
│   └── worker/              # RQ SimpleWorker — pipeline ffmpeg + faster-whisper
├── packages/
│   └── core/               # SQLAlchemy models, schemas Pydantic, enums, config, exports,
│                            #   Alembic — instalado via `pip install -e` em api e worker
├── infra/
│   └── gateway/             # Caddyfile
├── docker-compose.yml        # base (sem GPU)
├── docker-compose.gpu.yml     # override que reserva a GPU só para o worker
├── .env.example
├── Makefile
└── README.md / ARCHITECTURE.md / TROUBLESHOOTING.md
```

## Fluxo de um job

1. `POST /api/media/upload` — streaming a disco, hash, ffprobe, dedup por sha256.
2. `POST /api/jobs` — cria `TranscriptionJob` (status `queued`), enfileira no RQ
   (`app.tasks.process_transcription_job`, referenciado por string — a API nunca importa o
   pacote do worker).
3. O worker desenfileira, executa o pipeline (`preparing` → `extracting_audio` →
   `loading_model` → `transcribing` → `generating_exports` → `completed`), publicando progresso
   via Redis pub/sub (`job:progress:{id}`) e persistindo segmentos incrementalmente a cada
   segmento transcrito.
4. `WS /ws/jobs/{id}` — a API assina o canal pub/sub e repassa cada evento ao navegador; ao
   conectar, envia primeiro um snapshot do estado atual do job (para reconexões).
5. Ao completar, o worker já gera os 5 formatos de export por padrão; o usuário pode gerar
   exports adicionais sob demanda (`POST /api/jobs/{id}/exports`).

## Capturador Windows

`apps/capture/audiowhisper_capture` roda no host Windows, fora dos containers. A API de controle em loopback valida Host e origem do Studio. `CaptureManager` mantém uma thread de captura que prepara, inicia e libera os dispositivos WASAPI; essas operações têm afinidade com a thread. A interface aguarda a preparação antes de confirmar a sessão. O processo não depende da vida da aba.

`SpoolSession` preserva PCM em diário local, consolida WAVs atomicamente e registra confirmações de entrega. Outra thread envia os trechos para `/api/live`, com sequências idempotentes e retomada após falhas. O worker existente transcreve e consolida o áudio. Reiniciar o capturador recupera arquivos e envios pendentes, sem reiniciar o microfone. O [guia operacional](docs/WINDOWS_CAPTURE.md) descreve configuração, armazenamento e limites.
