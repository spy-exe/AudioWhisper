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
| Confirmação | ConfirmDialog/Dialog | ações destrutivas e de lote | exclusão, limpeza, remoção de participante | componentes + axe |
| Busca por momentos | SearchView + /api/search | segmentos concluídos com aw_fold | página, cabeçalho e trechos da biblioteca | API + Playwright |
| Atalhos do editor | useKeyboardShortcuts | ShortcutsDialog | Espaço/J/L/M/N/?/Ctrl+F/S/Z | componentes + Playwright |

Studio → upload/captura → processamento → editor. Biblioteca → workspace → voltar à biblioteca preservando filtros na URL. Busca no servidor: 300ms, cancelamento de requests antigos, limpeza imediata, paginação limitada. Falhas não se apresentam como ausência de dados.

O modo navegador requer aba aberta. O modo Windows mantém a gravação ao fechar o navegador; reabrir consulta a sessão e nunca inicia áudio automaticamente. Captura ativa ou comando pendente bloqueia a troca de modo. Quedas de conexão preservam os trechos antes do reenvio. Nenhum modo promete continuidade durante desligamento ou suspensão manual.

WebSocket recupera snapshots e reconecta; HTTP reconcilia o banco enquanto a conexão estiver interrompida. IDs estáveis deduplicam segmentos. Texto provisório nunca substitui texto confirmado. Reprocessamento cria nova execução lógica, sem misturar trechos antigos.

Documento gerado é rascunho. Revisão explícita habilita compartilhamento; alteração no texto-fonte invalida a revisão. Compartilhar não é automático. Links privados permitem somente leitura do documento aprovado, têm expiração e revogação. Não expõem o áudio original.

Autenticação single-user local quando ACCESS_TOKEN estiver definido. Acesso administrativo e links de leitura têm rotas/permissões distintas. Credenciais de integração pertencem ao ambiente do servidor, nunca à biblioteca ou exportações.

Todos os fluxos oferecem loading, vazio, erro e retry aplicáveis, nomes acessíveis e foco visível. Não há diálogos nativos de alert/confirm/prompt: ações destrutivas usam ConfirmDialog, com o foco começando em Cancelar e o erro exibido dentro do próprio diálogo. Ctrl+F no editor abre busca. Atalhos de letra seguem funcionando com o foco em botões; campos de texto e selects recebem todas as teclas. Não manter conteúdo de reunião em parâmetros de URL; filtros de biblioteca, a busca por momentos (`/search?q=`) e o horário `?t=` são exceções explícitas e podem ser limpos.

Exclusão é sempre explícita e informa o que deixa de existir. Ações em lote relatam o resultado de cada item, sem bloquear o lote por causa de uma gravação em processamento. Insights mostram apenas valores calculados da transcrição; sem dado, exibem "—" ou ocultam o bloco.
