import { afterEach, expect, it, vi } from "vitest";
import {
  workspaceApi,
  sourceUrl,
  localDate,
  dateLabel,
  type Task,
  type Note,
  type Recipe,
} from "@/lib/workspace-api";

afterEach(() => vi.unstubAllGlobals());
function transport() {
  const fetcher = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [], total: 0 }),
    });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

it("encodes project names, preserves filters and forwards cancellation to read endpoints", async () => {
  const fetcher = transport(),
    controller = new AbortController();
  await workspaceApi.project("Infra / São Paulo", 12, controller.signal);
  expect(fetcher).toHaveBeenLastCalledWith(
    "/api/projects/Infra%20%2F%20S%C3%A3o%20Paulo?offset=12",
    expect.objectContaining({ signal: controller.signal }),
  );
  await workspaceApi.search(
    { q: "backup_100%", project: "Infra", offset: 20 },
    controller.signal,
  );
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe(
    "/api/search?q=backup_100%25&project=Infra&offset=20",
  );
  for (const load of [
    workspaceApi.projects,
    workspaceApi.tasks,
    workspaceApi.notes,
    workspaceApi.questions,
    workspaceApi.recipes,
    workspaceApi.runs,
  ])
    await load({ project: "Infra", offset: 12 }, controller.signal);
  await workspaceApi.overview("2026-10-21", controller.signal);
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe(
    "/api/workspace?today=2026-10-21",
  );
});

it("sends explicit nullable deadlines and revisions without altering task objects", async () => {
  const fetcher = transport();
  const task = { id: "t1", revision: 7 } as Task;
  await workspaceApi.createTask({
    title: "Revisar",
    description: "",
    assignee: null,
    due_date: null,
    project: "",
    priority: "normal",
  });
  expect(JSON.parse(fetcher.mock.calls.at(-1)?.[1].body)).toMatchObject({
    assignee: null,
    due_date: null,
  });
  await workspaceApi.editTask(task, { due_date: null, status: "done" });
  expect(JSON.parse(fetcher.mock.calls.at(-1)?.[1].body)).toEqual({
    due_date: null,
    status: "done",
    revision: 7,
  });
  expect(task.revision).toBe(7);
  await workspaceApi.importActions("d1");
  expect(JSON.parse(fetcher.mock.calls.at(-1)?.[1].body)).toEqual({
    document_id: "d1",
  });
});

it("creates source-linked records and keeps model selection and retry IDs in their own contracts", async () => {
  const fetcher = transport();
  await workspaceApi.createNote("j1", {
    segment_id: "s1",
    title: "Capítulo",
    body: "Contexto",
    kind: "chapter",
  });
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe("/api/jobs/j1/notes");
  await workspaceApi.editNote({ id: "n1", revision: 2 } as Note, {
    archived: true,
  });
  expect(JSON.parse(fetcher.mock.calls.at(-1)?.[1].body)).toEqual({
    archived: true,
    revision: 2,
  });
  await workspaceApi.ask({
    question: "Backup?",
    project: "Infra",
    job_ids: ["j1", "j2"],
    model: "local",
  });
  expect(JSON.parse(fetcher.mock.calls.at(-1)?.[1].body).job_ids).toEqual([
    "j1",
    "j2",
  ]);
  await workspaceApi.retryQuestion("q1");
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe("/api/knowledge/q1/retry");
  await workspaceApi.createRecipe({
    name: "Ata",
    project: "",
    kind: "minutes",
    model: "local",
    instruction: "",
    automatic: false,
  });
  await workspaceApi.editRecipe({ id: "r1", revision: 3 } as Recipe, {
    enabled: false,
  });
  expect(JSON.parse(fetcher.mock.calls.at(-1)?.[1].body)).toEqual({
    enabled: false,
    revision: 3,
  });
  await workspaceApi.runRecipe("r1", "j1");
  expect(JSON.parse(fetcher.mock.calls.at(-1)?.[1].body)).toEqual({
    job_id: "j1",
  });
  await workspaceApi.retryRun("run1");
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe("/api/recipe-runs/run1/retry");
  await workspaceApi.createProject({
    name: "Infra",
    color: "amber",
    description: "",
  });
  await workspaceApi.editProject("Infra / Sul", {
    color: "blue",
    description: "Contexto",
  });
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe(
    "/api/projects/Infra%20%2F%20Sul",
  );
});

it("propagates conflicts so forms can preserve unsaved edits", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            code: "CONFLICT",
            message: "Atualize a tarefa",
            details: {},
            request_id: null,
          },
        }),
      }),
  );
  await expect(
    workspaceApi.editTask({ id: "t1", revision: 1 } as Task, {
      title: "Nova edição",
    }),
  ).rejects.toMatchObject({ status: 409, message: "Atualize a tarefa" });
});

it("builds evidence URLs from IDs and formats date-only deadlines in local calendar days", () => {
  expect(sourceUrl({ job_id: "j 1", segment_id: "s/1", start: 12.5 })).toBe(
    "/jobs/j%201?segment=s%2F1&t=12.5",
  );
  expect(localDate(new Date(2026, 9, 21, 1))).toBe("2026-10-21");
  expect(dateLabel(null)).toBe("Sem prazo");
  expect(dateLabel("2026-10-21")).toContain("21");
});
