# Troubleshooting

## GPU não aparece / `docker compose run --rm worker nvidia-smi` falha

- Confirme que o driver NVIDIA está instalado no **host** (Windows: driver normal, não dentro do
  WSL; Linux: driver + NVIDIA Container Toolkit).
- Linux: `sudo systemctl restart docker` depois de instalar o toolkit.
- Windows: confirme que o Docker Desktop está usando o backend WSL2 (Settings → General) e que a
  versão do driver suporta GPU passthrough para WSL (qualquer driver Game Ready/Studio recente
  serve).
- Rode `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi` diretamente —
  se isso falhar, o problema é do Docker/driver, não da aplicação.
- Lembre-se: `docker compose up` (sem o override `docker-compose.gpu.yml`) **não** reserva GPU de
  propósito — use `make up` ou `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up`.

## `GPU_OUT_OF_MEMORY` / falha ao carregar o modelo

O worker tenta uma escada de fallback automática e registrada em log (nunca silenciosa):
compute type mais leve → modelo menor → CPU. Veja os logs do worker
(`docker compose logs worker`) por `loading_model_attempt_failed` para ver cada tentativa e o
erro real do CTranslate2. Se mesmo `int8` falhar para o `large-v3`/`turbo`, tente:

```env
TRANSCRIPTION_COMPUTE_TYPE=int8
DEFAULT_MODEL=medium
```

Outros processos usando a GPU (jogos, outro container) reduzem a VRAM livre — confira em
`GET /api/health/gpu` ou na tela de Configurações.

## Erro de versão CUDA/cuDNN ao iniciar o worker

A imagem usa `nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04` (CUDA 12.4 + cuDNN 9), requisito do
CTranslate2 ≥ 4.5. Isso é compatível com qualquer driver NVIDIA que suporte CUDA ≥ 12.4 (drivers
são retrocompatíveis com runtimes CUDA mais antigos). Se seu driver for muito antigo para CUDA
12.4, atualize o driver NVIDIA do host — não é possível contornar isso trocando algo no container.

## Upload falha ou trava

- Verifique `MAX_UPLOAD_BYTES` no `.env` (padrão 5 GiB).
- O Caddyfile também limita o corpo da requisição a 5 GB (`infra/gateway/Caddyfile`,
  `request_body { max_size }`) — ajuste ambos juntos se precisar de arquivos maiores.
- Extensão não suportada ou conteúdo que não sniffa como áudio/vídeo real retorna
  `415 UNSUPPORTED_FORMAT` — confira `error.details.detected_mime` na resposta.
- Arquivo sem faixa de áudio (ex.: vídeo mudo) retorna `400 NO_AUDIO_TRACK`.

## "Job já está em estado terminal" ao cancelar / retry não funciona

Jobs só podem ser cancelados enquanto não estão em `completed`/`failed`/`cancelled`, e só podem
ser reprocessados (`retry`) a partir de `failed`/`cancelled`. Isso é validação intencional (não é
um bug) — veja `apps/api/app/services/job_service.py`.

## Banco "database is locked"

Não deveria acontecer em uso normal (WAL + `busy_timeout=5000` + transações curtas). Se acontecer
sob carga muito alta, é sinal de que chegou a hora de migrar para Postgres — a camada de acesso já
foi desenhada para isso (troque `DATABASE`/`sqlalchemy.url` e rode as migrações Alembic contra o
Postgres; nenhuma lógica de domínio depende de SQLite especificamente).

## Não consigo acessar pela LAN

- Confirme que o firewall do Windows/Linux libera a porta 8080 para a rede local.
- Descubra o IP correto da máquina host: `ipconfig` (Windows, procure "Endereço IPv4") ou
  `ip addr show` (Linux).
- O gateway escuta em `0.0.0.0:8080` dentro do container por padrão — não precisa mudar nada na
  aplicação, só garantir que a porta chega até a máquina.

## Modelo é baixado de novo a cada restart

Isso não deveria acontecer — modelos ficam no volume nomeado `model_cache`. Se estiver
acontecendo, confirme que você não está rodando com `docker compose down -v` (que remove volumes)
nem sobrescrevendo `MODEL_CACHE_DIR` para um caminho efêmero fora do volume montado.

## `docker compose build` do worker demora muito / imagem grande

Normal na primeira vez: a imagem base `nvidia/cuda:...-cudnn-runtime-ubuntu22.04` mais
`ctranslate2`/`onnxruntime` somam alguns GB. Builds subsequentes reaproveitam cache de camadas do
Docker enquanto `apps/worker/requirements.txt` não mudar.

## Testes locais (fora do Docker) no Windows

- `python -m pytest` em `apps/api`/`apps/worker` funciona nativamente no Windows **desde que**
  `ffmpeg`/`ffprobe` estejam no PATH — o import de `magic` (libmagic) é isolado atrás de um import
  tardio especificamente porque ele **causa segfault** no Windows sem libmagic instalada; os
  testes da API substituem essa função por um dublê (`tests/conftest.py`) e nunca importam o
  módulo `magic` real fora do container Linux.
