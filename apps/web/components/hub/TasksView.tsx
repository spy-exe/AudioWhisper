"use client";
import { DraftGuard } from "@/components/ui/WorkspaceDialog";
import { useState } from "react";
import {
  useWorkspaceMutation,
  useWorkspaceResource,
} from "@/hooks/useWorkspaceResource";
import {
  workspaceApi,
  localDate,
  dateLabel,
  type Task,
  type TaskStatus,
} from "@/lib/workspace-api";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
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

const statuses: Record<TaskStatus, string> = {
  open: "A fazer",
  doing: "Em andamento",
  done: "Concluídas",
};

function TaskEdit({ task, onSaved }: { task: Task; onSaved: () => void }) {
  const [title, setTitle] = useState(task.title),
    [description, setDescription] = useState(task.description),
    [assignee, setAssignee] = useState(task.assignee ?? ""),
    [due, setDue] = useState(task.due_date ?? ""),
    [priority, setPriority] = useState(task.priority),
    [project, setProject] = useState(task.project);
  const mutation = useWorkspaceMutation();
  return (
    <form
      noValidate
      className="hub-form mt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await mutation.execute(
            () =>
              workspaceApi.editTask(task, {
                title,
                description,
                assignee: assignee.trim() || null,
                due_date: due || null,
                priority,
                project,
              }),
            "Tarefa salva.",
          )
        )
          onSaved();
      }}
    >
      <DraftGuard
        dirty={
          title !== task.title ||
          description !== task.description ||
          assignee !== (task.assignee ?? "") ||
          due !== (task.due_date ?? "") ||
          project !== task.project ||
          priority !== task.priority
        }
      />
      <label className="hub-label">
        Título
        <input
          className="field"
          value={title}
          maxLength={512}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="hub-label">
        Detalhes
        <textarea
          className="field min-h-28 resize-none"
          value={description}
          maxLength={12000}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="hub-label">
        Responsável
        <input
          className="field"
          value={assignee}
          maxLength={256}
          onChange={(e) => setAssignee(e.target.value)}
        />
      </label>
      <label className="hub-label">
        Prazo da tarefa
        <input
          type="date"
          className="field"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </label>
      <label className="hub-label">
        Prioridade
        <select
          className="field"
          value={priority}
          onChange={(e) => setPriority(e.target.value as Task["priority"])}
        >
          <option value="low">Baixa</option>
          <option value="normal">Normal</option>
          <option value="high">Alta</option>
        </select>
      </label>
      <ProjectField
        value={project}
        onChange={setProject}
        allLabel="Sem projeto"
      />
      <Button disabled={mutation.busy || !title.trim()} type="submit">
        Salvar tarefa
      </Button>
      <MutationFeedback {...mutation} />
    </form>
  );
}

export function TaskCard({
  task,
  refresh,
}: {
  task: Task;
  refresh: () => void;
}) {
  const mutation = useWorkspaceMutation();
  const late =
    !!task.due_date && task.due_date < localDate() && task.status !== "done";
  return (
    <article className={`task-card priority-${task.priority}`}>
      <div className="task-card-meta">
        <span>{task.project || "Pessoal"}</span>
        <span>
          {task.priority === "high"
            ? "Prioridade alta"
            : task.priority === "low"
              ? "Prioridade baixa"
              : "Prioridade normal"}
        </span>
      </div>
      <h3>{task.title}</h3>
      {task.description && task.description !== task.title && (
        <p className="task-description">{task.description}</p>
      )}
      <div className="task-owner">
        <span className="participant-avatar tint-blue">
          {task.assignee ? Array.from(task.assignee)[0] : "—"}
        </span>
        <span>{task.assignee || "Responsável não definido"}</span>
      </div>
      <p className={`task-due ${late ? "text-warning" : "text-text-muted"}`}>
        {late && "Prazo vencido · "}
        {task.due_date
          ? dateLabel(task.due_date)
          : task.due_label
            ? `Na conversa: ${task.due_label} · defina uma data`
            : "Sem prazo definido"}
      </p>
      {task.stale && (
        <p className="text-warning text-xs">
          Fonte alterada · confira o áudio novamente.
        </p>
      )}
      <SourceList sources={task.sources} compact />
      <div className="task-card-actions">
        <label className="hub-label">
          Estado
          <select
            className="field"
            aria-label={`Estado de ${task.title}`}
            value={task.status}
            disabled={mutation.busy}
            onChange={async (e) => {
              const status = e.target.value as TaskStatus;
              if (
                await mutation.execute(
                  () => workspaceApi.editTask(task, { status }),
                  "Estado atualizado.",
                )
              )
                refresh();
            }}
          >
            {Object.entries(statuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          disabled={mutation.busy}
          onClick={async () => {
            if (
              await mutation.execute(
                () => workspaceApi.editTask(task, { archived: !task.archived }),
                task.archived
                  ? "Tarefa restaurada."
                  : "Tarefa arquivada. Você pode restaurá-la em Arquivadas.",
              )
            )
              refresh();
          }}
        >
          {task.archived ? "Restaurar" : "Arquivar"}
        </Button>
      </div>
      <details className="hub-disclosure">
        <summary>Editar tarefa</summary>
        <TaskEdit key={task.revision} task={task} onSaved={refresh} />
      </details>
      <MutationFeedback {...mutation} />
    </article>
  );
}

export function TasksView() {
  const filters = useHubFilters(),
    project = filters.params.get("project") ?? "",
    status = filters.params.get("status") ?? "all",
    archived = filters.params.get("archived") === "true";
  const resource = useWorkspaceResource(
    (signal) =>
      workspaceApi.tasks(
        {
          project,
          status,
          archived,
          task_id: filters.params.get("task_id") ?? "",
          q: filters.params.get("q") ?? "",
          offset: filters.params.get("offset") ?? "0",
        },
        signal,
      ),
    filters.key,
  );
  const mutation = useWorkspaceMutation();
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [assignee, setAssignee] = useState(""),
    [due, setDue] = useState(""),
    [taskProject, setTaskProject] = useState(project),
    [priority, setPriority] = useState<Task["priority"]>("normal"),
    [mode, setMode] = useState<"board" | "list">("board");
  return (
    <HubPage
      eyebrow="DA CONVERSA À ENTREGA"
      title="Próximos passos"
      description="Dê continuidade ao que foi discutido. Tarefas com contexto, responsáveis e uma trilha até a conversa original."
    >
      <HubPanel title="Uma ação de cada vez" label="ADICIONAR AO SEU PLANO">
        <form
          noValidate
          className="hub-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await mutation.execute(
                () =>
                  workspaceApi.createTask({
                    title: title.trim(),
                    description,
                    assignee: assignee.trim() || null,
                    due_date: due || null,
                    project: taskProject,
                    priority,
                  }),
                "Tarefa adicionada.",
              )
            ) {
              setTitle("");
              setDescription("");
              setAssignee("");
              setDue("");
              resource.refresh();
            }
          }}
        >
          <DraftGuard dirty={!!(title || description || assignee || due)} />
          <div className="task-create-row">
            <label className="hub-label">
              Título da tarefa
              <input
                className="field"
                value={title}
                required
                maxLength={512}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Qual é o próximo passo?"
              />
            </label>
            <label className="hub-label">
              Prazo
              <input
                type="date"
                className="field"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <Button
              variant="primary"
              type="submit"
              disabled={mutation.busy || !title.trim()}
            >
              <Icon name="tasks" />
              Adicionar tarefa
            </Button>
          </div>
          <details className="hub-disclosure">
            <summary>Responsável, projeto e detalhes</summary>
            <div className="hub-form-grid mt-4">
              <label className="hub-label">
                Responsável
                <input
                  className="field"
                  value={assignee}
                  maxLength={256}
                  onChange={(e) => setAssignee(e.target.value)}
                  placeholder="Não definido"
                />
              </label>
              <ProjectField
                value={taskProject}
                onChange={setTaskProject}
                label="Projeto da tarefa"
                allLabel="Sem projeto"
              />
              <label className="hub-label">
                Prioridade
                <select
                  className="field"
                  value={priority}
                  onChange={(e) =>
                    setPriority(e.target.value as Task["priority"])
                  }
                >
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="low">Baixa</option>
                </select>
              </label>
              <label className="hub-label">
                Detalhes
                <textarea
                  className="field min-h-24 resize-none"
                  value={description}
                  maxLength={12000}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
            </div>
          </details>
          <MutationFeedback {...mutation} />
        </form>
      </HubPanel>
      <div className="hub-toolbar">
        <QuerySearch
          current={filters.params.get("q") ?? ""}
          commit={(value) => filters.change("q", value)}
          label="Buscar tarefas"
          placeholder="Buscar no plano de ação"
        />
        <div className="hub-segmented" aria-label="Visualização das tarefas">
          <button
            aria-pressed={mode === "board"}
            onClick={() => setMode("board")}
          >
            Quadro
          </button>
          <button
            aria-pressed={mode === "list"}
            onClick={() => setMode("list")}
          >
            Lista
          </button>
        </div>
      </div>
      <div className="hub-filter-row">
        <ProjectField
          value={project}
          onChange={(value) => filters.change("project", value)}
          label="Filtrar projeto"
        />
        <label className="hub-label">
          Filtrar estado
          <select
            className="field"
            value={status}
            onChange={(e) => filters.change("status", e.target.value)}
          >
            <option value="all">Todos os estados</option>
            {Object.entries(statuses).map(([value, label]) => (
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
                title: "Um próximo passo faz a diferença",
                text: "Adicione uma tarefa aqui ou importe ações depois de revisar um documento no editor da reunião.",
              }
            : undefined
        }
      >
        <p className="hub-field-hint">
          {resource.data?.total ?? 0} tarefas encontradas · as colunas mostram
          esta página.
        </p>
        {mode === "board" ? (
          <div
            className={`task-board ${status !== "all" ? "task-board-single" : ""}`}
          >
            {Object.entries(statuses)
              .filter(([value]) => status === "all" || status === value)
              .map(([value, label]) => (
                <section key={value} className={`task-column column-${value}`}>
                  <header>
                    <span className="task-state-dot" />
                    <h2>{label}</h2>
                    <span>
                      {resource.data?.items.filter(
                        (task) => task.status === value,
                      ).length ?? 0}
                    </span>
                  </header>
                  <div className="task-column-body">
                    {resource.data?.items
                      .filter((task) => task.status === value)
                      .map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          refresh={resource.refresh}
                        />
                      ))}
                    {!resource.data?.items.some(
                      (task) => task.status === value,
                    ) && (
                      <p className="task-column-empty">
                        Nenhuma tarefa nesta página.
                      </p>
                    )}
                  </div>
                </section>
              ))}
          </div>
        ) : (
          <div className="task-list">
            {resource.data?.items.map((task) => (
              <TaskCard key={task.id} task={task} refresh={resource.refresh} />
            ))}
          </div>
        )}
        <Pagination
          page={resource.data}
          change={(value) => filters.change("offset", value)}
        />
      </ResourceState>
    </HubPage>
  );
}
