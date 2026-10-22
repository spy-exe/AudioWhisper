# Workspace do AudioWhisper

O Studio continua sendo o ponto de captura e importação. A Central reúne a continuidade do trabalho: projetos, tarefas, caderno, perguntas e documentos preparados por modelos reutilizáveis.

| Ferramenta | Como usar |
|---|---|
| Central | Abra `/workspace` para retomar gravações, conferir prazos e acessar as ferramentas. Contagens vêm do banco local. |
| Projetos | Crie um projeto em `/projects`; no editor, use **Organizar conversa e participantes** para atribuir a gravação. Projetos salvos anteriormente são preservados. |
| Buscar trechos | Pesquise uma palavra ou expressão em `/search`. Filtre por projeto ou falante e abra o áudio no segmento encontrado. A busca normaliza acentos e permite prefixo na última palavra. |
| Tarefas | Em `/tasks`, use quadro ou lista. Defina responsável, data, prioridade e estado. Arquivar é reversível. Ações de documentos revisados podem ser importadas pelo editor, sem duplicação. |
| Caderno | No editor, escolha um segmento ou use **Usar trecho em reprodução**. Salve nota, trecho salvo ou capítulo; consulte por projeto em `/notebook`. Marcadores de tempo ficam na aba **Marcadores** do editor, também acessível por `M`. |
| Consultas | Em `/knowledge`, escreva a pergunta, escolha um projeto e, opcionalmente, até 20 gravações. O modelo local fica nas opções da consulta. As respostas apontam para as fontes de cada item. |
| Modelos | Em `/recipes`, salve um tipo de documento e suas instruções. Escolha uma gravação para executar ou habilite preparação automática para novas conclusões. |

Criação de projetos, tarefas, modelos e registros do caderno fica recolhida. Abra o controle com o nome da ação; fechar e reabrir preserva o rascunho. Os filtros indicam a quantidade aplicada e mantêm os valores na URL.

**Ctrl+K** abre a busca e os comandos rápidos. Digite um termo e escolha **Buscar trechos** ou pressione Enter para localizar falas. No celular, **Mais** dá acesso a todas as ferramentas. Formulários com alterações não salvas pedem uma decisão antes de sair. A captura Windows continua em seu processo independente quando o navegador fecha.

## Fontes e revisão

Tarefas importadas, anotações e respostas guardam uma cópia literal dos segmentos de origem. Correções no texto, tempo, identidade ou nome do falante sinalizam que a fonte mudou. Abrir o link leva ao segmento atual; a cópia histórica continua visível para comparação.

Referências válidas e citações literais permitem verificar a origem; a interpretação do modelo ainda precisa de conferência. As respostas não substituem essa revisão. O assistente recupera até 80 trechos por palavras da pergunta, em gravações concluídas, e pode não cobrir toda a biblioteca. Quando não encontra evidência, informa a ausência nos trechos recuperados.

Responsáveis e prazos não identificados continuam vazios. Expressões como “amanhã” são preservadas como texto; nenhuma data é deduzida. O usuário pode definir uma data explícita no plano de ação. Edições no Markdown de um documento não reescrevem seus itens estruturados: confira **Verificar fontes** e ajuste as tarefas depois da importação.

## Receitas e recuperação

- Cada combinação receita/gravação tem uma execução. Pedir novamente retorna a execução existente; falhas têm ação de repetir.
- As instruções são copiadas para a execução. Editar a receita afeta as próximas execuções.
- Preparação automática vem desligada. Quando habilitada, vale para conclusões posteriores à criação da receita; receitas de projeto também são verificadas quando a gravação é organizada nesse projeto.
- Reinícios recuperam perguntas e receitas pendentes e reconciliam conclusões que ocorreram antes do agendamento. A geração cria rascunhos e não envia mensagens.
- Whisper e Ollama compartilham a fila serial do worker e a GPU. Uma consulta pode aumentar a espera de processamento. O capturador mantém o áudio em disco durante essa espera.
- Falhas da fila e do Ollama ficam no histórico com nova tentativa. Falhar uma receita não transforma uma gravação concluída em falha.

## Dados e instalação

As migrações são aditivas: `projects`, `action_tasks`, `notebook_entries`, `knowledge_questions`, `document_recipes`, `recipe_runs` e um índice SQLite FTS5 atualizado por triggers. Antes de atualizar uma instalação com dados, faça backup do banco SQLite pela API de backup do SQLite ou com a aplicação parada. Preserve também os volumes de áudio e exportação.

Não há novo serviço, conta ou dependência de execução nesta expansão. O Ollama usa a configuração já existente. A autenticação local protege todas as novas rotas. Perguntas, fontes, notas e resultados permanecem no banco local; o compartilhamento existente exige revisão e uma ação explícita.

Veja [as capturas](SCREENSHOTS.md), [o relatório de validação](../VALIDATION.md) e [o mapa de módulos](../CAPABILITY-MAP.md).
