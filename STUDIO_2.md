# AudioWhisper 2.0 — operação local

O Studio preserva o pipeline de upload e adiciona captura ao vivo, organização da biblioteca, falantes, documentos com IA e distribuição após revisão.

## Iniciar

```powershell
docker compose -f docker-compose.yml -f docker-compose.gpu.yml -f docker-compose.ai.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.gpu.yml -f docker-compose.ai.yml exec ollama ollama pull qwen3:4b
```

Abra http://localhost:8080. O override `docker-compose.ai.yml` adiciona um Ollama sem porta pública, sem nuvem, com volume de modelos persistente. Para usar um Ollama já instalado, omita esse override e configure `OLLAMA_URL` no `.env`. Em Linux, disponibilize o host por endereço acessível aos containers. A imagem de diarização pode ser dispensada com `INSTALL_DIARIZATION=false`; nesse caso, a identificação automática explica a dependência ausente.

## Captura e recuperação

Microfone, entrada virtual OBS, áudio compartilhado e mixagem de microfone/computador usam as permissões nativas do navegador. A captura exige localhost ou HTTPS. No compartilhamento de tela/aba, habilite o áudio; a disponibilidade depende do navegador e do sistema operacional. No OBS, use monitoração para uma entrada de áudio virtual e selecione-a no Studio.

AudioWorklet captura PCM mono em 16 kHz. Detecção de energia delimita enunciados; o motor aplica o VAD configurado. Enunciados em andamento produzem revisões a cada quatro segundos e são confirmados após silêncio ou ao atingir vinte segundos. A transcrição provisória pode ser corrigida; a confirmada mantém IDs e timestamps estáveis. O visualizador representa a energia efetivamente capturada.

Antes de enviar cada revisão, o navegador a confirma no IndexedDB. O servidor valida WAV, limite de tamanho, formato e hash. Cada `(captura, sequência, revisão)` identifica um envio idempotente: repetição igual é aceita; áudio divergente é rejeitado. A interface oferece recuperação e mantém a captura durante a navegação. Após interrupção do navegador, a última revisão salva pode ser promovida a final. O intervalo ainda em memória entre revisões não é recuperável após encerramento abrupto do navegador.

Encerrar define o número esperado de trechos. O worker só consolida quando todos os finais estão processados, preservando silêncio entre trechos e reconstruindo o WAV completo. Capturas interrompidas não são apresentadas como concluídas. O worker local executa os trabalhos em série para evitar concorrência de modelos na GPU; análises em andamento podem aumentar a latência de uma nova captura. O áudio recebido permanece persistido.

O WebSocket assina antes de capturar o snapshot, recupera os segmentos salvos e deduplica IDs no cliente. Reconexão usa backoff, e HTTP reconcilia o banco a cada cinco segundos. A limitação de frequência do worker acumula os segmentos, sem descartá-los. Ao reiniciar o worker, transcrições incompletas são reprocessadas a partir do original; documentos e trechos live pendentes retornam à fila.

As escritas no IndexedDB usam uma fila independente dos uploads: uma requisição lenta não bloqueia a preservação dos trechos seguintes. O teste de recuperação interrompe o upload, recarrega a página e consolida o áudio salvo.

O cancelamento é cooperativo. A interface confirma a solicitação e desabilita novos pedidos enquanto o motor libera a etapa atual. Uma carga inicial de modelo pode continuar até esse ponto; o estado pendente também é recuperado pela API após recarregar a página.

## Falantes e revisão

`pyannote.audio` e Community-1 executam localmente no worker, inicialmente em CPU. Aceite as condições do [Community-1](https://huggingface.co/pyannote/speaker-diarization-community-1) na sua conta e configure `HF_TOKEN`; alternativamente, informe um diretório local em `DIARIZATION_MODEL`. A telemetria fica desabilitada no Compose. O aplicativo não aceita modelos de diarização com inferência remota.

A associação inicial usa a maior sobreposição temporal entre falas e segmentos. Segmentos que contêm mais de uma pessoa exigem revisão; o editor permite atribuir e renomear falantes, navegar por timestamp e filtrar por participante. Nenhum nome pessoal é inferido automaticamente.

## Inteligência e fontes

A fronteira `IntelligenceProvider` permite novos motores locais; `OllamaProvider` implementa [chat com JSON Schema](https://docs.ollama.com/capabilities/structured-outputs). Modelos remotos listados pelo Ollama são recusados. Documentos cobrem ata técnica, briefing, resumo, decisões, tarefas, riscos, perguntas, e-mail e análise personalizada.

O modelo seleciona os IDs dos segmentos que sustentam cada item. O servidor copia as citações diretamente desses segmentos, preservando o texto original; o modelo não precisa reescrevê-las. IDs inexistentes continuam sendo recusados. Responsáveis e prazos sem correspondência literal tornam-se nulos. A origem textual é verificável, mas não prova a interpretação semântica: a revisão humana continua obrigatória antes de compartilhar. Falas são tratadas como dados, sem ferramentas nem execução de comandos por LLM.

Reuniões longas são divididas em lotes completos, considerando texto, IDs e metadados serializados, sem descartar silenciosamente o fim da transcrição. Isso também limita entradas com muitos segmentos curtos. O documento registra um hash do texto, timestamps e nomes dos falantes. Alterar a fonte invalida a revisão. Clicar em uma referência leva ao player no trecho correspondente.

O JSON Schema de cada geração restringe os IDs de referência aos segmentos daquela transcrição. A validação posterior das citações continua obrigatória, mesmo com essa restrição durante a geração. Nos novos documentos, o texto e as exportações exibem as fontes por horário (`HH:MM:SS`); os IDs persistentes permanecem nos dados estruturados para a navegação ao áudio.

## Exportar e compartilhar

Transcrição: PDF, DOCX, Markdown, TXT, JSON, SRT e VTT. Documentos de IA: PDF, DOCX, Markdown, TXT e JSON. PDF incorpora fonte para acentos em português; DOCX permanece editável. Conteúdo é escapado, sem interpretar HTML ou buscar imagens externas.

Fluxo: gerar → revisar → confirmar revisão → compartilhar. Links privados guardam apenas o hash do segredo, expiram entre 1 hora e 30 dias e podem ser revogados. Exibem somente o documento revisado, sem acesso à mídia, biblioteca ou API administrativa. Corrigir a fonte bloqueia o link até uma nova geração/revisão. Tokens de links não aparecem nos logs da API.

WhatsApp usa compartilhamento manual de texto; não há envio automático nem integração não oficial. E-mail pode abrir o cliente instalado ou usar SMTP autenticado. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USERNAME` e `SMTP_PASSWORD`. STARTTLS é o padrão; mantenha-o ativado para servidores externos. Cada envio SMTP usa um identificador idempotente. Falha com resultado incerto não dispara repetição automática.

## Acesso

`ACCESS_TOKEN` habilita autenticação de administrador único da instalação. O login cria cookie assinado, HttpOnly, SameSite Strict, por 12 horas; HTTPS ativa Secure. O token não vai para URLs ou armazenamento JavaScript. Cookies também autenticam player, downloads e WebSocket. A API continua aceitando `X-Access-Token` para clientes locais. Mudar o token invalida as sessões. Links privados são uma permissão separada de somente leitura.

Esta é uma instalação local single-user, não um sistema multitenant. Para exposição além da máquina, use HTTPS e um token longo. Credenciais de SMTP e Hugging Face pertencem ao ambiente do servidor.

## Mapa dos módulos

| Área | Implementação |
|---|---|
| Biblioteca e organização | `apps/api/app/routers/library.py`, `components/jobs/LibraryView.tsx` |
| Captura | `lib/live-audio.ts`, `lib/live-store.ts`, `components/live/LiveStudio.tsx`, `routers/live.py`, `app/live_tasks.py` |
| Falantes | `app/diarization.py`, `routers/speakers.py`, `components/workspace/OrganizationPanel.tsx` |
| Inteligência | `audiowhisper_core/intelligence.py`, `routers/documents.py`, `app/ai_tasks.py`, `components/workspace/AIWorkspace.tsx` |
| Distribuição e acesso | `routers/sharing.py`, `routers/session.py`, `app/auth.py`, `components/workspace/SharePanel.tsx` |
| Exportação | `audiowhisper_core/exports.py`, `document_exports.py` |
| Recuperação do worker | `app/recovery.py` |
| Busca e biblioteca 2.1 | `audiowhisper_core/text.py`, `routers/search.py`, `routers/library.py`, `components/search/SearchView.tsx` |
| Insights | `audiowhisper_core/stats.py`, `routers/jobs.py` (`/stats`), `components/editor/InsightsPanel.tsx` |
| Marcadores | `routers/bookmarks.py`, `components/editor/BookmarksPanel.tsx` |
| Edição estrutural e falantes manuais | `services/job_service.py`, `routers/speakers.py`, `components/editor/TranscriptEditor.tsx` |
| Sistema e fila | `routers/system.py`, `components/settings/StoragePanel.tsx`, `components/jobs/QueueIndicator.tsx` |
| Diálogos | `components/ui/Dialog.tsx`, `components/ui/ConfirmDialog.tsx` |

## Studio 2.1 — revisão e busca

O resumo das novidades está no [CHANGELOG](CHANGELOG.md). Esta seção descreve o funcionamento.

### Busca sem acento

O SQLite não tem `unaccent`. Cada conexão registra a função determinística `aw_fold` (`audiowhisper_core.text.fold_text`: NFKD sem marcas combinantes + `casefold`). A biblioteca e `/api/search` comparam `aw_fold(coluna) LIKE aw_fold(termo)`, com `%`, `_` e `\` digitados tratados como literais. Os trechos de contexto são cortados em limites de palavra e mapeiam a posição do texto dobrado de volta ao original, o que vale mesmo quando o tamanho muda (como em "ß" → "ss"). A URL `/jobs/{id}?t=SEGUNDOS` abre o editor no instante e seleciona o trecho. Assim como os filtros da biblioteca, `q` em `/search` é uma exceção explícita, que pode ser limpa, à regra de não colocar conteúdo em URLs.

### Insights e confiança

`GET /api/jobs/{id}/stats` calcula tudo a partir dos segmentos persistidos: união dos intervalos com fala, palavras, ritmo sobre o tempo falado, participação e maior turno por falante, trocas de turno, perguntas (trechos terminados em "?"), termos frequentes sem palavras vazias em português e inglês, e atividade por faixa de tempo. A confiança de cada trecho é a média de `exp(avg_logprob)` do faster-whisper. O limiar de "incerto" (padrão de 60%) fica em `low_confidence_threshold`. Nenhum valor é estimado: sem falantes atribuídos, a participação aparece como "Não identificado".

### Edição estrutural

Dividir (`POST …/segments/{id}/split`) usa a posição do cursor. Com horários por palavra, o corte acontece no início da primeira palavra da segunda parte; sem eles, o tempo é proporcional ao texto. Juntar (`POST …/segments/merge`) exige trechos consecutivos, une palavras e texto e recalcula a confiança ponderada pela duração. As duas operações renumeram `segment_index`, movem os marcadores afetados e só valem para transcrições concluídas. Como alteram o hash da fonte, documentos gerados antes ficam marcados como desatualizados. O editor salva as edições pendentes antes de reorganizar e limpa o histórico de desfazer, cujas cópias apontariam para trechos que deixaram de existir.

### Participantes e marcadores

Participantes podem ser criados sem diarização (`manual-N`), mesclados (todos os trechos de A passam para B) e removidos (os trechos voltam a "Não identificado"). `PUT …/segments/speaker` atribui um falante a vários trechos de uma vez. Marcadores (`/api/jobs/{id}/bookmarks`, `/api/bookmarks/{id}`) guardam horário, nome, nota e uma de cinco cores do design system, com limite de 500 por gravação. A migração `f3b021` cria a tabela com colunas explícitas, porque a `e2a010` monta suas tabelas a partir dos modelos atuais e não poderia ser reaproveitada.

### Vocabulário

`vocabulary` e `hotwords` (configurações) chegam ao faster-whisper como `initial_prompt` e `hotwords` em arquivos, capturas e novas transcrições. Eles orientam a grafia de nomes e termos realmente falados e não são inseridos no texto. Upload, captura e retranscrição montam as configurações com a mesma função (`lib/transcription-settings.ts`).

### Exportação

`render_export` é a única fonte de todos os formatos: falantes por turno no TXT e no Markdown, `Nome:` no SRT, `<v Nome>` no VTT (com `&`, `<` e `>` escapados) e CSV com BOM UTF-8 e células iniciadas por `= + - @` neutralizadas. Legendas ignoram trechos vazios. `GET …/exports/bundle` gera o ZIP em memória, sem gravar no disco. Os nomes de arquivo vêm do título (`Content-Disposition` com `filename*` UTF-8). PDF e DOCX interpretam `**negrito**`, listas e tabelas de metadados.

### Operação

- `GET /api/system/storage`: bytes e arquivos por pasta, banco (incluindo WAL) e disco.
- `POST /api/system/cleanup` com `tmp` ou `exports`: remove só dados regeneráveis. Temporários de jobs ativos e arquivos com menos de 15 minutos ficam.
- `GET /api/system/queue`: fila, jobs em andamento (os que estão rodando primeiro), documentos pendentes e presença do worker pelo heartbeat. O indicador do cabeçalho consulta a cada 8 s, pausa com a aba oculta e atualiza na hora quando um job começa ou termina na página.
- `GET /api/health` informa `worker` sem alterar `status`: a API segue saudável enquanto o worker reinicia ou baixa um modelo.
- `DELETE /api/jobs/{id}` recusa jobs ativos, remove linhas, exportações e trechos live depois do commit e apaga o arquivo original apenas quando nenhuma outra execução o usa. `POST /api/library/bulk` aplica exclusão ou organização item a item e devolve o que foi mantido e o motivo.
- `POST /api/jobs/{id}/retranscribe` cria uma nova execução sobre a mesma mídia e copia título, pasta, projeto e tags (os falantes não, porque os trechos mudam).
- O esquema OpenAPI fica em `/api/openapi.json`, sujeito ao mesmo token da API. Não há páginas Swagger/ReDoc, que carregariam recursos de CDNs públicas.

### Erros

Erros não tratados viram `500` com `INTERNAL_ERROR`, `request_id` e o cabeçalho `X-Request-ID`, sem detalhes internos; o traceback vai para o log da API. Se a fila estiver indisponível ao criar ou repetir uma transcrição, o job passa a `failed` com `QUEUE_UNAVAILABLE` e o botão "Tentar novamente" fica disponível. Encerrar ou recuperar uma captura nessa situação responde `503` e mantém o estado salvo; a recuperação do worker também finaliza capturas em `stopping`. As configurações são validadas por completo, com mensagens por campo, e chaves desconhecidas continuam sendo ignoradas. No navegador, falhas de rede viram uma mensagem em português e cancelamentos (`AbortError`) continuam silenciosos.

## Validação

API: `.venv-dev/Scripts/python -m pytest apps/api/tests -q -p no:cacheprovider --basetemp=.devdata/pytest-api`.
Worker: `.venv-dev/Scripts/python -m pytest apps/worker/tests -q -p no:cacheprovider --basetemp=.devdata/pytest-worker`.
Frontend, em `apps/web`: `npm run test:coverage`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e` e, depois, `npm run test:visual`.

Os testes de Studio usam microfone sintético, inferência de transcrição e Ollama reais. Os testes de SMTP usam substituto local e não enviam mensagens. Diarização com Community-1 exige um modelo autorizado; sua ausência não é tratada como identificação validada. `DESIGN.md` e `UX-CONTRACT.md` registram a identidade e os contratos. O relatório de [validação](VALIDATION.md) registra comandos, cobertura e limites do QA.
