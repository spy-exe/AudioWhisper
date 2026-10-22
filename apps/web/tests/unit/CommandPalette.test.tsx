import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { DraftGuard } from "@/components/ui/WorkspaceDialog";
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/projects",
}));
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

it("focuses command search, filters accented names and restores the invoking control", () => {
  render(<CommandPalette />);
  const trigger = screen.getByRole("button", {
    name: "Abrir comandos rápidos",
  });
  trigger.focus();
  fireEvent.click(trigger);
  const search = screen.getByRole("searchbox", { name: "Buscar comando" });
  expect(search).toHaveFocus();
  fireEvent.change(search, { target: { value: "configuracoes" } });
  expect(screen.getByRole("link", { name: /Configurações/ })).toBeVisible();
  expect(
    screen.queryByRole("link", { name: /Biblioteca/ }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(search, { key: "ArrowDown" });
  expect(screen.getByRole("link", { name: /Configurações/ })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Fechar janela" }));
  expect(trigger).toHaveFocus();
});

it("requires an explicit discard before leaving a dirty page", () => {
  render(
    <>
      <DraftGuard dirty />
      <a href="/library">Biblioteca</a>
    </>,
  );
  fireEvent.click(screen.getByRole("link", { name: "Biblioteca" }));
  expect(
    screen.getByRole("dialog", { name: "Continuar sem salvar?" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Continuar editando" }));
  expect(navigation.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("link", { name: "Biblioteca" }));
  fireEvent.click(screen.getByRole("button", { name: "Descartar e sair" }));
  expect(navigation.push).toHaveBeenCalledWith("/library");
});
