# Auditoria para expansão do workspace

Inspeção de código em 21/10/2026. Este documento registra a base encontrada; não atesta a implementação dos módulos propostos em `CAPABILITY-MAP.md`.

| Área | Existe hoje | O que a expansão acrescenta |
|---|---|---|
| Organização | `WorkspaceItem` guarda título, pasta, projeto, tags e nomes de falantes. A biblioteca filtra esses campos. | Um lugar próprio para acompanhar o contexto de um projeto, aproveitando os vínculos atuais. |
| Busca | A API da biblioteca procura no nome do arquivo, título e texto dos segmentos. | Resultados com a evidência encontrada, falante e acesso direto ao áudio, além de recuperação para perguntas. |
| Ações | Documentos podem conter itens `action`, responsável, prazo e segmentos de origem. | Tarefas persistentes com acompanhamento de estado; a extração por si só ainda não cria um quadro. |
| Conhecimento | O provedor local gera documentos fundamentados em uma gravação. Citações são copiadas dos segmentos persistidos. | Seleção de várias reuniões, recuperação de fontes e respostas limitadas ao material encontrado. |
| Timeline | Editor oferece reprodução por timestamp, correção, busca, falantes e waveform. | Notas e marcadores persistentes, capítulos e agrupamento de trechos. |
| Automação | Documentos são gerados sob demanda; envio exige revisão e ação explícita. | Receitas reutilizáveis, execução rastreável e recuperação de falhas, preparando rascunhos. |
| Navegação | Studio, Biblioteca e Configurações; três destinos no layout móvel. | Estrutura para projetos, tarefas e conhecimento sem reduzir fonte ou esconder ações essenciais. |
| Captura | Navegador e capturador Windows independente, diário em disco e reenvio. | Preservar a continuidade ao expandir o produto; novos módulos não devem assumir controle da captura. |

Fontes: `packages/core/src/audiowhisper_core/models.py`, `packages/core/src/audiowhisper_core/intelligence.py`, `apps/api/app/routers/library.py`, `apps/api/app/routers/documents.py`, `apps/web/components/workspace/DocumentView.tsx`, `apps/web/components/editor/TranscriptEditor.tsx`, `apps/web/components/ui/TopBar.tsx`, `UX-CONTRACT.md` e `DESIGN.md`.

## Restrições identificadas

- O campo projeto é texto em `WorkspaceItem`; ainda não existe uma entidade de projeto independente. A evolução precisa preservar os nomes e vínculos já salvos.
- Os itens de ação pertencem ao documento. Uma tarefa acompanhável precisa de identidade e ciclo de vida próprios, sem perder documento, segmentos e versão da fonte.
- A revisão de documentos já é invalidada quando a transcrição muda. Busca, tarefas e respostas devem tornar alterações das fontes visíveis.
- IDs válidos e citações literais verificam a origem, mas não provam que uma conclusão da IA interpreta corretamente a conversa. A interface precisa facilitar conferência e correção.
- O worker serializa o trabalho de GPU. Perguntas e receitas devem respeitar essa capacidade para não interromper a transcrição nem apresentar progresso fictício.
- A navegação móvel atual acomoda três destinos. Acrescentar módulos exige redesenhar a navegação, preservando fontes e áreas de toque.
- A publicação de evidências visuais deve usar dados sintéticos, sem expor nomes de arquivos, transcrições ou participantes pessoais.

## Evidência de qualidade disponível

O relatório versionado `docs/qa/coverage-summary.json` registra a validação anterior: API 70 testes / 88,78% de linhas; worker 32 / 66,31%; web 71 / 54,04%; capturador Windows 26 / 77,88%. Esses números são da base anterior e não cobrem os módulos propostos. A expansão requer novos testes e nova medição.

Nenhuma nova dependência, migração ou alteração de comportamento foi introduzida nesta auditoria.
