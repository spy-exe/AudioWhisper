# Validação — 21/10/2026

QA local em Windows, Chromium desktop e emulação Pixel 7, com a aplicação de produção em Docker Compose. Transcrição real com faster-whisper `turbo`, CUDA/float16 e RTX 5060; documentos com Ollama `qwen3:4b`. O microfone usa um arquivo sintético. As capturas publicadas contêm somente a reunião de teste, identificada pelo SHA-256 do arquivo da suíte.

## Resultados

| Verificação | Resultado |
|---|---|
| API e núcleo compartilhado | 70 testes aprovados; cobertura de linhas 88,78% |
| Worker | 32 testes aprovados; cobertura de linhas 66,31% |
| Frontend | 55 testes aprovados; cobertura de linhas 48,33% |
| Fluxos completos no Chromium desktop e Pixel 7 | 40 cenários aprovados, incluindo retestes com a fila livre |
| TypeScript, ESLint e build de produção | Aprovados |
| Auditoria npm das dependências de produção | Zero vulnerabilidades reportadas |
| Studio, biblioteca, configurações e editor | 24 combinações em 320, 390, 768, 1024, 1440 e 1920px sem estouro horizontal |
| Estados visuais adicionais | Biblioteca carregando, busca sem resultados e erro recuperável |
| Acessibilidade automatizada | Sem violações nos testes axe de Studio, biblioteca, configurações e editor |
| Movimento | Mudança real entre frames, preferência do sistema e opção de desativar efeitos exercitadas |

Os testes de acessibilidade aplicam as regras WCAG A/AA disponíveis no axe; não substituem uma auditoria manual completa nem testes com leitores de tela. Após a suíte completa, os testes visuais e de teclado são repetidos para o ajuste final da posição dos switches.

Na execução posterior à correção das citações, 38 cenários passaram diretamente. Dois testes de editor ultrapassaram a espera de cinco minutos enquanto a fila serial processava a regeneração de uma gravação longa; foram repetidos com a fila livre. Execute o E2E sem análises concorrentes na mesma instalação.

O corpo foi medido em 17px, campos em pelo menos 16px e transcrição em 19px em todos os tamanhos. A amostra local de 120 frames com a arte espectral animada em 1440px registrou mediana de 16,7ms e percentil 95 de 16,8ms, sem frames acima de 50ms. É uma medição desta máquina, sem simulação de hardware lento.

## Cobertura e limites

A cobertura contabiliza o código completo de cada escopo, incluindo rotas e componentes que também são exercitados pelo navegador. A cobertura de linhas dos testes de navegador não é somada à dos testes unitários. Há limites mínimos globais e por módulo no Vitest; o CI também exige pelo menos 88% para API/núcleo e 65% para worker.

| Módulo | Cobertura de linhas |
|---|---|
| Captura/PCM/WAV no navegador | 97,47% |
| Biblioteca | 91,04% |
| Assistente de documentos | 88,05% |
| Revisão e apresentação de documento | 86,66% |
| Autenticação no frontend | 100% |
| Recuperação do worker | 100% |
| Pipeline de transcrição | 90% |

O resultado detalhado está em [coverage-summary.json](docs/qa/coverage-summary.json). O CI publica os relatórios completos como artefatos. A cobertura global do frontend ainda é parcial; há lacunas em upload, configurações e componentes de mídia na suíte unitária. Esses fluxos têm testes de navegador, sem equivalência automática a cobertura de linhas.

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
