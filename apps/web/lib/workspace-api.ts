import { request } from "./api";
import type { EvidenceItem, LibraryPage } from "./types";

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}
export interface Project {
  name: string;
  description: string;
  color: "blue" | "amber" | "violet" | "green";
  recording_count: number;
  duration_seconds: number;
  last_activity: string | null;
}
export interface ProjectDetail extends Project {
  participants: string[];
  recordings: LibraryPage;
}
export interface Source {
  segment_id: string;
  job_id: string;
  title: string;
  text: string;
  start: number;
  end: number;
  speaker: string;
  stale: boolean;
}
export interface Sourced {
  sources: Source[];
  stale: boolean;
}
export type TaskStatus = "open" | "doing" | "done";
export interface Task extends Sourced {
  id: string;
  title: string;
  description: string;
  project: string;
  status: TaskStatus;
  priority: "low" | "normal" | "high";
  assignee: string | null;
  due_date: string | null;
  due_label: string | null;
  job_id: string | null;
  document_id: string | null;
  archived: boolean;
  revision: number;
  created_at: string;
  updated_at: string;
}
export interface Note extends Sourced {
  id: string;
  job_id: string;
  title: string;
  body: string;
  kind: "note" | "bookmark" | "chapter";
  project: string;
  archived: boolean;
  revision: number;
  created_at: string;
}
export interface SearchHit {
  segment_id: string;
  job_id: string;
  title: string;
  text: string;
  project: string;
  speaker: string;
  start: number;
  end: number;
}
export interface Question extends Sourced {
  id: string;
  question: string;
  project: string;
  job_ids: string[];
  model: string;
  status: "queued" | "generating" | "completed" | "failed";
  items: EvidenceItem[];
  retrieval_count: number;
  error: string | null;
  created_at: string;
}
export interface Recipe {
  id: string;
  name: string;
  project: string;
  kind: string;
  model: string;
  instruction: string;
  automatic: boolean;
  enabled: boolean;
  revision: number;
}
export interface RecipeRun {
  id: string;
  recipe_id: string;
  job_id: string;
  document_id: string | null;
  name: string;
  status: "queued" | "running" | "completed" | "failed";
  error: string | null;
  created_at: string;
}
export interface Overview {
  recording_count: number;
  duration_seconds: number;
  project_count: number;
  task_counts: Record<TaskStatus, number>;
  overdue_count: number;
  note_count: number;
  draft_count: number;
  pending_questions: number;
  pending_runs: number;
  recent: LibraryPage;
  due_tasks: Task[];
}

type Params = Record<string, string | number | boolean | undefined>;
function query(params: Params = {}) {
  return new URLSearchParams(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [key, String(value)]),
  ).toString();
}
const get = <T>(path: string, params?: Params, signal?: AbortSignal) =>
  request<T>(`${path}?${query(params)}`, { signal });
const send = <T>(path: string, method: string, body: unknown) =>
  request<T>(path, { method, body: JSON.stringify(body) });
export const workspaceApi = {
  projects: (params?: Params, signal?: AbortSignal) =>
    get<Page<Project>>("/api/projects", params, signal),
  project: (name: string, offset = 0, signal?: AbortSignal) =>
    get<ProjectDetail>(
      `/api/projects/${encodeURIComponent(name)}`,
      { offset },
      signal,
    ),
  createProject: (body: {
    name: string;
    description: string;
    color: Project["color"];
  }) => send<Project>("/api/projects", "POST", body),
  editProject: (
    name: string,
    body: { description: string; color: Project["color"] },
  ) => send<Project>(`/api/projects/${encodeURIComponent(name)}`, "PUT", body),
  search: (params?: Params, signal?: AbortSignal) =>
    get<Page<SearchHit>>("/api/search", params, signal),
  tasks: (params?: Params, signal?: AbortSignal) =>
    get<Page<Task>>("/api/tasks", params, signal),
  createTask: (body: {
    title: string;
    description: string;
    project: string;
    assignee: string | null;
    due_date: string | null;
    priority: Task["priority"];
  }) => send<Task>("/api/tasks", "POST", body),
  editTask: (
    task: Task,
    body: Partial<
      Pick<
        Task,
        | "title"
        | "description"
        | "project"
        | "assignee"
        | "due_date"
        | "priority"
        | "status"
        | "archived"
      >
    >,
  ) =>
    send<Task>(`/api/tasks/${task.id}`, "PATCH", {
      ...body,
      revision: task.revision,
    }),
  importActions: (id: string) =>
    send<{ imported: number; items: Task[] }>("/api/tasks/import", "POST", {
      document_id: id,
    }),
  notes: (params?: Params, signal?: AbortSignal) =>
    get<Page<Note>>("/api/notebook", params, signal),
  createNote: (
    job: string,
    body: {
      segment_id: string;
      title: string;
      body: string;
      kind: Note["kind"];
    },
  ) => send<Note>(`/api/jobs/${job}/notes`, "POST", body),
  editNote: (
    note: Note,
    body: Partial<Pick<Note, "title" | "body" | "kind" | "archived">>,
  ) =>
    send<Note>(`/api/notebook/${note.id}`, "PATCH", {
      ...body,
      revision: note.revision,
    }),
  questions: (params?: Params, signal?: AbortSignal) =>
    get<Page<Question>>("/api/knowledge", params, signal),
  ask: (body: {
    question: string;
    project: string;
    job_ids: string[];
    model: string;
  }) => send<Question>("/api/knowledge", "POST", body),
  retryQuestion: (id: string) =>
    send<Question>(`/api/knowledge/${id}/retry`, "POST", {}),
  recipes: (params?: Params, signal?: AbortSignal) =>
    get<Page<Recipe>>("/api/recipes", params, signal),
  createRecipe: (body: Omit<Recipe, "id" | "revision" | "enabled">) =>
    send<Recipe>("/api/recipes", "POST", body),
  editRecipe: (
    recipe: Recipe,
    body: Partial<
      Pick<Recipe, "name" | "instruction" | "enabled" | "automatic">
    >,
  ) =>
    send<Recipe>(`/api/recipes/${recipe.id}`, "PATCH", {
      ...body,
      revision: recipe.revision,
    }),
  runRecipe: (id: string, job_id: string) =>
    send<RecipeRun>(`/api/recipes/${id}/run`, "POST", { job_id }),
  runs: (params?: Params, signal?: AbortSignal) =>
    get<Page<RecipeRun>>("/api/recipe-runs", params, signal),
  retryRun: (id: string) =>
    send<RecipeRun>(`/api/recipe-runs/${id}/retry`, "POST", {}),
  overview: (today: string, signal?: AbortSignal) =>
    get<Overview>("/api/workspace", { today }, signal),
};

export function sourceUrl(
  source: Pick<Source, "job_id" | "segment_id" | "start">,
) {
  return `/jobs/${encodeURIComponent(source.job_id)}?segment=${encodeURIComponent(source.segment_id)}&t=${source.start}`;
}
export function localDate(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
export function dateLabel(value: string | null) {
  return value
    ? new Date(value + "T12:00:00").toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "Sem prazo";
}
