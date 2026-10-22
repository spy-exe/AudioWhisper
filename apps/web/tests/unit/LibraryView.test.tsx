import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LibraryView } from "@/components/jobs/LibraryView";
import { api } from "@/lib/api";
import type { LibraryPage } from "@/lib/types";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.params, usePathname: () => "/library", useRouter: () => nav }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: { library: vi.fn(), libraryFacets: vi.fn(), bulk: vi.fn() },
}));
const empty: LibraryPage = { items: [], total: 0, offset: 0, limit: 20 };
beforeEach(() => {
  nav.params = new URLSearchParams();
  vi.clearAllMocks();
  vi.mocked(api.library).mockResolvedValue(empty);
  vi.mocked(api.libraryFacets).mockResolvedValue({ folders: [{ value: "Reuniões", count: 3 }], projects: [], tags: [{ value: "q4", count: 1 }] });
});
afterEach(() => vi.useRealTimers());

it("distinguishes a failed request from an empty library and recovers with retry", async () => {
  vi.mocked(api.library).mockRejectedValueOnce(new Error("offline"));
  render(<LibraryView />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Verifique a conexão");
  expect(screen.queryByText("Sua biblioteca começa com uma conversa")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  expect(await screen.findByText("Sua biblioteca começa com uma conversa")).toBeVisible();
});

it("debounces search, respects composition and clears immediately with focus restoration", async () => {
  vi.useFakeTimers();
  await act(async () => { render(<LibraryView />); });
  const search = screen.getByRole("searchbox");
  fireEvent.compositionStart(search);
  fireEvent.change(search, { target: { value: "backup" } });
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(nav.replace).not.toHaveBeenCalled();
  fireEvent.compositionEnd(search);
  await act(async () => { vi.advanceTimersByTime(299); });
  expect(nav.replace).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(nav.replace).toHaveBeenLastCalledWith("/library?q=backup", { scroll: false });
  fireEvent.click(screen.getByRole("button", { name: "Limpar busca" }));
  expect(nav.replace).toHaveBeenLastCalledWith("/library?", { scroll: false });
  expect(search).toHaveFocus();
  expect(search).toHaveValue("");
});

it("aborts superseded requests so a late response cannot overwrite current results", async () => {
  let resolve!: (page: LibraryPage) => void;
  vi.mocked(api.library).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(<LibraryView />);
  const signal = vi.mocked(api.library).mock.calls[0]![1]!;
  nav.params = new URLSearchParams("q=novo");
  view.rerender(<LibraryView />);
  expect(signal.aborted).toBe(true);
  await screen.findByText("Nenhuma gravação encontrada");
  await act(async () => resolve({ ...empty, total: 99 }));
  expect(screen.getByText("0 gravações")).toBeVisible();
});

it("resets pagination when changing filters and preserves it for page navigation", async () => {
  nav.params = new URLSearchParams("q=backup&offset=20");
  vi.mocked(api.library).mockResolvedValue({ ...empty, total: 60, offset: 20 });
  render(<LibraryView />);
  await screen.findByText("60 gravações · 21–40");
  fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
  expect(nav.replace).toHaveBeenLastCalledWith("/library?q=backup&offset=40", { scroll: false });
  fireEvent.change(screen.getByRole("combobox", { name: "Filtrar por status" }), { target: { value: "completed" } });
  expect(nav.replace).toHaveBeenLastCalledWith("/library?q=backup&status=completed", { scroll: false });
});

const job = (id: string) => ({ id, media_file_id: "m", status: "completed", cancel_requested: false, progress: 1, current_stage: null, model_name: "turbo",
  language_requested: null, language_detected: "pt", compute_type: "int8", device: "cpu", started_at: null, completed_at: null, failed_at: null,
  error_code: null, error_message: null, processing_seconds: null, real_time_factor: null, created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z" } as LibraryPage["items"][number]["job"]);
const item = (id: string, extra: Partial<LibraryPage["items"][number]> = {}): LibraryPage["items"][number] => ({
  job: job(id), name: `${id}.wav`, duration_seconds: 120, media_type: "audio", title: "", folder: "", project: "", tags: [], speakers: {},
  diarization_status: "idle", diarization_error: null, ...extra,
});

it("shows matching moments with links to the exact time, tags and the model", async () => {
  nav.params = new URLSearchParams("q=orcamento");
  vi.mocked(api.library).mockResolvedValue({ ...empty, total: 1, items: [item("j1", {
    title: "Comitê", tags: ["q4", "financeiro"], match_count: 4,
    matches: [{ segment_id: "s1", start: 75.6, speaker_id: null, before: "aprovar o ", match: "orçamento", after: " até sexta" }],
  })] });
  render(<LibraryView />);
  const link = await screen.findByRole("link", { name: /01:15\s*aprovar o orçamento até sexta/ });
  expect(link).toHaveAttribute("href", "/jobs/j1?t=75");
  expect(within(link).getByText("orçamento").tagName).toBe("MARK");
  expect(screen.getByText("+3 trechos nesta gravação")).toBeVisible();
  expect(screen.getByText("financeiro")).toBeVisible();
  expect(screen.getByText(/· turbo/)).toBeVisible();
  expect(screen.getByRole("link", { name: /Buscar cada momento/ })).toHaveAttribute("href", "/search?q=orcamento");
});

it("offers existing folders and tags as suggestions and sorts through the URL", async () => {
  render(<LibraryView />);
  await waitFor(() => expect(document.querySelector("#library-folder-options option")).toHaveAttribute("value", "Reuniões"));
  expect(screen.getByRole("combobox", { name: "Filtrar por pasta" })).toHaveAttribute("list", "library-folder-options");
  fireEvent.change(screen.getByRole("combobox", { name: "Ordenar biblioteca" }), { target: { value: "duration" } });
  expect(nav.replace).toHaveBeenLastCalledWith("/library?sort=duration", { scroll: false });
});

it("keeps filters usable when suggestions cannot be loaded", async () => {
  vi.mocked(api.libraryFacets).mockRejectedValue(new Error("offline"));
  render(<LibraryView />);
  expect(await screen.findByText("Sua biblioteca começa com uma conversa")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("moves a selection to a folder and deletes after confirmation, reporting kept items", async () => {
  vi.mocked(api.library).mockResolvedValue({ ...empty, total: 2, items: [item("j1"), item("j2", { title: "Em curso" })] });
  vi.mocked(api.bulk)
    .mockResolvedValueOnce({ action: "organize", done: ["j1", "j2"], skipped: [] })
    .mockResolvedValueOnce({ action: "delete", done: ["j1"], skipped: [{ job_id: "j2", reason: "Cancele o processamento antes de excluir esta gravação." }] });
  render(<LibraryView />);
  await screen.findByText("Em curso");
  fireEvent.click(screen.getByRole("button", { name: "Selecionar gravações" }));
  fireEvent.click(screen.getByRole("button", { name: "Selecionar página" }));
  expect(screen.getByText("2 selecionadas")).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "Mover seleção para a pasta" }), { target: { value: " Diretoria " } });
  fireEvent.click(screen.getByRole("button", { name: "Mover" }));
  await waitFor(() => expect(api.bulk).toHaveBeenCalledWith({ action: "organize", job_ids: ["j1", "j2"], folder: "Diretoria" }));
  expect(await screen.findByText("2 gravações atualizadas.")).toBeVisible();

  fireEvent.click(await screen.findByRole("checkbox", { name: "Selecionar j1.wav" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar Em curso" }));
  fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
  const dialog = screen.getByRole("alertdialog", { name: "Excluir 2 gravações?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Excluir selecionadas" }));
  expect(await screen.findByText(/1 excluída\(s\); 1 mantida\(s\): Cancele o processamento/)).toBeVisible();
});

it("explains a failed bulk change", async () => {
  vi.mocked(api.library).mockResolvedValue({ ...empty, total: 1, items: [item("j1")] });
  vi.mocked(api.bulk).mockRejectedValue(new Error("offline"));
  render(<LibraryView />);
  await screen.findByText("j1.wav");
  fireEvent.click(screen.getByRole("button", { name: "Selecionar gravações" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar j1.wav" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Adicionar tag à seleção" }), { target: { value: "revisar" } });
  fireEvent.click(screen.getByRole("button", { name: "Adicionar tag" }));
  expect(await screen.findByText("Não foi possível atualizar as gravações.")).toBeVisible();
});
