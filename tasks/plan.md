# Expansão do workspace

Mapa aprovado pelo pedido de continuar com tudo entregue. Implementação incremental com contratos e testes por módulo.

1. Persistência e API de projetos, preservando nomes atuais.
2. Busca por segmentos e navegação para timestamp.
3. Tarefas e importação idempotente com fontes.
4. Caderno com notas, marcadores e capítulos.
5. Perguntas locais com recuperação de trabalho e controle de fontes.
6. Receitas persistentes, execução manual e disparo após conclusão.
7. Central, navegação, paleta e acabamento visual integrado.
8. Regressão, cobertura, E2E e QA visual; publicar somente após validação.

Riscos principais: conciliação de projetos legados; fontes editadas após extração; disputas pela GPU; interrupções e repetição de automações; navegação móvel com muitos módulos. Mitigar com migração aditiva, snapshots/hash, fila serial, chave única e menu responsivo.
