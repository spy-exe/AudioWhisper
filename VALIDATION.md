# Validação

## Studio 2.1 — 22/10/2026

QA em Linux (CT de desenvolvimento, Debian 13, 4 vCPU, sem GPU), com a stack de produção montada sem Docker: Redis, API (uvicorn), worker (RQ SimpleWorker, CPU, `small`/int8), Next em modo produção e o mesmo Caddyfile do gateway na porta 8080. Transcrição real com faster-whisper; os testes de navegador usam áudio sintético. Python 3.12, como no CI.

| Verificação | Resultado |
|---|---|
| API e núcleo compartilhado | 184 testes aprovados (eram 70); cobertura de linhas 97% (era 88,8%) |
| Worker | 66 testes aprovados (eram 32); cobertura de linhas 96% (era 66,3%) |
| Frontend | 208 testes aprovados (eram 71); cobertura de linhas 77,6% (era 54%); metas por arquivo novas |
| TypeScript, ESLint e build de produção | Aprovados |
| Fluxos completos (Chromium desktop e Pixel 7) | 50 aprovados, 2 dispensados (capturador Windows fora do Windows), 0 falhas, em 11,5 min, com 2 workers; sem o fluxo de IA (sem Ollama) |
| Acessibilidade automatizada (axe, WCAG A/AA) | Diálogo de atalhos, editor com insights e busca por momentos sem violações |

O fluxo de documentos com Ollama não foi executado neste ambiente, que não tem Ollama nem GPU. A mudança nele nesta versão (excluir documento e nome do arquivo baixado) está coberta por testes de API e de componente. O cenário do capturador Windows se dispensa sozinho fora do Windows.

### Regressões e defeitos encontrados nesta rodada

- `Range: bytes=-N` servia os primeiros N bytes em vez dos últimos. O teste foi validado por mutação: com o código antigo, ele falha.
- VTT sem escape de `<`, `>` e `&`; legendas com trechos vazios encerravam o bloco antes da hora.
- "Tentar novamente" após falha não voltava a acompanhar o job: a página mantinha o estado de erro.
- Atalhos de letra paravam depois de clicar em qualquer botão (o foco no botão contava como digitação).
- Um arquivo escolhido antes de as configurações carregarem ficava preso ao modelo `turbo`, ignorando o padrão salvo. Achado no E2E, quando o worker com limite de memória foi encerrado ao carregar um modelo maior. O teste foi validado por mutação.
- O indicador de fila estourava o cabeçalho em 320px.
- A fila indisponível deixava o job em "Na fila" para sempre; agora ele vai para falha com nova tentativa.
- Uma gravação podia ser excluída com diarização ou documento ainda em andamento no worker.
- A fila listava os 20 jobs mais antigos e escondia o que estava transcrevendo; agora mostra primeiro os que estão rodando e informa o total.
- PDF e DOCX mostravam `**` e linhas de tabela Markdown cruas.

### Reproduzir

```bash
python -m pytest apps/api/tests -c apps/api/pytest.ini --cov=apps/api/app --cov=packages/core/src/audiowhisper_core --cov-fail-under=95
python -m pytest apps/worker/tests -c apps/worker/pytest.ini --cov=apps/worker/app --cov-fail-under=90
cd apps/web && npm run lint && npm run typecheck && npm run test:coverage && npm run build
E2E_BASE_URL=http://localhost:8080 npx playwright test --grep-invert "local AI document"   # sem Ollama
```

Os testes E2E que mudam configurações globais restauram o estado ao terminar, mesmo quando falham. Rode o E2E com o worker usando o mesmo modelo padrão configurado na interface.

## Validação anterior — 21/10/2026 (Studio 2.0)

QA local em Windows, Chromium desktop e emulação Pixel 7, com a aplicação de produção em Docker Compose. Transcrição real com faster-whisper `turbo`, CUDA/float16 e RTX 5060; documentos com Ollama `qwen3:4b`. Os testes de navegador usam áudio sintético. Capturas da biblioteca são filtradas pelo SHA-256 da reunião de teste; o modo Windows usa uma entrada sintética e oculta o histórico pessoal.

## Resultados

| Verificação | Resultado |
|---|---|
| API e núcleo compartilhado | 70 testes aprovados; cobertura de linhas 88,78% |
| Worker | 32 testes aprovados; cobertura de linhas 66,31% |
| Frontend | 71 testes aprovados; cobertura de linhas 54,04% |
| Capturador Windows | 26 testes aprovados; cobertura de linhas 77,88% |
| Fluxos completos no Chromium desktop e Pixel 7 | 41 aprovados; caso exclusivo do capturador Windows dispensado no projeto mobile |
| TypeScript, ESLint e build de produção | Aprovados |
| Auditoria npm das dependências de produção | Zero vulnerabilidades reportadas |
| Studio, biblioteca, configurações e editor | 24 combinações em 320, 390, 768, 1024, 1440 e 1920px sem estouro horizontal |
| Capturador Windows | Mais seis larguras, estados pronto/gravando e reconexão à mesma sessão após fechar o Chromium inteiro |
| Estados visuais adicionais | Biblioteca carregando, busca sem resultados e erro recuperável |
| Acessibilidade automatizada | Sem violações nos testes axe de Studio, biblioteca, configurações e editor |
| Movimento | Mudança real entre frames, preferência do sistema e opção de desativar efeitos exercitadas |

Os testes de acessibilidade aplicam as regras WCAG A/AA disponíveis no axe; não substituem uma auditoria manual completa nem testes com leitores de tela. O modo Windows também passa por axe em 390, 1440 e 1920px. Cartões de fonte empilham no celular e os seletores têm pelo menos 24px.

A suíte completa passou em uma execução de 5,3 minutos. Depois da correção da afinidade de thread do WASAPI, os testes nativos e o cenário de fechar/reabrir o navegador foram repetidos com sucesso. Execute E2E sem análises pessoais concorrentes na mesma instalação.

O corpo foi medido em 17px, campos em pelo menos 16px e transcrição em 19px em todos os tamanhos. A amostra local de 120 frames com a arte espectral animada em 1440px registrou mediana de 16,7ms e percentil 95 de 33,4ms, sem frames acima de 50ms, durante QA concorrente. É uma medição desta máquina, sem simulação de hardware lento.

## Cobertura e limites

A cobertura contabiliza o código completo de cada escopo, incluindo rotas e componentes que também são exercitados pelo navegador. A cobertura de linhas dos testes de navegador não é somada à dos testes unitários. Há limites mínimos globais e por módulo no Vitest; o CI também exige pelo menos 88% para API/núcleo, 65% para worker e 75% para capturador Windows.

| Módulo | Cobertura de linhas |
|---|---|
| Captura/PCM/WAV no navegador | 97,91% |
| Biblioteca | 91,04% |
| Assistente de documentos | 88,05% |
| Revisão e apresentação de documento | 86,66% |
| Autenticação no frontend | 100% |
| Recuperação do worker | 100% |
| Pipeline de transcrição | 90% |
| Diário e recuperação do capturador Windows | 94,66% |

O resultado detalhado está em [coverage-summary.json](docs/qa/coverage-summary.json). O CI publica os relatórios completos como artefatos. A cobertura global do frontend ainda é parcial; há lacunas em upload, configurações e componentes de mídia na suíte unitária. Esses fluxos têm testes de navegador, sem equivalência automática a cobertura de linhas.

O relatório do capturador inclui o ponto de entrada da bandeja, cuja interação não tem cobertura automatizada. Testes nativos cobrem persistência antes do envio, diário parcial após interrupção, arquivo danificado, falha de rede, mistura/resampling e preparação, uso e liberação de dispositivos na mesma thread. O smoke test WASAPI real recebeu 1,3s de amostras nos modos desktop e combinado, com proteção de suspensão ativa e recursos liberados, usando um destino em memória que não salva áudio pessoal. Veja o [guia do capturador](docs/WINDOWS_CAPTURE.md).

Community-1 não foi executado com o modelo autorizado nesta instalação. O cálculo de sobreposição temporal tem testes; a qualidade da diarização real ainda requer validação com o modelo. SMTP externo, OBS físico/entrada virtual e áudio de tela precisam de configuração e verificação no dispositivo. Os testes de SMTP usam substituto local e não enviam mensagens.

A árvore completa de ferramentas npm ainda reporta cinco alertas altos derivados de `braces`, utilizado pelo lint, sem versão corrigida disponível nesta data. As dependências de produção têm auditoria limpa. O alerta está registrado no [GitHub Advisory Database](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

## Regressões verificadas

- Cancelamento cooperativo sem sinalizar o processo do SimpleWorker ou interromper o ffmpeg.
- Cancelamento após extração sem carregar um modelo desnecessariamente.
- Retomada de transcrições, documentos e trechos persistidos sem duplicar trabalho já enfileirado.
- Escrita local de novos trechos enquanto uploads anteriores aguardam resposta; recuperação após recarregar a página.
- Segmentos confirmados deduplicados e separados das revisões provisórias.
- Edição, salvamento, desfazer, busca, substituição, timestamps, reprodução e exportação SRT.
- Busca remota com debounce, composição de texto, cancelamento de requests antigos, filtros e paginação.
- Fontes de documentos ligadas a segmentos existentes, com citações literais e valores desconhecidos preservados.
- Citações copiadas pelo servidor a partir das fontes selecionadas, sem depender da reprodução literal pelo modelo; IDs inválidos continuam recusados.
- Lotes dimensionados pelo payload completo, incluindo muitos segmentos curtos e seus metadados, preservando a ordem e todas as fontes.
- Revisão antes do compartilhamento; alterações da fonte invalidam documentos e links.
- Geração real, revisão, exportação PDF/DOCX, abertura e revogação de link privado.
- Markdown sem execução de HTML, links JavaScript ou imagens remotas.
- Token mascarado, recuperação de sessão, validação SMTP e idempotência em resultado incerto.

## Reproduzir

Instale as dependências Python de desenvolvimento e o núcleo compartilhado. Mantenha Redis acessível em localhost:6379 para a suíte Python; os testes usam banco temporário e filas próprias.

```powershell
python -m pip install -e packages/core -r apps/api/requirements-dev.txt -r apps/worker/requirements-dev.txt
New-Item -ItemType Directory -Force .devdata | Out-Null
python -m pytest apps/api/tests -c apps/api/pytest.ini --basetemp=.devdata/pytest-api --cov=apps/api/app --cov=packages/core/src/audiowhisper_core --cov-fail-under=88
python -m pytest apps/worker/tests -c apps/worker/pytest.ini --basetemp=.devdata/pytest-worker --cov=apps/worker/app --cov-fail-under=65
```

Em `apps/web`:

```powershell
npm ci
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:visual
```

E2E requer a stack e os modelos locais disponíveis em `http://localhost:8080` (ou `E2E_BASE_URL`). Execute o QA visual depois do E2E: ele reutiliza a reunião sintética concluída e o runner limpa o diretório de resultados ao iniciar. Capturas e medições ficam em `apps/web/test-results/visual`. A [galeria](docs/SCREENSHOTS.md) contém exemplos revisados.
