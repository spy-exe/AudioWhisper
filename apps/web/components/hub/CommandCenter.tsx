"use client";
import Link from "next/link";
import { useWorkspaceResource } from "@/hooks/useWorkspaceResource";
import { workspaceApi, localDate, dateLabel } from "@/lib/workspace-api";
import { Icon } from "@/components/ui/Icon";
import { HubPage, HubPanel, ResourceState } from "./HubUI";
import { RecordingList } from "./ProjectsView";

export function CommandCenter() {
  const resource = useWorkspaceResource(
    (signal) => workspaceApi.overview(localDate(), signal),
    "overview",
    10000,
  );
  const data = resource.data;
  return (
    <HubPage
      title="Central"
      description="Gravações recentes e tarefas com prazo."
      action={
        <Link href="/#live-capture-slot" className="hub-primary-link">
          <Icon name="mic" />
          Nova gravação
        </Link>
      }
    >
      <ResourceState {...resource} retry={resource.refresh}>
        <div className="workspace-stats">
          {[
            ["Gravações", data?.recording_count, "library", "/library"],
            ["Projetos", data?.project_count, "projects", "/projects"],
            [
              "Tarefas em aberto",
              (data?.task_counts.open ?? 0) + (data?.task_counts.doing ?? 0),
              "tasks",
              "/tasks",
            ],
            ["Anotações", data?.note_count, "bookmark", "/notebook"],
          ].map(([label, value, icon, href]) => (
            <Link href={String(href)} key={String(label)}>
              <span>
                <Icon name={icon as "library"} />
                {label}
              </span>
              <strong>{value ?? 0}</strong>
              <Icon name="arrow" />
            </Link>
          ))}
        </div>
        <div className="workspace-work-grid">
          <HubPanel title="Gravações recentes">
            {data?.recent.items.length ? (
              <RecordingList page={data.recent} />
            ) : (
              <div className="hub-empty">
                <p>Nenhuma gravação na biblioteca.</p>
                <Link href="/" className="hub-text-link">
                  Gravar ou importar áudio <Icon name="arrow" />
                </Link>
              </div>
            )}
            <Link href="/library" className="hub-text-link mt-4">
              Ver biblioteca <Icon name="arrow" />
            </Link>
          </HubPanel>
          <HubPanel title="Próximos prazos">
            {!!data?.overdue_count && (
              <p className="overdue-notice">
                {data.overdue_count}{" "}
                {data.overdue_count === 1
                  ? "tarefa com prazo vencido"
                  : "tarefas com prazo vencido"}
              </p>
            )}
            <ul className="horizon-list">
              {data?.due_tasks.map((task) => (
                <li key={task.id}>
                  <Link href={`/tasks?task_id=${task.id}`}>
                    <span>
                      {task.title}
                      <small>
                        {task.project || "Sem projeto"} ·{" "}
                        {task.assignee || "Sem responsável"}
                      </small>
                    </span>
                    <time
                      className={
                        task.due_date! < localDate() ? "text-warning" : ""
                      }
                    >
                      {dateLabel(task.due_date)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
            {data?.due_tasks.length === 0 && (
              <p className="text-text-muted">
                Nenhuma tarefa com prazo pendente.
              </p>
            )}
            <Link href="/tasks" className="hub-text-link mt-4">
              Ver tarefas <Icon name="arrow" />
            </Link>
          </HubPanel>
        </div>
        <div
          className="workspace-activity"
          aria-label="Atividade de documentos"
        >
          <span>{data?.draft_count ?? 0} rascunhos para revisar</span>
          {!!((data?.pending_questions ?? 0) + (data?.pending_runs ?? 0)) && (
            <span>
              {(data?.pending_questions ?? 0) + (data?.pending_runs ?? 0)}{" "}
              trabalhos em processamento
            </span>
          )}
        </div>
      </ResourceState>
    </HubPage>
  );
}
