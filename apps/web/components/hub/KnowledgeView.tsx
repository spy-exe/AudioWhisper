"use client";
import { DraftGuard } from "@/components/ui/WorkspaceDialog";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  useWorkspaceMutation,
  useWorkspaceResource,
} from "@/hooks/useWorkspaceResource";
import { sourceUrl, workspaceApi, type Question } from "@/lib/workspace-api";
import { formatRelativeTime, formatTimestamp } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import {
  HubPage,
  HubPanel,
  MutationFeedback,
  Pagination,
  ProjectField,
  ResourceState,
  SourceList,
  useHubFilters,
} from "./HubUI";
import {
  LocalModelField,
  RecordingPicker,
  useLocalModels,
} from "./IntelligenceUI";

function AnswerCard({
  question,
  refresh,
}: {
  question: Question;
  refresh: () => void;
}) {
  const mutation = useWorkspaceMutation();
  const retry = async () => {
    if (
      await mutation.execute(
        () =>
          question.status === "failed"
            ? workspaceApi.retryQuestion(question.id)
            : workspaceApi.ask({
                question: question.question,
                project: question.project,
                model: question.model,
                job_ids: question.job_ids,
              }),
        "Consulta adicionada à fila.",
      )
    )
      refresh();
  };
  return (
    <article className="answer-card">
      <header>
        <span className="hub-kicker">
          {question.project || "SUA BIBLIOTECA"}
        </span>
        <span className="text-xs text-text-muted">
          {formatRelativeTime(question.created_at)}
        </span>
      </header>
      <h3>{question.question}</h3>
      {["queued", "generating"].includes(question.status) && (
        <p role="status" className="answer-pending">
          <Icon name="studio" />
          {question.status === "queued"
            ? "Na fila local · aguardando os trabalhos anteriores"
            : "Consultando as gravações…"}
        </p>
      )}
      {question.status === "failed" && (
        <p role="alert" className="text-danger">
          {question.error}
        </p>
      )}
      {question.status === "completed" && (
        <>
          {question.items.length > 0 ? (
            <ul className="answer-items">
              {question.items.map((item, i) => (
                <li key={i}>
                  <p>{item.text}</p>
                  <div className="hub-inline-actions">
                    {item.source_segment_ids.map((id) => {
                      const source = question.sources.find(
                        (source) => source.segment_id === id,
                      );
                      return source ? (
                        <Link
                          key={id}
                          className="hub-text-link"
                          href={sourceUrl(source)}
                        >
                          Fonte {question.sources.indexOf(source) + 1} ·{" "}
                          {formatTimestamp(source.start)}
                          {source.stale ? " · alterada" : ""}
                        </Link>
                      ) : null;
                    })}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="answer-no-match">
              Informação não encontrada nos trechos recuperados. Experimente
              citar o assunto com outras palavras ou selecionar gravações
              específicas.
            </p>
          )}
          <p className="hub-field-hint">
            {question.retrieval_count} trechos consultados. Confira as fontes
            antes de usar a resposta.
          </p>
          {question.stale && (
            <p className="text-warning">
              Uma fonte foi alterada. Consulte novamente para usar o texto
              atual.
            </p>
          )}
          <SourceList sources={question.sources} />
          <div className="hub-inline-actions">
            <Button
              size="sm"
              disabled={mutation.busy || question.items.length === 0}
              onClick={() =>
                void mutation.execute(
                  () =>
                    navigator.clipboard.writeText(
                      question.items.map((item) => item.text).join("\n\n"),
                    ),
                  "Resposta copiada.",
                )
              }
            >
              Copiar resposta
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={mutation.busy}
              onClick={retry}
            >
              Consultar novamente
            </Button>
          </div>
        </>
      )}
      {question.status === "failed" && (
        <Button size="sm" disabled={mutation.busy} onClick={retry}>
          Tentar consulta novamente
        </Button>
      )}
      <MutationFeedback {...mutation} />
    </article>
  );
}

export function KnowledgeView() {
  const filters = useHubFilters(),
    project = filters.params.get("project") ?? "";
  const history = useWorkspaceResource(
    (signal) =>
      workspaceApi.questions(
        { project, offset: filters.params.get("offset") ?? "0" },
        signal,
      ),
    filters.key,
    3000,
  );
  const models = useLocalModels(),
    mutation = useWorkspaceMutation();
  const [question, setQuestion] = useState(""),
    [model, setModel] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [choosing, setChoosing] = useState(false);
  const effectiveModel = models.data?.models.includes(model)
    ? model
    : (models.data?.models[0] ?? "");
  useEffect(() => {
    setSelected([]);
  }, [project]);
  return (
    <HubPage
      title="Consultas"
      description="Faça uma pergunta sobre as gravações e confira as fontes da resposta."
    >
      <div className="knowledge-layout">
        <HubPanel title="Nova consulta">
          <form
            noValidate
            className="hub-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await mutation.execute(
                  () =>
                    workspaceApi.ask({
                      question: question.trim(),
                      project,
                      model: effectiveModel,
                      job_ids: selected,
                    }),
                  "Pergunta adicionada à fila local.",
                )
              ) {
                setQuestion("");
                history.refresh();
              }
            }}
          >
            <DraftGuard dirty={!!question} />
            <label className="hub-label">
              Sua pergunta
              <textarea
                className="field question-input resize-none"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={2000}
                placeholder="O que mudou no plano de backup entre as reuniões?"
                aria-describedby="retrieval-help"
              />
            </label>
            <ProjectField
              value={project}
              onChange={(value) => filters.change("project", value)}
              label="Contexto da consulta"
            />
            <details className="hub-disclosure">
              <summary>Modelo e limites da consulta</summary>
              <div className="hub-form mt-4">
                <LocalModelField
                  resource={models}
                  value={effectiveModel}
                  onChange={setModel}
                />
                <p className="hub-field-hint">
                  Busca por palavras em até 80 trechos. A resposta pode não
                  cobrir toda a biblioteca.
                </p>
              </div>
            </details>
            <details
              className="hub-disclosure"
              onToggle={(e) => setChoosing(e.currentTarget.open)}
            >
              <summary>
                Escolher gravações
                {selected.length
                  ? ` · ${selected.length} selecionadas`
                  : " · opcional"}
              </summary>
              {choosing && (
                <RecordingPicker
                  project={project}
                  selected={selected}
                  onChange={setSelected}
                />
              )}
            </details>
            <p id="retrieval-help" className="hub-field-hint">
              Consulte as fontes antes de usar a resposta. Sem seleção, são
              consideradas as gravações concluídas do projeto.
            </p>
            {!models.loading && !effectiveModel && (
              <p role="alert" className="text-warning">
                {models.error ||
                  models.data?.error ||
                  "Nenhum modelo de processamento disponível."}{" "}
                Abra “Modelo e limites da consulta” para verificar a conexão.
              </p>
            )}
            <Button
              variant="primary"
              type="submit"
              disabled={
                mutation.busy || !effectiveModel || question.trim().length < 3
              }
            >
              <Icon name="search" />
              Consultar gravações
            </Button>
            <MutationFeedback {...mutation} />
          </form>
        </HubPanel>
      </div>
      <div className="hub-results-heading">
        <h2>Histórico de consultas</h2>
        <span>{history.data?.total ?? 0} consultas</span>
      </div>
      <ResourceState
        {...history}
        retry={history.refresh}
        empty={
          history.data?.items.length === 0
            ? {
                title: "Nenhuma consulta realizada",
                text: "Escolha um tema das suas reuniões e consulte o acervo local.",
              }
            : undefined
        }
      >
        <div className="answer-list">
          {history.data?.items.map((item) => (
            <AnswerCard
              key={item.id}
              question={item}
              refresh={history.refresh}
            />
          ))}
        </div>
        <Pagination
          page={history.data}
          change={(value) => filters.change("offset", value)}
        />
      </ResourceState>
    </HubPage>
  );
}
