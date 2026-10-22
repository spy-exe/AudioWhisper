import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LibraryView } from "@/components/jobs/LibraryView";
import { api } from "@/lib/api";
import type { LibraryPage } from "@/lib/types";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.params, usePathname: () => "/library", useRouter: () => nav }));
vi.mock("@/lib/api", () => ({ api: { library: vi.fn() } }));
const empty: LibraryPage = { items: [], total: 0, offset: 0, limit: 20 };
beforeEach(() => { nav.params = new URLSearchParams(); vi.clearAllMocks(); vi.mocked(api.library).mockResolvedValue(empty); });
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
  await screen.findByText("60 gravações · 21 a 40");
  fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
  expect(nav.replace).toHaveBeenLastCalledWith("/library?q=backup&offset=40", { scroll: false });
  fireEvent.change(screen.getByRole("combobox", { name: "Filtrar por status" }), { target: { value: "completed" } });
  expect(nav.replace).toHaveBeenLastCalledWith("/library?q=backup&status=completed", { scroll: false });
});
