# AudioWhisper — expansão do workspace

Estado: escopo aprovado em 21/10/2026 pelo pedido de continuar com todo o pacote entregue. Implementação em andamento; progresso em `tasks/todo.md`.

Objetivo: transformar gravações em memória de projeto e trabalho acompanhado, com acesso ao áudio que sustenta cada informação. Preservar processamento local, legibilidade e captura independente do navegador.

| Módulo | Responsabilidade | Depende de |
|---|---|---|
| `project-hub` | Página de projeto com gravações, participantes e histórico; aproveitar a organização já existente. | Base atual |
| `evidence-search` | Busca entre gravações com trecho, falante, filtros e abertura no timestamp do áudio. | `project-hub` |
| `action-board` | Quadro e lista de tarefas persistentes, responsáveis, prazos, estados e importação de ações revisadas com fontes. | `project-hub` |
| `meeting-notebook` | Marcadores, notas e capítulos vinculados à timeline; reunir trechos relevantes de um projeto. | `project-hub` |
| `knowledge-assistant` | Perguntas sobre várias reuniões e comparação de decisões, com fontes navegáveis e indicação de informação não encontrada. | `evidence-search` |
| `automation-recipes` | Templates e receitas por projeto para preparar rascunhos após a transcrição, com histórico e nova tentativa. Compartilhamento continua explícito. | `project-hub`, `action-board`, `meeting-notebook`, `knowledge-assistant` |
| `command-center` | Central de trabalho com pendências, atividade real e acessos rápidos; paleta de comandos e navegação adaptada a celular. | Todos os módulos acima |

Ordem: `project-hub` → `evidence-search` e `action-board` → `meeting-notebook` e `knowledge-assistant` → `automation-recipes` → `command-center` completo.

Cada entrega deve funcionar de ponta a ponta antes de avançar. A central pode receber os módulos gradualmente, sem apresentar ações que ainda não funcionam.

Direção visual: estúdio azul profundo com acentos âmbar, violeta e verde; tipografia ampla, hierarquia expressiva, timeline e ondas como linguagem visual. Painéis de trabalho ricos em contexto, com movimento breve e redução de movimento respeitada.

Validação de cada entrega: regressão das funções existentes, testes da lógica nova com cobertura medida, fluxos completos no navegador, screenshots desktop/mobile, teclado, acessibilidade e animações. Dados de demonstração separados do conteúdo pessoal nas imagens públicas.
