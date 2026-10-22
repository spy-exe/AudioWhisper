# Validação: 22/10/2026

Aplicação de produção em Docker Compose no Windows. Chromium desktop e emulação Pixel 7, faster-whisper `turbo` com CUDA/float16 na RTX 5060 e Ollama `qwen3:4b`. Os fluxos usam áudio sintético. As capturas públicas filtram os arquivos pelo SHA-256 da reunião de teste; ferramentas do workspace exibem somente um projeto sintético verificado.

## Resultados

| Verificação | Resultado |
|---|---|
| API e núcleo | 97 testes aprovados; cobertura de linhas 90,46% |
| Worker | 38 testes aprovados; cobertura de linhas 69,73% |
| Frontend | 99 testes aprovados; cobertura de linhas 59,34% |
| Capturador Windows | 26 testes aprovados; cobertura de linhas 77,88% |
| Fluxos completos | 51 cenários aprovados entre a suíte completa e o reteste dos dois casos de filtros; um caso exclusivo do Windows dispensado no projeto mobile |
| TypeScript, ESLint e build de produção | Aprovados |
| Dependências de produção | Zero vulnerabilidades na auditoria npm |
| QA visual | 72 combinações de telas e larguras sem estouro horizontal, além de seis larguras do capturador Windows |
| Acessibilidade dos scripts visuais | 18 auditorias axe sem violações; verificações adicionais nos E2E de Studio, biblioteca, configurações e captura Windows |
| Estados | Carregamento, vazio, erro, nova tentativa, hover, teclado, foco de diálogos e preservação de rascunhos |
| Movimento | Expansão e feedback reais; preferência do sistema e efeitos desligados exercitados |

O fluxo completo percorre projeto, busca de fala, reprodução no timestamp, capítulo no caderno, tarefa, consulta local com fontes literais, modelo de documento, revisão e importação idempotente de ações. Também verifica nomes de projeto com acentos, porcentagem e barras, conflitos de revisão, falhas recuperáveis, exportação PDF/DOCX/SRT e revogação de links privados.

A gravação no navegador preserva trechos após falha de envio e recarregamento. O cenário Windows fecha o processo inteiro do Chromium, verifica a continuação do áudio sintético, reabre o Studio na mesma gravação e conclui a transcrição.

## Revisão visual e teclado

Larguras: 320, 390, 768, 1024, 1440 e 1920px. Corpo de 17px, campos de pelo menos 16px e transcrição de 19px. A matriz inclui Studio, biblioteca, configurações, editor, central, projetos, detalhe de projeto, busca, tarefas, caderno, consultas e modelos.

Formulários secundários começam recolhidos e preservam o rascunho ao fechar e reabrir. Filtros mostram a quantidade aplicada e mantêm os valores na URL. Teclado, Escape, restauração de foco, seletores nativos e navegação mobile foram exercitados. A prévia de documento longo recebe foco e rola com PageDown. Os screenshots foram inspecionados para hierarquia, legibilidade e prioridade das ações.

A amostra de renderização do Studio em 1440px registrou 120 frames, mediana de 16.7ms e percentil 95 de 16.7ms, sem frames acima de 50ms. Medição local, sem emulação de hardware lento. A interface não usa animações ambientes decorativas.

Veja [as telas](docs/SCREENSHOTS.md), [o relatório do Studio](docs/qa/visual-report.json) e [o relatório das ferramentas](docs/qa/workspace-visual-report.json).

## Cobertura

| Módulo | Linhas |
|---|---|
| Captura/PCM/WAV no navegador | 97.91% |
| Biblioteca | 91.04% |
| Documentos | 88.40% |
| Revisão e fontes | 89.47% |
| Controle da captura Windows | 92.95% |
| Recursos do workspace | 98.46% |
| Cliente do workspace | 100.00% |

A cobertura contabiliza todo o código de cada escopo. A cobertura de navegador não é somada à unitária. O CI exige 88% para API/núcleo, 65% para worker e 75% para capturador, além dos limites globais e por módulo do Vitest. O frontend ainda tem cobertura unitária parcial em upload, configurações e mídia; esses fluxos também possuem testes de navegador.

O detalhamento está em [coverage-summary.json](docs/qa/coverage-summary.json). O workflow Quality publica os relatórios completos como artefatos.

## Limites verificados

Os testes axe usam as regras WCAG A/AA disponíveis e não substituem avaliação com leitores de tela. A interação da bandeja Windows não tem automação. Os testes nativos cobrem diário em disco, interrupção, falha de rede, mistura/resampling e ciclo de dispositivos na mesma thread. O smoke test WASAPI de 21/10 recebeu 1,3s de amostras em desktop e combinado, com proteção de suspensão e destino em memória, sem salvar áudio pessoal.

Community-1 depende de acesso ao modelo autorizado e não foi executado nesta instalação. A associação temporal tem testes. SMTP externo, OBS físico/entrada virtual e áudio de tela exigem configuração e verificação no dispositivo. Os testes de SMTP usam substituto local e não enviam mensagens.

Whisper e Ollama compartilham uma fila serial. Consultas e modelos podem aumentar a espera de processamento; a captura mantém seu diário independente. Responsáveis e datas ausentes permanecem não definidos. Edições nas fontes invalidam a revisão e sinalizam as referências históricas.

A auditoria completa npm registra cinco avisos altos de `braces` nas ferramentas de desenvolvimento, documentados no [GitHub Advisory Database](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). A auditoria de dependências de produção registra zero vulnerabilidades.

## Reproduzir

No diretório `apps/web`, execute `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run test:e2e`, `npm run test:visual` e `npm run test:visual:workspace`. Os E2E requerem a stack e o Ollama disponíveis. Os scripts visuais reutilizam o conteúdo sintético produzido pelos E2E. Os comandos de API, worker e capturador estão no workflow Quality e nos guias de cada módulo.
