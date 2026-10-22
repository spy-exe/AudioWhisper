# Contrato de experiência

Fontes: `ARCHITECTURE.md`; contratos de `apps/api/app/routers`; identidade em `DESIGN.md`.

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | select nativo | DESIGN.md | native | Playwright + teclado |
| Form | labels e Button compartilhado | rotas e schemas Pydantic | upload/settings/workspace | API + browser |
| Scrollbar | app/globals.css | DESIGN.md | geometria de lista | computed style |
| CRUD | lib/api.ts + routers | contratos FastAPI | edição fica no workspace | API + Playwright |
| Motion | MotionPreferences + useMotionPreference | DESIGN.md e visual_effects_enabled | sistema reduzido ou efeitos desligados | Playwright + computed style |
| Documento | DocumentContent | Markdown do documento revisável | privado e compartilhado | componentes + Playwright |
| Fonte de captura | CaptureSources | modos de /api/live | microfone/desktop/combinado/OBS | componentes + WASAPI |
| Captura Windows | WindowsCapture + audiowhisper_capture | processo local e diário em disco | independente do navegador | pytest + fechamento do Chromium |
| Workspace | componentes/hub + workspaceApi | SPECs do CAPABILITY-MAP e rotas /api/projects, /api/tasks, /api/notebook | central/projetos/ações/caderno | API + testes de componentes + fluxo completo |
| Diálogos | WorkspaceDialog | contrato HTML dialog + DESIGN.md | comandos, menu móvel e proteção de rascunho | foco, Escape, restauração e teclado no navegador |
| Navegação | workspace-navigation + TopBar + CommandPalette | CAPABILITY-MAP.md | sidebar desktop, menu móvel, Ctrl+K | navegação e screenshots |
| Datas | input type=date nativo | prazo explícito em /api/tasks | calendário do navegador/SO; datas formatadas em pt-BR | seleção e persistência no navegador |
| Fontes | audiowhisper_core.evidence + SourceList | snapshot literal + hash de texto/tempo/falante | tarefas, caderno e respostas | origem, alterações e links de áudio |

Studio → upload/captura → processamento → editor. Biblioteca → workspace → voltar à biblioteca preservando filtros na URL. Busca no servidor: 300ms, cancelamento de requests antigos, limpeza imediata, paginação limitada. Falhas não se apresentam como ausência de dados.

O modo navegador requer aba aberta. O modo Windows mantém a gravação ao fechar o navegador; reabrir consulta a sessão e nunca inicia áudio automaticamente. Captura ativa ou comando pendente bloqueia a troca de modo. Quedas de conexão preservam os trechos antes do reenvio. Nenhum modo promete continuidade durante desligamento ou suspensão manual.

WebSocket recupera snapshots e reconecta; HTTP reconcilia o banco enquanto a conexão estiver interrompida. IDs estáveis deduplicam segmentos. Texto provisório nunca substitui texto confirmado. Reprocessamento cria nova execução lógica, sem misturar trechos antigos.

Documento gerado é rascunho. Revisão explícita habilita compartilhamento; alteração no texto-fonte invalida a revisão. Compartilhar não é automático. Links privados permitem somente leitura do documento aprovado, têm expiração e revogação. Não expõem o áudio original.

Autenticação single-user local quando ACCESS_TOKEN estiver definido. Acesso administrativo e links de leitura têm rotas/permissões distintas. Credenciais de integração pertencem ao ambiente do servidor, nunca à biblioteca ou exportações.

Todos os fluxos oferecem loading, vazio, erro e retry aplicáveis, nomes acessíveis e foco visível. Não há diálogos nativos de alert/confirm/prompt. Ctrl+F no editor abre busca. Não manter conteúdo de reunião em parâmetros de URL; filtros de biblioteca são exceção explícita e podem ser limpos.

Busca de trechos, projetos, tarefas e caderno preservam filtros e paginação na URL; perguntas, respostas e anotações ficam fora da URL. Links para fontes usam somente IDs e tempo; o editor resolve o timestamp atual do segmento. A central aponta para tarefas pelo ID. As datas de tarefa representam dias do calendário local, sem conversão para UTC; expressões extraídas como “amanhã” permanecem literais até o usuário definir uma data.

Arquivar tarefas e notas é reversível. Conflitos de revisão retornam 409 e preservam o formulário. Formulários novos e edições do workspace protegem alterações não salvas na navegação. Diálogos usam foco inicial apropriado, Escape, fundo inerte e restauração ao elemento que abriu. Ctrl+K tem botão visível e não executa durante composição de texto.

Perguntas usam recuperação lexical local de até 80 segmentos e não afirmam cobrir toda a biblioteca. O limite e a necessidade de conferir a interpretação ficam visíveis. Sem trechos ou resposta fundamentada, a interface informa que nada foi encontrado nos trechos recuperados. Receitas guardam uma cópia das instruções por execução, não duplicam receita/gravação e sempre geram rascunhos. Execução automática vale para conclusões posteriores à criação da receita e requer opção explícita. A fila serial é compartilhada com o Whisper; inferência pode aumentar a espera de processamento, enquanto a captura mantém seu diário em disco.

Criação de projetos, tarefas, modelos e registros do caderno usa recolhíveis nativos. O resumo é acionável por teclado, possui foco visível e indica expansão pela seta. Fechar o formulário preserva o rascunho; a proteção contra navegação continua ativa. Filtros secundários indicam a quantidade aplicada no resumo e preservam seus valores na URL. As informações essenciais de captura, erros, revisão e fontes permanecem acessíveis na superfície de trabalho.
