# Interface

Capturas da aplicação em execução, com a reunião sintética da suíte de testes. Somente registros que correspondem ao SHA-256 do arquivo de teste entram nas capturas da biblioteca. O layout e os documentos são renderizados pelos mesmos componentes da aplicação.

## Studio

![Studio no desktop](screenshots/studio-desktop.png)

![Studio no celular](screenshots/studio-mobile.png)

## Captura em segundo plano

Capturador em processo separado com entrada sintética. O histórico pessoal foi ocultado nestas capturas.

![Capturador Windows pronto no desktop](screenshots/windows-ready-desktop.png)

![Capturador Windows pronto em tela estreita](screenshots/windows-ready-mobile.png)

![Gravação após reabrir o navegador](screenshots/windows-recording-desktop.png)

![Gravação em tela estreita](screenshots/windows-recording-mobile.png)

## Biblioteca

![Biblioteca](screenshots/library-desktop.png)

## Editor e documentos

![Editor e documento no desktop](screenshots/workspace-desktop.png)

![Editor e documento no celular](screenshots/workspace-mobile.png)

![Revisão, participação e linha do tempo](screenshots/editor-review.png)

![Revisão no celular](screenshots/editor-review-mobile.png)

![Marcadores ligados ao áudio](screenshots/editor-markers.png)

## Configurações

![Configurações](screenshots/settings-desktop.png)

## Central e organização

![Central de trabalho](screenshots/central-desktop.png)

![Projetos](screenshots/projects-desktop.png)

![Projeto e gravações](screenshots/project-desktop.png)

![Criação de projeto sob demanda](screenshots/project-create-expanded.png)

## Busca e tarefas

![Busca por trechos](screenshots/search-desktop.png)

![Quadro de tarefas](screenshots/tasks-desktop.png)

![Tarefas no celular com filtros recolhidos](screenshots/tasks-mobile.png)

## Caderno, consultas e modelos

![Caderno](screenshots/notebook-desktop.png)

![Consultas às gravações](screenshots/knowledge-desktop.png)

![Modelos de documento](screenshots/recipes-desktop.png)

![Navegação por comandos](screenshots/commands-open.png)

## Estados de recuperação

![Erro recuperável da biblioteca](screenshots/library-error.png)

![Busca sem resultados](screenshots/library-empty.png)

![Carregamento](screenshots/library-loading.png)

As matrizes de seis larguras são produzidas por `npm run test:visual` e `npm run test:visual:workspace`. `npm run test:visual:motion` mede os frames reais de expansão, recolhimento, diálogos, abas e navegação, com efeitos completos, reduzidos e desligados. Veja [VALIDATION.md](../VALIDATION.md), o [relatório do Studio](qa/visual-report.json), o [relatório das ferramentas](qa/workspace-visual-report.json) e o [relatório de movimento](qa/motion-report.json).
