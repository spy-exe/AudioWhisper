"use client";
import Link from "next/link";
import { useWorkspaceResource } from "@/hooks/useWorkspaceResource";
import { workspaceApi, localDate, dateLabel } from "@/lib/workspace-api";
import { formatDuration } from "@/lib/format";
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
      eyebrow="DO PRIMEIRO SEGUNDO AO PRÓXIMO PASSO"
      title="Seu trabalho, em sintonia."
      description="Conversas que viram memória. Memória que vira ação. Este é o ponto de encontro do seu AudioWhisper."
      action={
        <Link href="/#live-capture-slot" className="hub-primary-link">
          <Icon name="mic" />
          Nova gravação <Icon name="arrow" />
        </Link>
      }
    >
      <div className="workspace-feature">
        <div>
          <span className="hub-kicker">UM WORKSPACE QUE ESCUTA</span>
          <h2>
            A próxima ideia já está
            <br className="hidden sm:block" /> em alguma conversa.
          </h2>
          <p>Encontre uma fala, conecte reuniões e continue de onde parou.</p>
          <Link href="/knowledge" className="hub-text-link">
            Perguntar às minhas gravações <Icon name="arrow" />
          </Link>
        </div>
        <div className="workspace-wave" aria-hidden="true">
          <svg viewBox="0 0 500 210" fill="none">
            <defs>
              <linearGradient id="workspace-signal">
                <stop stopColor="#ffbd87" />
                <stop offset=".48" stopColor="#c4b5fd" />
                <stop offset="1" stopColor="#89e3cd" />
              </linearGradient>
            </defs>
            {Array.from({ length: 11 }, (_, i) => (
              <path
                key={i}
                d={`M0 ${90 + i * 3} C80 ${20 + i * 5} 110 ${185 - i * 7} 180 ${80 + i * 5} S260 ${25 + i * 4} 300 ${85 + i * 5} S410 ${185 - i * 3} 500 ${70 + i * 5}`}
                stroke="url(#workspace-signal)"
                opacity={0.2 + i * 0.06}
              />
            ))}
          </svg>
          <div className="wave-caption">
            <span>ÁUDIO</span>
            <i />
            <span>CONTEXTO</span>
            <i />
            <span>AÇÃO</span>
          </div>
        </div>
      </div>
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
            ["No caderno", data?.note_count, "bookmark", "/notebook"],
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
          <HubPanel title="Continue a conversa" label="GRAVAÇÕES RECENTES">
            {data?.recent.items.length ? (
              <RecordingList page={data.recent} />
            ) : (
              <div className="hub-empty">
                <p>Sua biblioteca começa na próxima conversa.</p>
                <Link href="/" className="hub-text-link">
                  Gravar ou importar áudio →
                </Link>
              </div>
            )}
            <Link href="/library" className="hub-text-link mt-4">
              Explorar biblioteca <Icon name="arrow" />
            </Link>
          </HubPanel>
          <HubPanel title="No seu horizonte" label="PRAZOS E CONTINUIDADE">
            <div className="horizon-summary">
              <strong>{data?.overdue_count ?? 0}</strong>
              <span>
                {data?.overdue_count === 1
                  ? "tarefa com prazo vencido"
                  : "tarefas com prazo vencido"}
              </span>
            </div>
            <ul className="horizon-list">
              {data?.due_tasks.map((task) => (
                <li key={task.id}>
                  <Link href={`/tasks?task_id=${task.id}`}>
                    <span>
                      {task.title}
                      <small>
                        {task.project || "Pessoal"} ·{" "}
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
                Nenhum prazo pendente. Adicione datas às tarefas para
                acompanhá-las aqui.
              </p>
            )}
            <Link href="/tasks" className="hub-text-link mt-4">
              Abrir plano de ação <Icon name="arrow" />
            </Link>
          </HubPanel>
        </div>
        <div className="workspace-bottom">
          <HubPanel title="Seu acervo em movimento">
            <div className="workspace-acervo">
              <strong>{formatDuration(data?.duration_seconds ?? 0)}</strong>
              <p>de áudio no seu acervo local</p>
              <div>
                <span>{data?.draft_count ?? 0} rascunhos para revisar</span>
                <span>{data?.task_counts.done ?? 0} tarefas concluídas</span>
                <span>
                  {(data?.pending_questions ?? 0) + (data?.pending_runs ?? 0)}{" "}
                  consultas e receitas em processamento
                </span>
              </div>
            </div>
          </HubPanel>
          <HubPanel title="Escolha o seu próximo movimento">
            <nav
              className="workspace-tools"
              aria-label="Ferramentas do workspace"
            >
              {[
                [
                  "/search",
                  "search",
                  "Encontre uma fala",
                  "Busca por texto, projeto e falante",
                ],
                [
                  "/knowledge",
                  "sparkle",
                  "Conecte reuniões",
                  "Perguntas com fontes navegáveis",
                ],
                [
                  "/recipes",
                  "workflow",
                  "Prepare sua rotina",
                  "Documentos com suas instruções",
                ],
              ].map(([href, icon, title, text]) => (
                <Link key={href} href={href!}>
                  <Icon name={icon as "search"} />
                  <span>
                    <strong>{title}</strong>
                    <small>{text}</small>
                  </span>
                  <Icon name="arrow" />
                </Link>
              ))}
            </nav>
          </HubPanel>
        </div>
      </ResourceState>
    </HubPage>
  );
}
