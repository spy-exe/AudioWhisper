import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AIWorkspace } from "@/components/workspace/AIWorkspace";
import { api } from "@/lib/api";
import type { AIDocument, TranscriptSegment } from "@/lib/types";

vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: { ai_model: "local" } }),
}));
vi.mock("@/lib/api", () => ({
  api: { intelligence: vi.fn(), documents: vi.fn(), generateDocument: vi.fn() },
}));
const segment: TranscriptSegment = {
  id: "s1",
  job_id: "j1",
  segment_index: 0,
  start: 0,
  end: 2,
  text: "Revisar backups",
  confidence: null,
  words: [],
  edited: false,
  updated_at: "2026-10-21T12:00:00Z",
};
const queued: AIDocument = {
  id: "d1",
  job_id: "j1",
  kind: "custom",
  model: "local",
  status: "queued",
  markdown: "",
  items: [],
  stale: false,
  reviewed_at: null,
  error: null,
  created_at: "2026-10-21T12:00:00Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.intelligence).mockResolvedValue({
    available: true,
    models: ["local"],
    provider: "ollama",
    error: null,
  });
  vi.mocked(api.documents).mockResolvedValue([]);
});
function open(beforeGenerate = vi.fn().mockResolvedValue(true)) {
  render(
    <AIWorkspace
      jobId="j1"
      segments={[segment]}
      onSource={vi.fn()}
      beforeGenerate={beforeGenerate}
    />,
  );
  return beforeGenerate;
}

it("shows the unavailable provider state and can recheck the local connection", async () => {
  vi.mocked(api.intelligence).mockResolvedValueOnce({
    available: false,
    models: [],
    provider: "ollama",
    error: "Ollama indisponível",
  });
  open();
  expect(await screen.findByText("Ollama indisponível")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Gerar documento" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Verificar conexão" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Gerar documento" }),
    ).toBeEnabled(),
  );
});

it("saves transcript edits before queuing a custom analysis and prevents duplicate generation", async () => {
  vi.mocked(api.generateDocument).mockResolvedValue(queued);
  vi.mocked(api.documents)
    .mockResolvedValueOnce([])
    .mockResolvedValue([queued]);
  const beforeGenerate = open();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Gerar documento" }),
    ).toBeEnabled(),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Documento" }), {
    target: { value: "custom" },
  });
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Quais riscos foram discutidos?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Gerar documento" }));
  expect(await screen.findByText(/Na fila de processamento/)).toBeVisible();
  expect(beforeGenerate).toHaveBeenCalledOnce();
  expect(api.generateDocument).toHaveBeenCalledWith(
    "j1",
    "custom",
    "local",
    "Quais riscos foram discutidos?",
  );
  expect(
    screen.getByRole("button", { name: "Gerando documento local…" }),
  ).toBeDisabled();
});

it("does not generate from transcript edits that failed to save", async () => {
  open(vi.fn().mockResolvedValue(false));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Gerar documento" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Gerar documento" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Salve as alterações",
  );
  expect(api.generateDocument).not.toHaveBeenCalled();
});

it("presents generation failures without an endless loading state", async () => {
  vi.mocked(api.documents).mockResolvedValue([
    {
      ...queued,
      status: "failed",
      error: "As fontes não puderam ser verificadas",
    },
  ]);
  open();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "As fontes não puderam ser verificadas",
  );
  expect(
    screen.queryByRole("status", { name: "Carregando documentos" }),
  ).not.toBeInTheDocument();
});
