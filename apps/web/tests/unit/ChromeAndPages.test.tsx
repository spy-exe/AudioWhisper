import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AppError from "@/app/error";
import NotFound from "@/app/not-found";
import { SharedDocument } from "@/app/shared/[token]/shared-document";
import { SearchBar } from "@/components/editor/SearchBar";
import { TopBar } from "@/components/ui/TopBar";
import { IntelligenceSettings } from "@/components/workspace/IntelligenceSettings";
import { api } from "@/lib/api";

const nav = vi.hoisted(() => ({ pathname: "/library", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => nav }));
vi.mock("@/components/jobs/GpuStatusBadge", () => ({ GpuStatusBadge: () => null }));
vi.mock("@/components/jobs/QueueIndicator", () => ({ QueueIndicator: () => null }));
vi.mock("@/contexts/SettingsContext", () => ({ useSettings: () => ({ settings: { ai_model: "" }, update: vi.fn().mockRejectedValue(new Error("x")) }) }));

beforeEach(() => {
  vi.restoreAllMocks();
  nav.pathname = "/library";
  nav.push.mockReset();
});

it("searches everything that was said from the header and marks the current section", () => {
  render(<TopBar />);
  expect(screen.getByRole("link", { name: "Biblioteca" })).toHaveAttribute("aria-current", "page");
  const field = screen.getByRole("searchbox", { name: "Buscar em todas as transcrições" });
  fireEvent.change(field, { target: { value: " orçamento " } });
  fireEvent.submit(field.closest("form")!);
  expect(nav.push).toHaveBeenCalledWith("/search?q=or%C3%A7amento");
  expect(field).toHaveValue("");
});

it("keeps the shared page minimal and hides the header search on the search page", () => {
  nav.pathname = "/shared/abc";
  const { unmount } = render(<TopBar />);
  expect(screen.getByText("Documento privado compartilhado")).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  unmount();
  nav.pathname = "/search";
  render(<TopBar />);
  expect(screen.queryByRole("search")).not.toBeInTheDocument();
});

it("navigates search results with Enter, Shift+Enter, clears and closes with Escape", () => {
  const handlers = { onQueryChange: vi.fn(), onReplaceChange: vi.fn(), onNext: vi.fn(), onPrev: vi.fn(), onReplaceAll: vi.fn(), onClose: vi.fn() };
  render(<SearchBar query="backup" replaceValue="" matchCount={3} currentMatchIndex={1} {...handlers} />);
  const input = screen.getByRole("textbox", { name: "Pesquisar" });
  expect(input).toHaveFocus();
  expect(screen.getByText("2/3")).toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(handlers.onNext).toHaveBeenCalledOnce();
  expect(handlers.onPrev).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Limpar pesquisa" }));
  expect(handlers.onQueryChange).toHaveBeenCalledWith("");
  fireEvent.click(screen.getByRole("button", { name: "Substituir tudo" }));
  expect(handlers.onReplaceAll).toHaveBeenCalledOnce();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(handlers.onClose).toHaveBeenCalledOnce();
});

it("disables result navigation without matches", () => {
  render(<SearchBar query="" replaceValue="" matchCount={0} currentMatchIndex={0} onQueryChange={vi.fn()} onReplaceChange={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()} onReplaceAll={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByText("0/0")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Próximo resultado" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Substituir tudo" })).toBeDisabled();
});

it("renders a shared document or explains an expired link", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ markdown: "# Ata\n\nTexto aprovado" }), { status: 200 }))
    .mockResolvedValueOnce(new Response("{}", { status: 404 })));
  const { unmount } = render(<SharedDocument token="abc/def" />);
  expect(await screen.findByText("Texto aprovado")).toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("/api/shared/abc%2Fdef");
  unmount();
  render(<SharedDocument token="velho" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Este link expirou");
  vi.unstubAllGlobals();
});

it("shows engine and integration status, and explains failures", async () => {
  vi.spyOn(api, "intelligence").mockResolvedValue({ provider: "ollama", available: true, models: ["qwen3:4b"], error: null });
  vi.spyOn(api, "integrations").mockResolvedValue({ smtp_available: true, diarization_configured: false });
  render(<IntelligenceSettings />);
  expect(await screen.findByText("1 modelos locais disponíveis")).toBeInTheDocument();
  expect(await screen.findByText(/SMTP: configurado · Falantes: requer configuração/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Modelo padrão" }), { target: { value: "qwen3:4b" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível salvar o modelo.");
});

it("reports an unreachable integrations endpoint", async () => {
  vi.spyOn(api, "intelligence").mockRejectedValue(new Error("x"));
  vi.spyOn(api, "integrations").mockRejectedValue(new Error("x"));
  render(<IntelligenceSettings />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Não foi possível verificar/));
});

it("offers recovery from rendering errors and unknown pages", () => {
  const reset = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { unmount } = render(<AppError error={Object.assign(new Error("boom"), { digest: "abc123" })} reset={reset} />);
  expect(screen.getByText("Código: abc123")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  expect(reset).toHaveBeenCalledOnce();
  unmount();
  render(<NotFound />);
  expect(screen.getByRole("link", { name: "Abrir a biblioteca" })).toHaveAttribute("href", "/library");
});
