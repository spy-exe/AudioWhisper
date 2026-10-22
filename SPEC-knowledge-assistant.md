# Perguntas sobre reuniões

Módulo: `knowledge-assistant`. Índice: `CAPABILITY-MAP.md`.

## Objetivo e critérios de aceite
Consultar várias gravações ou projeto pelo Ollama local, com recuperação limitada e respostas referenciadas.

Processamento em fila com recuperação; fontes desconhecidas são rejeitadas; sem resultados retorna informação não encontrada; edição durante geração invalida resposta.

## Comandos e estrutura
Build: `cd apps/web; npm run build`. Web: `npm run lint`, `npm run typecheck`, `npm run test:coverage`, `npm run test:e2e`.
API: `.venv-dev/Scripts/python.exe -m pytest apps/api/tests --basetemp=.devdata/pytest-api --cov=apps/api/app --cov-report=json:.devdata/api-coverage.json`.
Worker: `.venv-dev/Scripts/python.exe -m pytest apps/worker/tests --basetemp=.devdata/pytest-worker`.

Modelos/migrações em `packages/core`; rotas/testes em `apps/api`; jobs/testes em `apps/worker`; componentes/páginas/testes em `apps/web`.

## Estilo
Reutilizar SQLAlchemy, Pydantic, FastAPI e cliente tipado existentes. Exemplo: `db.get(WorkspaceItem, job_id)`. IDs estáveis; validação e limites no servidor; formulários sem perder valores em erro. Layout/tokens seguem `DESIGN.md`; contratos de interação em `UX-CONTRACT.md`.

## Verificação
Teste de comportamento antes da implementação; integração API/banco; worker isolado com provedor controlado; navegador com dados sintéticos para fluxos completos, screenshots, teclado, acessibilidade, loading/erro/vazio e movimento. Medir cobertura nova e regressão da base; registrar limitações reais.

## Limites
Sempre: migração aditiva, autenticação existente, paginação, referências verificáveis e revisão explícita de documentos. Nunca: apagar gravações, enviar conteúdo automaticamente, publicar conteúdo pessoal ou segredos. Provedor local já instalado; nenhuma nova dependência de execução prevista.
