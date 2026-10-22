"use client";
import { DraftGuard } from "@/components/ui/WorkspaceDialog";
import { useEffect, useState } from "react";
import {
  useWorkspaceMutation,
  useWorkspaceResource,
} from "@/hooks/useWorkspaceResource";
import { workspaceApi, type Note } from "@/lib/workspace-api";
import { formatTimestamp } from "@/lib/format";
import type { TranscriptSegment } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import {
  HubPage,
  HubPanel,
  MutationFeedback,
  Pagination,
  ProjectField,
  QuerySearch,
  ResourceState,
  SourceList,
  useHubFilters,
} from "./HubUI";

const kinds = { note: "Nota", bookmark: "Marcador", chapter: "Capítulo" };

function NoteEdit({ note, refresh }: { note: Note; refresh: () => void }) {
  const [title, setTitle] = useState(note.title),
    [body, setBody] = useState(note.body),
    [kind, setKind] = useState(note.kind);
  const mutation = useWorkspaceMutation();
  return (
    <form
      noValidate
      className="hub-form mt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await mutation.execute(
            () => workspaceApi.editNote(note, { title, body, kind }),
            "Nota salva.",
          )
        )
          refresh();
      }}
    >
      <DraftGuard
        dirty={title !== note.title || body !== note.body || kind !== note.kind}
      />
      <label className="hub-label">
        Título da nota
        <input
          className="field"
          value={title}
          maxLength={512}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="hub-label">
        Anotação
        <textarea
          className="field min-h-32 resize-none"
          value={body}
          maxLength={12000}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <label className="hub-label">
        Tipo da nota
        <select
          className="field"
          value={kind}
          onChange={(e) => setKind(e.target.value as Note["kind"])}
        >
          {Object.entries(kinds).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" disabled={mutation.busy || !title.trim()}>
        Salvar nota
      </Button>
      <MutationFeedback {...mutation} />
    </form>
  );
}

function NoteCard({
  note,
  refresh,
  onSource,
}: {
  note: Note;
  refresh: () => void;
  onSource?: (id: string) => void;
}) {
  const mutation = useWorkspaceMutation();
  return (
    <article className={`notebook-card note-${note.kind}`}>
      <header>
        <span className="hub-kicker">{kinds[note.kind]}</span>
        <span className="text-xs text-text-muted">
          {note.project || "Sem projeto"}
        </span>
      </header>
      <h3>{note.title}</h3>
      {note.body && <p className="whitespace-pre-wrap">{note.body}</p>}
      {onSource && note.sources[0] && (
        <Button size="sm" onClick={() => onSource(note.sources[0]!.segment_id)}>
          Ir para {formatTimestamp(note.sources[0].start)}
        </Button>
      )}
      <SourceList sources={note.sources} />
      <details className="hub-disclosure">
        <summary>Editar anotação</summary>
        <NoteEdit key={note.revision} note={note} refresh={refresh} />
      </details>
      <Button
        size="sm"
        variant="ghost"
        disabled={mutation.busy}
        onClick={async () => {
          if (
            await mutation.execute(
              () => workspaceApi.editNote(note, { archived: !note.archived }),
              note.archived
                ? "Anotação restaurada."
                : "Anotação arquivada. A restauração fica disponível em Arquivadas.",
            )
          )
            refresh();
        }}
      >
        {note.archived ? "Restaurar" : "Arquivar"}
      </Button>
      <MutationFeedback {...mutation} />
    </article>
  );
}

export function NotebookView() {
  const filters = useHubFilters(),
    archived = filters.params.get("archived") === "true";
  const resource = useWorkspaceResource(
    (signal) =>
      workspaceApi.notes(
        {
          project: filters.params.get("project") ?? "",
          kind: filters.params.get("kind") ?? "all",
          q: filters.params.get("q") ?? "",
          archived,
          offset: filters.params.get("offset") ?? "0",
        },
        signal,
      ),
    filters.key,
  );
  return (
    <HubPage
      eyebrow="IDEIAS QUE MERECEM FICAR"
      title="Caderno de escuta"
      description="Guarde um ponto importante, dê nome a um capítulo e conecte suas anotações ao momento exato da conversa."
    >
      <QuerySearch
        current={filters.params.get("q") ?? ""}
        commit={(value) => filters.change("q", value)}
        label="Buscar no caderno"
        placeholder="Encontre uma ideia ou anotação"
      />
      <div className="hub-filter-row">
        <ProjectField
          value={filters.params.get("project") ?? ""}
          onChange={(value) => filters.change("project", value)}
        />
        <label className="hub-label">
          Tipo
          <select
            className="field"
            value={filters.params.get("kind") ?? "all"}
            onChange={(e) => filters.change("kind", e.target.value)}
          >
            <option value="all">Todos os registros</option>
            {Object.entries(kinds).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="hub-check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) =>
              filters.change("archived", String(e.target.checked))
            }
          />
          Arquivadas
        </label>
      </div>
      <ResourceState
        {...resource}
        retry={resource.refresh}
        empty={
          resource.data?.items.length === 0
            ? {
                title: "Uma ideia pode começar em qualquer segundo",
                text: "Abra uma gravação, encontre um trecho e use o Caderno da reunião para criar uma nota, um marcador ou um capítulo.",
              }
            : undefined
        }
      >
        <div className="notebook-grid">
          {resource.data?.items.map((note) => (
            <NoteCard key={note.id} note={note} refresh={resource.refresh} />
          ))}
        </div>
        <Pagination
          page={resource.data}
          change={(value) => filters.change("offset", value)}
        />
      </ResourceState>
    </HubPage>
  );
}

export function MeetingNotebook({
  jobId,
  segments,
  currentTime,
  onSource,
}: {
  jobId: string;
  segments: TranscriptSegment[];
  currentTime: number;
  onSource: (id: string) => void;
}) {
  const [segmentId, setSegmentId] = useState(segments[0]?.id ?? ""),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [kind, setKind] = useState<Note["kind"]>("bookmark");
  const resource = useWorkspaceResource(
    (signal) => workspaceApi.notes({ job_id: jobId, limit: 100 }, signal),
    jobId,
  );
  const mutation = useWorkspaceMutation();
  useEffect(() => {
    if (!segments.some((segment) => segment.id === segmentId))
      setSegmentId(segments[0]?.id ?? "");
  }, [segments, segmentId]);
  return (
    <HubPanel title="Caderno da reunião" label="MARQUE O QUE IMPORTA">
      <form
        noValidate
        className="hub-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await mutation.execute(
              () =>
                workspaceApi.createNote(jobId, {
                  segment_id: segmentId,
                  title: title.trim(),
                  body,
                  kind,
                }),
              "Registro salvo no caderno.",
            )
          ) {
            setTitle("");
            setBody("");
            resource.refresh();
          }
        }}
      >
        <DraftGuard dirty={!!(title || body)} />
        <div className="hub-form-grid">
          <label className="hub-label">
            Trecho de origem
            <select
              className="field"
              value={segmentId}
              onChange={(e) => setSegmentId(e.target.value)}
            >
              {segments.map((segment) => (
                <option key={segment.id} value={segment.id}>
                  {formatTimestamp(segment.start)} · {segment.text.slice(0, 90)}
                </option>
              ))}
            </select>
          </label>
          <label className="hub-label">
            Tipo de registro
            <select
              className="field"
              value={kind}
              onChange={(e) => setKind(e.target.value as Note["kind"])}
            >
              {Object.entries(kinds).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!segments.length}
          onClick={() => {
            const segment =
              segments.find(
                (s) => s.start <= currentTime && s.end >= currentTime,
              ) ??
              [...segments].reverse().find((s) => s.start <= currentTime) ??
              segments[0];
            if (segment) setSegmentId(segment.id);
          }}
        >
          Usar trecho em reprodução
        </Button>
        <label className="hub-label">
          Título do registro
          <input
            className="field"
            value={title}
            maxLength={512}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="O que merece voltar à conversa?"
          />
        </label>
        <label className="hub-label">
          Sua anotação
          <textarea
            className="field min-h-24 resize-none"
            value={body}
            maxLength={12000}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <Button
          variant="primary"
          type="submit"
          disabled={mutation.busy || !segmentId || !title.trim()}
        >
          Salvar no caderno
        </Button>
        <MutationFeedback {...mutation} />
      </form>
      <div className="mt-6">
        <ResourceState
          {...resource}
          retry={resource.refresh}
          empty={
            resource.data?.items.length === 0
              ? {
                  title: "Marque seu primeiro momento",
                  text: "Seus registros ficam ligados ao trecho original e também aparecem no caderno do projeto.",
                }
              : undefined
          }
        >
          <div className="notebook-grid">
            {resource.data?.items.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                refresh={resource.refresh}
                onSource={onSource}
              />
            ))}
          </div>
          {resource.data && resource.data.total > 100 && (
            <p className="hub-field-hint">
              Mostrando os 100 registros mais recentes. Consulte os demais no
              Caderno de escuta.
            </p>
          )}
        </ResourceState>
      </div>
    </HubPanel>
  );
}
