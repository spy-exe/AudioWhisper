import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SearchView } from "@/components/search/SearchView";
import { api, ApiError } from "@/lib/api";
import type { SearchHit, SearchPage } from "@/lib/types";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.params, usePathname: () => "/search", useRouter: () => nav }));
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), api: { search: vi.fn() } }));

const hit = (id: string, start = 12): SearchHit => ({
  job_id: "j1", segment_id: id, start, end: start + 3, title: "Comitê", speaker: "Ana",
  snippet: { before: "vamos falar do ", match: "orçamento", after: " agora" }, job_created_at: new Date().toISOString(),
});
const page = (hits: SearchHit[], total = hits.length): SearchPage => ({ query: "orcamento", total, offset: 0, limit: 20, hits });

beforeEach(() => {
  nav.params = new URLSearchParams();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

it("debounces the query into the URL", async () => {
  vi.useFakeTimers();
  render(<SearchView />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "orçamento" } });
  await act(async () => { vi.advanceTimersByTime(299); });
  expect(nav.replace).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(nav.replace).toHaveBeenCalledWith("/search?q=or%C3%A7amento", { scroll: false });
});

it("lists moments with speaker, highlight and deep links, and loads more", async () => {
  nav.params = new URLSearchParams("q=orcamento");
  vi.mocked(api.search).mockResolvedValueOnce(page([hit("s1")], 2)).mockResolvedValueOnce({ ...page([hit("s2", 300)], 2), offset: 1 });
  render(<SearchView />);
  const link = await screen.findByRole("link", { name: /Comitê.*00:12.*Ana: vamos falar do orçamento agora/ });
  expect(link).toHaveAttribute("href", "/jobs/j1?t=12");
  expect(screen.getByText("2 momentos encontrados · acentos e maiúsculas ignorados")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Mostrar mais (1)" }));
  expect(await screen.findByRole("link", { name: /05:00/ })).toHaveAttribute("href", "/jobs/j1?t=300");
  expect(vi.mocked(api.search).mock.calls[1]![0].get("offset")).toBe("1");
  expect(screen.queryByRole("button", { name: /Mostrar mais/ })).not.toBeInTheDocument();
});

it("distinguishes no results, short queries and failures", async () => {
  nav.params = new URLSearchParams("q=a");
  const { rerender } = render(<SearchView />);
  expect(screen.getByText("Digite pelo menos dois caracteres.")).toBeVisible();
  expect(api.search).not.toHaveBeenCalled();

  vi.mocked(api.search).mockResolvedValueOnce(page([]));
  nav.params = new URLSearchParams("q=inexistente");
  rerender(<SearchView />);
  expect(await screen.findByText("Ninguém disse “inexistente” nas gravações concluídas.")).toBeVisible();

  vi.mocked(api.search).mockRejectedValueOnce(new ApiError(0, { error: { code: "NETWORK_ERROR", message: "Sem conexão com o AudioWhisper.", details: {}, request_id: null } }))
    .mockResolvedValueOnce(page([hit("s1")]));
  nav.params = new URLSearchParams("q=backup");
  rerender(<SearchView />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão com o AudioWhisper.");
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  expect(await screen.findByRole("link", { name: /orçamento/ })).toBeVisible();
});

it("clears the query and the URL at once", async () => {
  nav.params = new URLSearchParams("q=orcamento");
  vi.mocked(api.search).mockResolvedValue(page([hit("s1")]));
  render(<SearchView />);
  await screen.findByRole("link", { name: /orçamento/ });
  fireEvent.click(screen.getByRole("button", { name: "Limpar busca" }));
  expect(nav.replace).toHaveBeenCalledWith("/search", { scroll: false });
  await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue(""));
  expect(screen.getByRole("searchbox")).toHaveFocus();
});
