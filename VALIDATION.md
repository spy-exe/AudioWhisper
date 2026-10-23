# Validação: 22/10/2026

Aplicação de produção em Docker Compose no Windows. Chromium desktop e emulação Pixel 7, faster-whisper `turbo` com CUDA/float16 na RTX 5060 e Ollama `qwen3:4b`. Os fluxos usam áudio sintético. As capturas públicas filtram os arquivos pelo SHA-256 da reunião de teste; ferramentas do workspace exibem somente um projeto sintético verificado.

Após essa execução, os registros sintéticos foram separados da biblioteca pessoal, com backup integral e conferência dos dados preservados. Os testes de navegador e scripts visuais agora exigem uma instalação independente na porta 8090, identificada pela API com `ENVIRONMENT=e2e`. A porta 8080 é recusada antes de qualquer criação de dados. O simulador Windows aplica a mesma restrição, inclusive quando iniciado diretamente.

## Resultados

| Verificação | Resultado |
|---|---|
| API e núcleo | 213 testes aprovados; cobertura de linhas 96,72% |
| Worker | 72 testes aprovados; cobertura de linhas 94,00% |
| Frontend | 263 testes aprovados; cobertura de linhas 77,39%; proteção do destino E2E com 100% de linhas, ramos e funções |
| Capturador Windows | 38 testes aprovados; cobertura de linhas 77,88% |
| Fluxos completos | 63 cenários aprovados entre a suíte completa e a reexecução dos 24 casos de editor/Studio 2.1; um caso exclusivo do Windows dispensado no projeto mobile |
| TypeScript, ESLint e build de produção | Aprovados |
| Dependências de produção | Zero vulnerabilidades na auditoria npm |
| QA visual | 72 combinações de telas e larguras sem estouro horizontal, além de seis larguras do capturador Windows |
| Acessibilidade dos scripts visuais | 18 auditorias axe sem violações; verificações adicionais nos E2E de Studio, biblioteca, configurações e captura Windows |
| Estados | Carregamento, vazio, erro, nova tentativa, hover, teclado, foco de diálogos e preservação de rascunhos |
| Movimento | Oito interações medidas em frames reais: abertura/fechamento de recolhíveis e diálogos, abas, navegação, sistema reduzido e efeitos desligados |

O fluxo completo percorre projeto, busca de fala, reprodução no timestamp, capítulo no caderno, tarefa, consulta local com fontes literais, modelo de documento, revisão e importação idempotente de ações. Também verifica nomes de projeto com acentos, porcentagem e barras, conflitos de revisão, falhas recuperáveis, exportação PDF/DOCX/SRT e revogação de links privados.

A execução completa teve quatro falhas, todas corrigidas e aprovadas no reteste: seletor ambíguo do indicador de salvamento, espaço das abas em 320px e sobreposição de diálogos durante a entrada do editor. Diálogos renderizam fora dos painéis animados e tornam o fundo inerte. A edição também é conferida após recarregar. Veja [o resultado dos E2E](docs/qa/e2e-summary.json).

A gravação no navegador preserva trechos após falha de envio e recarregamento. O cenário Windows fecha o processo inteiro do Chromium, verifica a continuação do áudio sintético, reabre o Studio na mesma gravação e conclui a transcrição.

## Revisão visual e teclado

Larguras: 320, 390, 768, 1024, 1440 e 1920px. Corpo de 17px, campos de pelo menos 16px e transcrição de 19px. A matriz inclui Studio, biblioteca, configurações, editor, central, projetos, detalhe de projeto, busca, tarefas, caderno, consultas e modelos.

Formulários secundários começam recolhidos e preservam o rascunho ao fechar e reabrir. Filtros mostram a quantidade aplicada e mantêm os valores na URL. Teclado, Escape, restauração de foco, seletores nativos e navegação mobile foram exercitados. A prévia de documento longo recebe foco e rola com PageDown. Os screenshots foram inspecionados para hierarquia, legibilidade e prioridade das ações.

A amostra de 120 frames durante expansões e recolhimentos repetidos em 1440px registrou mediana de 16,7ms e percentil 95 de 16,7ms, sem frames acima de 50ms. A amostra do Studio registrou percentil 95 de 16,8ms. São medições locais, sem emulação de hardware lento. A expansão e o recolhimento mostraram 13 frames intermediários cada; o indicador das abas chegou à posição correta e a navegação encerrou sem transformações pendentes. Movimento reduzido e efeitos desligados abrem o conteúdo imediatamente. A interface não usa animações ambientes decorativas.

Veja [as telas](docs/SCREENSHOTS.md), [o relatório do Studio](docs/qa/visual-report.json), [o relatório das ferramentas](docs/qa/workspace-visual-report.json) e [o relatório de movimento](docs/qa/motion-report.json).

## Cobertura

| Módulo | Linhas |
|---|---|
| Captura/PCM/WAV no navegador | 97.91% |
| Biblioteca | 95.58% |
| Documentos | 88.40% |
| Revisão e fontes | 91.11% |
| Controle da captura Windows | 92.95% |
| Recursos do workspace | 98.46% |
| Cliente do workspace | 100.00% |

A cobertura contabiliza todo o código de cada escopo. A cobertura de navegador não é somada à unitária. O CI exige 95% para API/núcleo, 90% para worker e 75% para capturador, além dos limites globais e por módulo do Vitest, incluindo 75% de linhas no frontend. Upload, configurações, editor e mídia possuem verificações unitárias e de navegador; a cobertura completa permanece disponível para identificar os caminhos ainda não exercitados.

O detalhamento está em [coverage-summary.json](docs/qa/coverage-summary.json). O workflow Quality publica os relatórios completos como artefatos.

Na correção de isolamento, os 26 novos casos do frontend e os 12 novos casos do simulador Windows foram aprovados. O bloqueio da porta 8080 foi exercitado pela CLI real do Playwright. Dois cenários de navegador, desktop e mobile, abriram a biblioteca da instalação separada sem criar gravações. A inspeção dos containers confirmou volumes distintos para banco, uploads, exportações, temporários e modelos. O CI também valida a configuração dos sete volumes da stack de QA. A suíte completa de transcrição e documentos acima não foi reexecutada durante essa correção.

## Limites verificados

Os testes axe usam as regras WCAG A/AA disponíveis e não substituem avaliação com leitores de tela. A interação da bandeja Windows não tem automação. Os testes nativos cobrem diário em disco, interrupção, falha de rede, mistura/resampling e ciclo de dispositivos na mesma thread. O smoke test WASAPI de 21/10 recebeu 1,3s de amostras em desktop e combinado, com proteção de suspensão e destino em memória, sem salvar áudio pessoal.

Community-1 depende de acesso ao modelo autorizado e não foi executado nesta instalação. A associação temporal tem testes. SMTP externo, OBS físico/entrada virtual e áudio de tela exigem configuração e verificação no dispositivo. Os testes de SMTP usam substituto local e não enviam mensagens.

A integração das migrações do Studio 2.1 foi ensaiada em uma cópia do banco SQLite. As contagens das 13 tabelas anteriores permaneceram iguais, a verificação de chaves estrangeiras ficou vazia e a revisão final é `f30104`. O backup anterior à atualização foi preservado. A troca entre duas gravações concluídas possui regressão específica para garantir que texto e áudio pertencem ao mesmo arquivo.

Whisper e Ollama compartilham uma fila serial. Consultas e modelos podem aumentar a espera de processamento; a captura mantém seu diário independente. Responsáveis e datas ausentes permanecem não definidos. Edições nas fontes invalidam a revisão e sinalizam as referências históricas.

A auditoria completa npm registra cinco avisos altos de `braces` nas ferramentas de desenvolvimento, documentados no [GitHub Advisory Database](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). A auditoria de dependências de produção registra zero vulnerabilidades.

## Reproduzir

Os testes unitários usam `npm run lint`, `npm run typecheck` e `npm run test:coverage` em `apps/web`. Os comandos de API, worker e capturador estão no workflow Quality e nos guias de cada módulo.

Para os testes de navegador, use o arquivo independente de QA a partir da raiz do repositório. Ele cria o projeto `audiowhisper-qa`, com banco, arquivos, fila e modelos próprios, sem SMTP configurado. O download inicial dos modelos ocorre novamente nessa instalação. Para a configuração NVIDIA usada na validação:

```powershell
docker compose -f docker-compose.e2e.yml -f docker-compose.gpu.yml up -d --build
docker compose -f docker-compose.e2e.yml exec ollama ollama pull qwen3:4b
cd apps/web
$env:E2E_BASE_URL = 'http://localhost:8090'
npm run test:e2e
npm run test:visual
npm run test:visual:workspace
npm run test:visual:motion
```

Os scripts visuais reutilizam o conteúdo sintético produzido pelos E2E. Para verificar apenas a proteção e a navegação, sem iniciar processamento de áudio ou documentos, suba somente `redis api web gateway` e execute `npm run test:e2e -- tests/e2e/isolation.spec.ts`. A stack de uso pessoal continua na porta 8080.
