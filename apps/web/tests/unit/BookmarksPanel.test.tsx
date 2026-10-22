import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { BookmarksPanel } from "@/components/editor/BookmarksPanel";
import { api, ApiError } from "@/lib/api";
import type { Bookmark } from "@/lib/types";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: { createBookmark: vi.fn(), updateBookmark: vi.fn(), deleteBookmark: vi.fn() },
}));

const mark = (id: string, start: number, label: string, extra: Partial<Bookmark> = {}): Bookmark => ({
  id, job_id: "j1", segment_id: null, start, label, note: "", color: "amber", created_at: "", updated_at: "", ...extra,
});

function Harness({ initial = [] as Bookmark[], onSeek = vi.fn() }) {
  const [bookmarks, setBookmarks] = useState(initial);
  return <BookmarksPanel jobId="j1" bookmarks={bookmarks} currentTime={75} currentSegmentId="s9" onChange={setBookmarks} onSeek={onSeek} />;
}

beforeEach(() => vi.clearAllMocks());

it("adds a bookmark at the current moment with the chosen color", async () => {
  vi.mocked(api.createBookmark).mockImplementation(async (_job, values) => mark("b1", values.start, values.label, { color: values.color }));
  render(<Harness />);
  expect(screen.getByText(/Use M durante a reprodução/)).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "Violeta" }));
  fireEvent.change(screen.getByRole("textbox", { name: /Marcar 01:15/ }), { target: { value: "Decisão" } });
  fireEvent.click(screen.getByRole("button", { name: "Adicionar marcador" }));
  await waitFor(() => expect(api.createBookmark).toHaveBeenCalledWith("j1", { start: 75, label: "Decisão", color: "violet", segment_id: "s9" }));
  expect(await screen.findByRole("button", { name: "Ir para Decisão em 01:15" })).toBeVisible();
  expect(screen.getByText("1 marcador")).toBeVisible();
});

it("names unnamed bookmarks by their moment", async () => {
  vi.mocked(api.createBookmark).mockImplementation(async (_job, values) => mark("b1", values.start, values.label));
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Adicionar marcador" }));
  await waitFor(() => expect(vi.mocked(api.createBookmark).mock.calls[0]![1].label).toBe("Momento em 01:15"));
});

it("lists bookmarks in time order, seeks, edits notes and deletes", async () => {
  const onSeek = vi.fn();
  vi.mocked(api.updateBookmark).mockImplementation(async (id, values) => mark(id, 30, values.label!, { note: values.note }));
  vi.mocked(api.deleteBookmark).mockResolvedValue(undefined);
  render(<Harness initial={[mark("late", 90, "Fim"), mark("early", 30, "Começo")]} onSeek={onSeek} />);
  const items = screen.getAllByRole("button", { name: /^Ir para/ });
  expect(items.map((b) => b.getAttribute("aria-label"))).toEqual(["Ir para Começo em 00:30", "Ir para Fim em 01:30"]);
  fireEvent.click(items[0]!);
  expect(onSeek).toHaveBeenCalledWith(30);
  fireEvent.click(screen.getByRole("button", { name: "Editar Começo" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Nome do marcador" }), { target: { value: "Abertura" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Nota do marcador" }), { target: { value: "Pauta lida" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Nome do marcador" })).not.toBeInTheDocument());
  expect(screen.getByText("Pauta lida", { selector: "span" })).toBeVisible();
  expect(api.updateBookmark).toHaveBeenCalledWith("early", { label: "Abertura", note: "Pauta lida" });
  fireEvent.click(screen.getByRole("button", { name: "Excluir Fim" }));
  await waitFor(() => expect(screen.queryByText("Fim")).not.toBeInTheDocument());
});

it("keeps the list and explains when saving fails", async () => {
  vi.mocked(api.deleteBookmark).mockRejectedValue(new ApiError(404, { error: { code: "NOT_FOUND", message: "Marcador não encontrado", details: {}, request_id: null } }));
  render(<Harness initial={[mark("b1", 5, "Ponto")]} />);
  fireEvent.click(screen.getByRole("button", { name: "Excluir Ponto" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Marcador não encontrado");
  expect(screen.getByText("Ponto")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Editar Ponto" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("textbox", { name: "Nome do marcador" })).not.toBeInTheDocument();
});
