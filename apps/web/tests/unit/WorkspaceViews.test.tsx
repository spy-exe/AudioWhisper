import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectsView } from "@/components/hub/ProjectsView";
import { TasksView } from "@/components/hub/TasksView";
import { EvidenceSearch } from "@/components/hub/EvidenceSearch";
import { KnowledgeView } from "@/components/hub/KnowledgeView";
import { RecipesView } from "@/components/hub/RecipesView";
import { NotebookView, MeetingNotebook } from "@/components/hub/NotebookView";
import { CommandCenter } from "@/components/hub/CommandCenter";
import type {
  Note,
  Question,
  Recipe,
  RecipeRun,
  Task,
} from "@/lib/workspace-api";
import type { TranscriptSegment } from "@/lib/types";
import { workspaceApi } from "@/lib/workspace-api";
import { api } from "@/lib/api";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  usePathname: () => "/workspace",
  useRouter: () => nav,
}));
vi.mock("@/lib/workspace-api", async (original) => {
  const actual = await original<typeof import("@/lib/workspace-api")>();
  return {
    ...actual,
    workspaceApi: Object.fromEntries(
      Object.keys(actual.workspaceApi).map((key) => [key, vi.fn()]),
    ),
  };
});
vi.mock("@/lib/api", () => ({
  api: { intelligence: vi.fn(), library: vi.fn() },
  request: vi.fn(),
}));
const empty = { items: [], total: 0, offset: 0, limit: 20 };
beforeEach(() => {
  vi.clearAllMocks();
  nav.params = new URLSearchParams();
  vi.mocked(workspaceApi.projects).mockResolvedValue(empty);
  vi.mocked(workspaceApi.tasks).mockResolvedValue(empty);
  vi.mocked(workspaceApi.search).mockResolvedValue(empty);
  vi.mocked(workspaceApi.questions).mockResolvedValue(empty);
  vi.mocked(workspaceApi.recipes).mockResolvedValue(empty);
  vi.mocked(workspaceApi.runs).mockResolvedValue(empty);
  vi.mocked(workspaceApi.notes).mockResolvedValue(empty);
  vi.mocked(api.intelligence).mockResolvedValue({
    provider: "ollama",
    available: true,
    models: ["local"],
    error: null,
  });
  vi.mocked(api.library).mockResolvedValue(empty);
});

it("creates a project and keeps the form on server errors", async () => {
  vi.mocked(workspaceApi.createProject).mockRejectedValueOnce(
    new Error("Já existe um projeto"),
  );
  render(<ProjectsView />);
  await screen.findByText("Seu próximo projeto começa aqui");
  fireEvent.change(screen.getByLabelText("Nome do projeto"), {
    target: { value: "Infra" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Criar projeto" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Já existe um projeto",
  );
  expect(screen.getByLabelText("Nome do projeto")).toHaveValue("Infra");
});

it("creates a task with an explicit date without inventing an assignee", async () => {
  render(<TasksView />);
  await screen.findByText("Um próximo passo faz a diferença");
  fireEvent.change(screen.getByLabelText("Título da tarefa"), {
    target: { value: "Revisar alertas" },
  });
  fireEvent.change(screen.getByLabelText("Prazo"), {
    target: { value: "2026-11-20" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Adicionar tarefa" }));
  await waitFor(() =>
    expect(workspaceApi.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Revisar alertas",
        due_date: "2026-11-20",
        assignee: null,
      }),
    ),
  );
});

it("search results point to the exact segment and expose a clear action", async () => {
  nav.params = new URLSearchParams("q=backup");
  vi.mocked(workspaceApi.search).mockResolvedValue({
    ...empty,
    total: 1,
    items: [
      {
        segment_id: "s1",
        job_id: "j1",
        title: "Reunião técnica",
        text: "Revisar backup",
        project: "Infra",
        speaker: "Ana",
        start: 12,
        end: 18,
      },
    ],
  });
  render(<EvidenceSearch />);
  expect(
    await screen.findByRole("link", { name: /Ouvir trecho/ }),
  ).toHaveAttribute("href", "/jobs/j1?segment=s1&t=12");
  fireEvent.click(screen.getByRole("button", { name: "Limpar busca" }));
  expect(screen.getByRole("searchbox")).toHaveValue("");
});

it("submits a local question and preserves the selected model", async () => {
  render(<KnowledgeView />);
  await screen.findByRole("option", { name: "local" });
  fireEvent.change(screen.getByLabelText("Sua pergunta"), {
    target: { value: "O que mudou nos backups?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Consultar gravações" }));
  await waitFor(() =>
    expect(workspaceApi.ask).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "O que mudou nos backups?",
        model: "local",
        job_ids: [],
      }),
    ),
  );
});

it("creates a recipe with automatic generation off by default", async () => {
  render(<RecipesView />);
  await screen.findByRole("option", { name: "local" });
  fireEvent.change(screen.getByLabelText("Nome da receita"), {
    target: { value: "Ata técnica" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Salvar receita" }));
  await waitFor(() =>
    expect(workspaceApi.createRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Ata técnica",
        automatic: false,
        model: "local",
      }),
    ),
  );
});

const source = {
  segment_id: "s1",
  job_id: "j1",
  title: "Reunião técnica",
  start: 12,
  end: 18,
  text: "Revisar alertas",
  speaker: "Ana",
  stale: false,
};
const task = {
  id: "t1",
  title: "Revisar alertas",
  description: "Verificar os backups",
  project: "Infra",
  status: "open",
  priority: "high",
  assignee: null,
  due_date: "2020-01-01",
  due_label: null,
  sources: [source],
  stale: false,
  archived: false,
  revision: 3,
} as Task;

it("changes task state using its current revision and displays conflicts without losing the card", async () => {
  vi.mocked(workspaceApi.tasks).mockResolvedValue({
    ...empty,
    total: 1,
    items: [task],
  });
  vi.mocked(workspaceApi.editTask).mockRejectedValueOnce(
    new Error("Mudou em outra janela"),
  );
  render(<TasksView />);
  const state = await screen.findByRole("combobox", {
    name: "Estado de Revisar alertas",
  });
  fireEvent.change(state, { target: { value: "doing" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("outra janela");
  expect(workspaceApi.editTask).toHaveBeenCalledWith(task, { status: "doing" });
  expect(state).toHaveValue("open");
  fireEvent.click(screen.getByRole("button", { name: "Lista" }));
  expect(
    screen.getByRole("heading", { name: "Revisar alertas" }),
  ).toBeVisible();
});

it("archives and restores tasks through explicit reversible actions", async () => {
  vi.mocked(workspaceApi.tasks).mockResolvedValue({
    ...empty,
    total: 1,
    items: [{ ...task, archived: true }],
  });
  nav.params = new URLSearchParams("archived=true");
  render(<TasksView />);
  fireEvent.click(await screen.findByRole("button", { name: "Restaurar" }));
  await waitFor(() =>
    expect(workspaceApi.editTask).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 3 }),
      { archived: false },
    ),
  );
});

it("binds a notebook chapter to the segment in playback", async () => {
  const segments = [
    { id: "s0", start: 0, end: 10, text: "Início" },
    { id: "s1", start: 12, end: 18, text: "Revisar alertas" },
  ] as TranscriptSegment[];
  render(
    <MeetingNotebook
      jobId="j1"
      segments={segments}
      currentTime={14}
      onSource={vi.fn()}
    />,
  );
  await screen.findByText("Marque seu primeiro momento");
  fireEvent.click(
    screen.getByRole("button", { name: "Usar trecho em reprodução" }),
  );
  fireEvent.change(screen.getByLabelText("Tipo de registro"), {
    target: { value: "chapter" },
  });
  fireEvent.change(screen.getByLabelText("Título do registro"), {
    target: { value: "Alertas de backup" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Salvar no caderno" }));
  await waitFor(() =>
    expect(workspaceApi.createNote).toHaveBeenCalledWith("j1", {
      segment_id: "s1",
      title: "Alertas de backup",
      body: "",
      kind: "chapter",
    }),
  );
});

it("shows stale notebook evidence and saves edits with revision protection", async () => {
  const note = {
    id: "n1",
    job_id: "j1",
    title: "Capítulo técnico",
    body: "Contexto",
    kind: "chapter",
    project: "Infra",
    archived: false,
    revision: 2,
    sources: [{ ...source, stale: true }],
    stale: true,
  } as Note;
  vi.mocked(workspaceApi.notes).mockResolvedValue({
    ...empty,
    total: 1,
    items: [note],
  });
  render(<NotebookView />);
  await screen.findByText("Capítulo técnico");
  fireEvent.click(screen.getByText("Editar anotação"));
  fireEvent.change(screen.getByLabelText("Anotação"), {
    target: { value: "Contexto atualizado" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Salvar nota" }));
  await waitFor(() =>
    expect(workspaceApi.editNote).toHaveBeenCalledWith(note, {
      title: note.title,
      body: "Contexto atualizado",
      kind: "chapter",
    }),
  );
  expect(screen.getByText(/fonte alterada/)).toBeInTheDocument();
});

it("distinguishes no evidence from a failed question and exposes retry", async () => {
  vi.mocked(workspaceApi.questions).mockResolvedValue({
    ...empty,
    total: 2,
    items: [
      {
        id: "q1",
        question: "Ornitorrincos?",
        project: "",
        status: "completed",
        items: [],
        sources: [],
        retrieval_count: 0,
        model: "local",
        job_ids: [],
        error: null,
        stale: false,
        created_at: "2026-10-21T12:00:00Z",
      },
      {
        id: "q2",
        question: "Backups?",
        project: "",
        status: "failed",
        items: [],
        sources: [],
        retrieval_count: 1,
        model: "local",
        job_ids: [],
        error: "Ollama indisponível",
        stale: false,
        created_at: "2026-10-21T12:00:00Z",
      },
    ] as Question[],
  });
  render(<KnowledgeView />);
  expect(
    await screen.findByText(/Informação não encontrada nos trechos/),
  ).toBeVisible();
  expect(screen.getByText("Ollama indisponível")).toBeVisible();
  expect(screen.getByRole("button", { name: "Copiar resposta" })).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Tentar consulta novamente" }),
  );
  await waitFor(() =>
    expect(workspaceApi.retryQuestion).toHaveBeenCalledWith("q2"),
  );
});

it("runs an enabled recipe for a chosen recording and retries a failed execution", async () => {
  const recipe = {
    id: "r1",
    name: "Ata técnica",
    project: "",
    kind: "minutes",
    model: "local",
    instruction: "Destaque riscos",
    automatic: false,
    enabled: true,
    revision: 1,
  } as Recipe;
  vi.mocked(workspaceApi.recipes).mockResolvedValue({
    ...empty,
    total: 1,
    items: [recipe],
  });
  vi.mocked(workspaceApi.runs).mockResolvedValue({
    ...empty,
    total: 1,
    items: [
      {
        id: "run1",
        name: "Execução anterior",
        status: "failed",
        error: "Interrompida",
        created_at: "2026-10-21T12:00:00Z",
      },
    ] as RecipeRun[],
  });
  vi.mocked(api.library).mockResolvedValue({
    ...empty,
    total: 1,
    items: [
      {
        title: "Reunião técnica",
        name: "meeting.wav",
        job: { id: "j1" },
        project: "",
      },
    ],
  } as never);
  render(<RecipesView />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Escolher gravação para executar",
    }),
  );
  fireEvent.click(
    await screen.findByRole("radio", { name: /Reunião técnica/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Preparar documento" }));
  await waitFor(() =>
    expect(workspaceApi.runRecipe).toHaveBeenCalledWith("r1", "j1"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Repetir execução" }));
  await waitFor(() =>
    expect(workspaceApi.retryRun).toHaveBeenCalledWith("run1"),
  );
});

it("shows actual overview counts and never inserts demo recordings", async () => {
  vi.mocked(workspaceApi.overview).mockResolvedValue({
    recording_count: 7,
    duration_seconds: 120,
    project_count: 2,
    task_counts: { open: 2, doing: 1, done: 4 },
    overdue_count: 1,
    note_count: 5,
    draft_count: 2,
    pending_questions: 0,
    pending_runs: 1,
    recent: empty,
    due_tasks: [task],
  });
  render(<CommandCenter />);
  expect(await screen.findByText("7")).toBeVisible();
  expect(screen.getByText("2 rascunhos para revisar")).toBeVisible();
  expect(screen.getByRole("link", { name: /Revisar alertas/ })).toHaveAttribute(
    "href",
    "/tasks?task_id=t1",
  );
});

it("connects each answer item to its own source and flags changed evidence", async () => {
  const question: Question = {
    id: "q-source",
    question: "O que mudou?",
    project: "Infra",
    job_ids: ["j1"],
    model: "local",
    status: "completed",
    items: [
      {
        kind: "summary",
        text: "Revisão dos alertas",
        source_segment_ids: ["s1"],
        evidence_quotes: [source.text],
        assignee: null,
        due_date: null,
      },
    ],
    sources: [{ ...source, stale: true }],
    stale: true,
    retrieval_count: 1,
    error: null,
    created_at: "2026-10-21T12:00:00Z",
  };
  vi.mocked(workspaceApi.questions).mockResolvedValue({
    ...empty,
    total: 1,
    items: [question],
  });
  render(<KnowledgeView />);
  expect(
    await screen.findByRole("link", { name: "Fonte 1 · 00:12 · alterada" }),
  ).toHaveAttribute("href", "/jobs/j1?segment=s1&t=12");
  expect(screen.getByText(/Uma fonte foi alterada/)).toBeVisible();
});
