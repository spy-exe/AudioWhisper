import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthGate } from "@/components/ui/AuthGate";

const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));
beforeEach(() => { nav.path = "/"; });
afterEach(() => vi.unstubAllGlobals());

it("retries an unavailable session check before showing protected content", async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true, json: async () => ({ authenticated: true }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<AuthGate><p>Studio protegido</p></AuthGate>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível conectar");
  expect(screen.queryByText("Studio protegido")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  expect(await screen.findByText("Studio protegido")).toBeVisible();
});

it("validates the masked token, preserves it on failure and resumes after successful login", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ authenticated: false }) }).mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  render(<AuthGate><p>Studio protegido</p></AuthGate>);
  const input = await screen.findByLabelText("Token de acesso");
  expect(input).toHaveAttribute("type", "password");
  fireEvent.click(screen.getByRole("button", { name: "Entrar no Studio" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Informe o token");
  fireEvent.change(input, { target: { value: "test-only-token" } });
  fireEvent.click(screen.getByRole("button", { name: "Mostrar token" }));
  expect(input).toHaveAttribute("type", "text");
  fireEvent.click(screen.getByRole("button", { name: "Entrar no Studio" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Token inválido");
  expect(input).toHaveValue("test-only-token");
  fireEvent.click(screen.getByRole("button", { name: "Entrar no Studio" }));
  expect(await screen.findByText("Studio protegido")).toBeVisible();
  act(() => window.dispatchEvent(new Event("audiowhisper:unauthorized")));
  expect(await screen.findByRole("alert")).toHaveTextContent("Sua sessão expirou");
  expect(screen.getByLabelText("Token de acesso")).toHaveValue("");
});

it("a shared read-only document does not request an administrative session", () => {
  nav.path = "/shared/test-token";
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  render(<AuthGate><p>Documento compartilhado</p></AuthGate>);
  expect(screen.getByText("Documento compartilhado")).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});
