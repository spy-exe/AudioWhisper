# Novidades

## 2.1 · Studio de revisão

### Encontrar
- **Busca por momentos** (`/search` e campo no cabeçalho): cada trecho em que um termo foi dito, em todas as gravações concluídas, com horário, falante e destaque. Acentos e maiúsculas são ignorados ("reuniao" encontra "Reunião").
- **Biblioteca**: a busca mostra os trechos encontrados com link para o instante exato (`/jobs/{id}?t=SEGUNDOS`), ordena por data, nome ou duração, sugere pastas, projetos e tags existentes, exibe tags e modelo e permite selecionar várias gravações para mover, marcar ou excluir.
- **Resumo do acervo** no Studio: gravações transcritas, horas de áudio, palavras e documentos.

### Revisar
- **Revisão da transcrição**: duração, tempo com fala, palavras, ritmo, perguntas, trocas de turno, participação por falante, linha do tempo clicável, termos mais citados e fala contínua mais longa. Tudo calculado a partir dos segmentos; nada é estimado.
- **Trechos incertos**: segmentos abaixo do limiar de confiança (configurável) ganham destaque e um modo de revisão dedicado; `N` e `Shift+N` navegam entre eles.
- **Marcadores** com nome, nota e cor; `M` marca o momento atual. Entram no Markdown, JSON, PDF e DOCX.
- **Dividir e juntar segmentos**: dividir no cursor preserva os horários por palavra; juntar recalcula a confiança pela duração. Marcadores acompanham o trecho.
- **Participantes**: adicionar à mão (sem diarização), mesclar duplicados, remover e atribuir um falante a vários trechos de uma vez.
- **Transcrever novamente** com outro modelo, idioma ou vocabulário, mantendo a versão anterior.
- Atalhos `?` (lista), `Ctrl+Z` fora dos campos, link copiável para cada momento.

### Exportar e organizar
- **CSV** (com proteção contra fórmulas em planilhas) e **ZIP** com todos os formatos de uma vez.
- Exportações levam o **nome dos falantes** (SRT, VTT com `<v>`, TXT por turno, Markdown, JSON) e o arquivo baixado recebe o título da gravação.
- PDF e DOCX passam a mostrar negrito e os metadados como campos, em vez de marcações cruas.
- Excluir gravações e documentos com confirmação; o arquivo original só é apagado quando nenhuma outra versão o usa.

### Configurar e acompanhar
- **Vocabulário personalizado** (nomes, siglas e termos) enviado ao faster-whisper como `initial_prompt` e `hotwords`; idioma padrão.
- **ETA real** durante a transcrição, progresso no título da aba e aviso opcional do navegador quando termina em segundo plano.
- **Indicador de fila** no cabeçalho, com alerta de motor parado.
- **Armazenamento**: uso do disco e por pasta, limpeza segura de áudio temporário e exportações regeneráveis.

### Robustez
- Configurações validadas no servidor (tudo ou nada) com mensagens por campo.
- Erros inesperados da API retornam JSON com `request_id`, sem detalhes internos.
- Fila indisponível: o job é marcado como falho com opção de tentar novamente, em vez de ficar parado em "Na fila"; encerrar ou recuperar uma captura informa a falha sem perder o áudio.
- Erros de rede aparecem em português no lugar de "Failed to fetch".
- Correções: `Range: bytes=-N` agora serve o fim do arquivo; VTT escapa `<`, `>` e `&`; legendas ignoram trechos vazios; "Tentar novamente" após falha volta a acompanhar o processamento; o download deixa de ser `transcript.markdown`; um arquivo escolhido antes de as configurações carregarem deixa de ficar preso ao modelo `turbo`; atalhos de letra funcionam com o foco em botões.

### Qualidade
- API e núcleo: 213 testes e cobertura de linhas de 96,75%. Worker: 72 testes e 94,00%. Frontend: 237 testes e 77,30%. Capturador Windows: 26 testes e 77,88%. Metas de CI de 95% (API), 90% (worker), 75% (capturador), além dos limites globais e por arquivo no Vitest.

### Workspace e interface
- Projetos, busca com fontes, quadro de tarefas, caderno, consultas entre gravações e modelos reutilizáveis de documento compartilham a biblioteca local.
- A central reúne continuidade de trabalho, gravações recentes e prazos. A busca global do cabeçalho também abre ferramentas com Ctrl+K.
- Tipografia maior, identidade própria e favicon. Formulários e opções secundárias ficam em recolhíveis que preservam os campos.
- Expansão e recolhimento contínuos, entradas de tela e painéis, indicador deslizante das abas, transições de diálogos e feedback nos controles. Preferência do sistema e opção de desligar efeitos são respeitadas.
