import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";

function Harness({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <ConfirmDialog open={open} title="Confirmar?" description="Detalhes" confirmLabel="Sim" danger onConfirm={onConfirm} onClose={() => setOpen(false)} />
    </>
  );
}

it("moves focus in, traps Tab, closes on Escape and returns focus", () => {
  const { container } = render(<Harness onConfirm={vi.fn()} />);
  container.style.transform = 'translateY(8px)';
  const opener = screen.getByRole("button", { name: "Abrir" });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole("alertdialog", { name: "Confirmar?" });
  expect(container).not.toContainElement(dialog);
  expect(container).toHaveAttribute('inert');
  expect(dialog).toHaveAccessibleDescription("Detalhes");
  const cancel = screen.getByRole("button", { name: "Cancelar" });
  const confirm = screen.getByRole("button", { name: "Sim" });
  expect(cancel).toHaveFocus();
  confirm.focus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(cancel).toHaveFocus();
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(confirm).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  expect(container).not.toHaveAttribute('inert');
});

it("keeps the dialog open with the error when the action fails, and closes on success", async () => {
  const onConfirm = vi.fn().mockRejectedValueOnce(new Error("Falhou de verdade")).mockResolvedValue(undefined);
  render(<Harness onConfirm={onConfirm} />);
  fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
  fireEvent.click(screen.getByRole("button", { name: "Sim" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Falhou de verdade");
  fireEvent.click(screen.getByRole("button", { name: "Sim" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
});

it("uses a generic message for unknown failures and closes from the backdrop", async () => {
  const onConfirm = vi.fn().mockRejectedValue("?");
  render(<Harness onConfirm={onConfirm} />);
  fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
  fireEvent.click(screen.getByRole("button", { name: "Sim" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível concluir");
  fireEvent.mouseDown(document.querySelector(".dialog-backdrop")!);
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

it("renders nothing while closed and focuses the panel when it has no controls", () => {
  const { rerender } = render(<Dialog open={false} title="T" onClose={vi.fn()} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  rerender(<Dialog open title="Sem controles" onClose={vi.fn()} />);
  expect(screen.getByRole("dialog", { name: "Sem controles" })).toHaveFocus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(screen.getByRole("dialog")).toHaveFocus();
});
