# AudioWhisper 2.1

Aplicativo local para gravar, transcrever e organizar áudio. Captura em segundo plano no Windows,
transcrição com GPU, biblioteca pesquisável, editor de falantes e preparação de documentos com
fontes verificáveis. Exportação em oito formatos, pacote ZIP e compartilhamento após revisão explícita.

O [workspace](docs/WORKSPACE.md) conecta projetos, busca por trechos, quadro de tarefas,
notas e capítulos, consultas entre reuniões e modelos de documento. Abra
`http://localhost:8080/workspace` ou pressione **Ctrl+K** para acessar as ferramentas.

![Studio com captura e importação](docs/screenshots/studio-desktop.png)

Interface com Manrope e IBM Plex Sans locais, texto de 17px e transcrição de 19px. Captura,
biblioteca, editor e documentos compartilham a mesma identidade visual. Os efeitos respeitam
a preferência de movimento reduzido e podem ser desativados nas configurações. Formulários e
opções secundárias ficam recolhidos, com preservação de rascunhos e indicação dos filtros ativos.

O editor reúne revisão de trechos incertos, divisão e junção de segmentos, atribuição manual
de participantes e marcadores com atalhos de teclado. A biblioteca permite organizar várias
gravações de uma vez. Vocabulário personalizado, fila de processamento e uso do armazenamento
ficam nas configurações. Entradas de tela, abas, diálogos e recolhíveis possuem transições próprias.

Veja as [capturas de desktop e mobile](docs/SCREENSHOTS.md), o [design system](DESIGN.md) e o
[relatório de QA e cobertura](VALIDATION.md). O workflow Quality executa lint, TypeScript,
testes, cobertura, build e auditoria das dependências de produção.

Veja [STUDIO_2.md](STUDIO_2.md) para iniciar o Ollama local, configurar diarização, captura OBS,
recuperação, autenticação e compartilhamento privado.

Para gravar o desktop e o microfone mesmo depois de fechar o navegador, use **Windows · segundo plano**.
O [capturador Windows](docs/WINDOWS_CAPTURE.md) fica na bandeja, preserva o áudio em disco e reenvia
trechos após reconexão. Inicie-o com `.\scripts\Start-Capturador.ps1` antes de gravar.

O [AudioWhisper Mobile](docs/MOBILE.md) conecta Android e iPhone ao mesmo PC pela rede local ou VPN.
O Android tem captura nativa de microfone e áudio permitido de outros aplicativos, armazenamento
local e texto ao vivo processado pela GPU do PC. A base iOS inclui microfone em segundo plano;
captura de outros apps no iPhone exige uma extensão adicional. Consulte a documentação para
instalação, limites de cada sistema e resultados de validação.

## Requisitos

- Docker Desktop (Windows/macOS) ou Docker Engine + Docker Compose v2 (Linux)
- Para transcrição em GPU: driver NVIDIA instalado no host e o **NVIDIA Container Toolkit**
  - **Linux**: instale o [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) e reinicie o Docker daemon.
  - **Windows**: Docker Desktop com backend WSL2 + driver NVIDIA para WSL instalado no Windows
    (não instale o driver dentro da distro WSL). O Docker Desktop expõe a GPU automaticamente aos
    containers Linux quando o toolkit está presente.
- ~10 GiB livres para as imagens Docker e ~1.5 GiB por modelo baixado (cache persistente, não
  baixado novamente entre restarts)
- GPU de referência testada: NVIDIA RTX 5060 (8 GiB VRAM). A imagem do worker usa runtime
  CUDA 12.4; o diagnóstico nas configurações mostra o driver e os recursos disponíveis.

## Início rápido

```bash
make setup        # cria .env a partir de .env.example
make build        # build de todas as imagens (a primeira vez demora — imagem CUDA é grande)
make up            # sobe a stack completa com GPU
```

Sem `make` (ex.: Windows sem WSL/Make instalado), use os comandos `docker compose` equivalentes —
veja a seção "Comandos sem Make" abaixo.

Acesse:

- `http://localhost:8080` — na própria máquina
- `http://<IP-da-máquina>:8080` — de outro dispositivo na mesma rede local (o gateway escuta em
  `0.0.0.0`; descubra o IP com `ipconfig` no Windows ou `ip addr` no Linux)

## Modo CPU (desenvolvimento/diagnóstico, sem GPU)

```bash
make up-cpu
```

Isso sobe a stack sem solicitar um dispositivo GPU ao Docker (evita falha em máquinas sem NVIDIA
Container Toolkit) e força `TRANSCRIPTION_DEVICE=cpu`. Transcrição funciona, porém mais lenta.

## Comandos sem Make

```bash
cp .env.example .env
docker compose build
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d   # com GPU
docker compose up -d                                                    # sem GPU (CPU)
docker compose down
docker compose logs -f --tail=200
```

## Primeiro uso

1. Abra `http://localhost:8080`.
2. Arraste um arquivo de áudio ou vídeo (formatos: wav, mp3, m4a, aac, flac, ogg, opus, mp4, mkv,
   mov, webm, avi).
3. Escolha modelo e idioma (ou deixe em detecção automática) e clique em "Transcrever".
4. Acompanhe o progresso em tempo real. Na primeira transcrição com um modelo novo, o download do
   modelo (Hugging Face) acontece uma vez e fica em cache no volume `model_cache` — restarts
   subsequentes não baixam de novo.
5. Ao concluir, edite a transcrição, use a waveform para navegar, pesquise/substitua texto e
   exporte em PDF, DOCX, TXT, Markdown, JSON, SRT ou VTT.

## Onde ficam os dados

Tudo é persistido em **volumes nomeados do Docker** (sobrevivem a `docker compose down` e a
restarts; só são removidos com `docker compose down -v`, o que nunca é feito automaticamente):

| Volume | Conteúdo |
|---|---|
| `db_data` | banco SQLite (`audiowhisper.db`, modo WAL) |
| `uploads_data` | arquivos de mídia originais enviados |
| `exports_data` | arquivos exportados (TXT/MD/JSON/SRT/VTT) |
| `model_cache` | modelos faster-whisper baixados (Hugging Face) |
| `tmp_data` | áudio intermediário do ffmpeg — limpo automaticamente após cada job |
| `redis_data` | fila de jobs (AOF) |

Para inspecionar: `docker volume inspect audiowhisper_db_data` (o prefixo do projeto é o nome do
diretório). Para backup, pare a stack e copie os volumes (`docker run --rm -v
audiowhisper_db_data:/data -v $PWD/backup:/backup alpine tar czf /backup/db.tar.gz /data`, e o
mesmo para os demais volumes).

## Portas

Apenas uma porta é publicada no host: `8080` (gateway Caddy). API, worker, Redis e frontend não
expõem portas ao host — só são alcançáveis entre si pela rede interna do Compose.

## Acesso pela LAN

O gateway escuta em `0.0.0.0:8080` dentro do container e o Compose publica essa porta no host, que
por sua vez está acessível pela LAN se o firewall do SO permitir a porta 8080. Nenhuma configuração
adicional é necessária no frontend — ele nunca referencia o hostname interno do backend, apenas
caminhos relativos (`/api/...`, `/ws/...`) resolvidos pelo próprio navegador contra a origem atual.

Para restringir o acesso pela LAN, defina `ACCESS_TOKEN` no `.env`. O navegador oferece login e usa
cookie HttpOnly para API, WebSocket, player e downloads. Clientes locais também podem usar
`X-Access-Token`. Links privados revisados permitem somente a leitura do documento compartilhado.

## Atualização segura

```bash
git pull
docker compose build
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

Os volumes (banco, uploads, modelos) não são afetados por rebuilds de imagem. Migrações do banco
rodam automaticamente na inicialização do container `api` (`alembic upgrade head`).

## Troubleshooting

Veja [TROUBLESHOOTING.md](TROUBLESHOOTING.md) para problemas de CUDA/cuDNN/VRAM, GPU não detectada,
modelo não carrega, upload falha, etc.

## Desenvolvimento

Veja [ARCHITECTURE.md](ARCHITECTURE.md) para a arquitetura completa, estrutura de diretórios e
decisões de design.

```bash
make test          # testes de api, worker e web
make test-e2e       # Playwright na stack isolada de QA, porta 8090 (veja VALIDATION.md)
make gpu-check      # nvidia-smi + diagnóstico CTranslate2 + smoke test real de transcrição
make lint           # lint + typecheck do frontend
make clean-temp     # limpa apenas /data/tmp (nunca uploads/exports/db)
```
