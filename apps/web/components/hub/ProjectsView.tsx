"use client";
import { DraftGuard } from "@/components/ui/WorkspaceDialog";
import Link from "next/link";
import { useState } from "react";
import {
  useWorkspaceMutation,
  useWorkspaceResource,
} from "@/hooks/useWorkspaceResource";
import {
  workspaceApi,
  type Project,
  type ProjectDetail,
} from "@/lib/workspace-api";
import { formatDuration, formatRelativeTime, statusLabel } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import {
  HubPage,
  HubPanel,
  HubDisclosure,
  MutationFeedback,
  Pagination,
  QuerySearch,
  ResourceState,
  useHubFilters,
} from "./HubUI";
import type { LibraryPage } from "@/lib/types";

export function RecordingList({ page }: { page: LibraryPage }) {
  return (
    <ul className="hub-recordings">
      {page.items.map((item) => (
        <li key={item.job.id}>
          <Link href={`/jobs/${item.job.id}`}>
            <span className="hub-recording-icon">
              <Icon name="studio" />
            </span>
            <span className="min-w-0">
              <strong>{item.title || item.name}</strong>
              <small>
                {formatRelativeTime(item.job.created_at)} ·{" "}
                {item.duration_seconds
                  ? formatDuration(item.duration_seconds)
                  : "Duração em processamento"}
              </small>
            </span>
            <span className="hub-status">{statusLabel(item.job.status)}</span>
            <Icon name="arrow" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ProjectsView() {
  const filters = useHubFilters(),
    q = filters.params.get("q") ?? "";
  const resource = useWorkspaceResource(
    (signal) =>
      workspaceApi.projects(
        { q, offset: filters.params.get("offset") ?? "0" },
        signal,
      ),
    filters.key,
  );
  const mutation = useWorkspaceMutation();
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [color, setColor] = useState<Project["color"]>("blue");
  return (
    <HubPage
      title="Projetos"
      description="Organize gravações e tarefas por projeto."
    >
      <div className="hub-collection-layout">
        <div className="min-w-0">
          <QuerySearch
            current={q}
            commit={(value) => filters.change("q", value)}
            label="Buscar projetos"
            placeholder="Encontre um projeto"
          />
          <ResourceState
            {...resource}
            retry={resource.refresh}
            empty={
              resource.data?.items.length === 0
                ? {
                    title: "Nenhum projeto encontrado",
                    text: "Crie um projeto e escolha-o em “Organizar conversa” no editor. Os projetos que você já usa aparecem automaticamente.",
                  }
                : undefined
            }
          >
            <div className="project-grid">
              {resource.data?.items.map((project) => (
                <Link
                  key={project.name}
                  href={`/projects/${encodeURIComponent(project.name)}`}
                  className={`project-card tint-${project.color}`}
                >
                  <div className="project-card-top">
                    <span className="project-monogram">
                      {Array.from(project.name)[0]?.toLocaleUpperCase("pt-BR")}
                    </span>
                    <Icon name="arrow" />
                  </div>
                  <h2>{project.name}</h2>
                  {project.description && <p>{project.description}</p>}
                  <footer>
                    <span>
                      <strong>{project.recording_count}</strong> gravações
                    </span>
                    <span>{formatDuration(project.duration_seconds)}</span>
                  </footer>
                  {project.last_activity && (
                    <small>
                      Atividade {formatRelativeTime(project.last_activity)}
                    </small>
                  )}
                </Link>
              ))}
            </div>
          </ResourceState>
          <Pagination
            page={resource.data}
            change={(value) => filters.change("offset", value)}
          />
        </div>
        <HubDisclosure title="Novo projeto">
          <form
            noValidate
            className="hub-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) {
                e.currentTarget
                  .querySelector<HTMLInputElement>("input")
                  ?.focus();
                return;
              }
              if (
                await mutation.execute(
                  () =>
                    workspaceApi.createProject({
                      name: name.trim(),
                      description,
                      color,
                    }),
                  "Projeto criado.",
                )
              ) {
                setName("");
                setDescription("");
                resource.refresh();
              }
            }}
          >
            <DraftGuard dirty={!!(name || description)} />
            <label className="hub-label">
              Nome do projeto
              <input
                className="field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={128}
                required
              />
            </label>
            <label className="hub-label">
              Descrição
              <textarea
                className="field min-h-32 resize-none"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={4000}
                placeholder="Qual é o contexto deste projeto?"
              />
            </label>
            <label className="hub-label">
              Cor
              <select
                className="field"
                value={color}
                onChange={(e) => setColor(e.target.value as Project["color"])}
              >
                <option value="blue">Azul</option>
                <option value="amber">Âmbar</option>
                <option value="violet">Violeta</option>
                <option value="green">Verde</option>
              </select>
            </label>
            <Button
              variant="primary"
              type="submit"
              disabled={mutation.busy || !name.trim()}
            >
              Criar projeto
            </Button>
            <MutationFeedback {...mutation} />
          </form>
        </HubDisclosure>
      </div>
    </HubPage>
  );
}

function ProjectSettings({
  project,
  refresh,
}: {
  project: ProjectDetail;
  refresh: () => void;
}) {
  const [description, setDescription] = useState(project.description),
    [color, setColor] = useState(project.color);
  const mutation = useWorkspaceMutation();
  return (
    <details className="hub-disclosure">
      <summary>Editar contexto do projeto</summary>
      <form
        noValidate
        className="hub-form pt-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await mutation.execute(
              () =>
                workspaceApi.editProject(project.name, { description, color }),
              "Contexto salvo.",
            )
          )
            refresh();
        }}
      >
        <DraftGuard
          dirty={description !== project.description || color !== project.color}
        />
        <label className="hub-label">
          Descrição do projeto
          <textarea
            className="field min-h-32 resize-none"
            value={description}
            maxLength={4000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="hub-label">
          Cor do projeto
          <select
            className="field"
            value={color}
            onChange={(e) => setColor(e.target.value as Project["color"])}
          >
            {["blue", "amber", "violet", "green"].map((tone, i) => (
              <option key={tone} value={tone}>
                {["Azul", "Âmbar", "Violeta", "Verde"][i]}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={mutation.busy} type="submit">
          Salvar contexto
        </Button>
        <MutationFeedback {...mutation} />
      </form>
    </details>
  );
}

export function ProjectDetailView({ name }: { name: string }) {
  const filters = useHubFilters();
  const resource = useWorkspaceResource(
    (signal) =>
      workspaceApi.project(
        name,
        Number(filters.params.get("offset") ?? 0),
        signal,
      ),
    name + filters.key,
  );
  const project = resource.data,
    suffix = `?project=${encodeURIComponent(name)}`;
  return (
    <HubPage
      title={name}
      description={
        project?.description || "Gravações e participantes deste projeto."
      }
      action={
        <Link href="/projects" className="hub-text-link">
          ← Todos os projetos
        </Link>
      }
    >
      <ResourceState {...resource} retry={resource.refresh}>
        <div className="project-overview">
          <div className={`project-banner tint-${project?.color ?? "blue"}`}>
            <Icon name="library" />
            <span>
              <strong>{project?.recording_count ?? 0}</strong> gravações
              conectadas
            </span>
            <span>
              {formatDuration(project?.duration_seconds ?? 0)} de áudio do
              projeto
            </span>
          </div>
          <nav className="hub-shortcuts" aria-label="Ferramentas do projeto">
            {[
              ["/search", "search", "Buscar trechos"],
              ["/tasks", "tasks", "Acompanhar tarefas"],
              ["/notebook", "bookmark", "Abrir caderno"],
              ["/knowledge", "search", "Consultar gravações"],
              ["/recipes", "workflow", "Modelos do projeto"],
            ].map(([href, icon, label]) => (
              <Link key={href} href={href + suffix}>
                <Icon name={icon as "search"} />
                {label}
                <Icon name="arrow" />
              </Link>
            ))}
          </nav>
        </div>
        <div className="hub-split">
          <HubPanel title="Gravações do projeto">
            {project?.recordings.items.length ? (
              <RecordingList page={project.recordings} />
            ) : (
              <div className="hub-empty">
                <p>
                  Abra uma gravação na biblioteca e escolha este projeto em
                  “Organizar conversa”.
                </p>
                <Link href="/library" className="hub-text-link">
                  Escolher gravação →
                </Link>
              </div>
            )}
            <Pagination
              page={project?.recordings ?? null}
              change={(value) => filters.change("offset", value)}
            />
          </HubPanel>
          <HubPanel title="Participantes">
            <ul className="participant-list">
              {project?.participants.map((person, i) => (
                <li key={person}>
                  <span
                    className={`participant-avatar tint-${["blue", "amber", "violet", "green"][i % 4]}`}
                  >
                    {Array.from(person)[0]}
                  </span>
                  {person}
                </li>
              ))}
            </ul>
            {project?.participants.length === 0 && (
              <p className="text-text-muted">
                Os nomes revisados no editor aparecem aqui.
              </p>
            )}
            {project && (
              <ProjectSettings
                key={name}
                project={project}
                refresh={resource.refresh}
              />
            )}
          </HubPanel>
        </div>
      </ResourceState>
    </HubPage>
  );
}
