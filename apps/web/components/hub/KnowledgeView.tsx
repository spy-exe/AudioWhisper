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
            : "Consultando os trechos recuperados no Ollama…"}
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
            {question.retrieval_count} trechos recuperados · {question.model} ·
            confira a interpretação antes de usar.
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
      eyebrow="INTELIGÊNCIA SOBRE A SUA MEMÓRIA"
      title="Pergunte às conversas."
      description="Cruze reuniões, recupere contexto e compare decisões. A resposta vem com caminhos de volta às falas que a sustentam."
    >
      <div className="knowledge-layout">
        <HubPanel
          title="Uma boa pergunta abre caminhos"
          label="ASSISTENTE LOCAL"
        >
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
            <LocalModelField
              resource={models}
              value={effectiveModel}
              onChange={setModel}
            />
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
              A recuperação usa palavras da pergunta e consulta até 80 trechos
              relevantes. Sem seleção, busca em todas as gravações concluídas
              deste contexto. A resposta pode não cobrir toda a biblioteca.
            </p>
            <Button
              variant="primary"
              type="submit"
              disabled={
                mutation.busy || !effectiveModel || question.trim().length < 3
              }
            >
              <Icon name="sparkle" />
              Consultar gravações
            </Button>
            <MutationFeedback {...mutation} />
          </form>
        </HubPanel>
        <aside className="knowledge-aside">
          <span className="knowledge-orbit" aria-hidden="true">
            <Icon name="studio" />
            <i />
            <i />
          </span>
          <h2>Contexto que se conecta.</h2>
          <p>
            Faça perguntas específicas, compare encaminhamentos e abra o áudio
            para conferir cada interpretação.
          </p>
          <ul>
            <li>Seu modelo local no Ollama</li>
            <li>Citações copiadas do texto original</li>
            <li>Ausências continuam como não encontradas</li>
          </ul>
        </aside>
      </div>
      <div className="hub-results-heading">
        <h2>Seu histórico de perguntas</h2>
        <span>{history.data?.total ?? 0} consultas</span>
      </div>
      <ResourceState
        {...history}
        retry={history.refresh}
        empty={
          history.data?.items.length === 0
            ? {
                title: "Sua primeira conexão começa com uma pergunta",
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
