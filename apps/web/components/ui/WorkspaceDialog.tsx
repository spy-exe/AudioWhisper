"use client";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "./Button";

export function WorkspaceDialog({
  open,
  onClose,
  title,
  children,
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      const active = document.activeElement as HTMLElement | null;
      node.showModal();
      initialFocus?.current?.focus();
      return () => {
        if (node.open) node.close();
        active?.focus();
      };
    }
    if (!open && node.open) node.close();
  }, [open, initialFocus]);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="workspace-dialog"
      onCancel={onClose}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="workspace-dialog-inner">
        <header>
          <h2 id={titleId}>{title}</h2>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-label="Fechar janela"
            onClick={onClose}
          >
            ×
          </Button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function DraftGuard({ dirty }: { dirty: boolean }) {
  const [destination, setDestination] = useState("");
  const router = useRouter();
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = (event.target as Element).closest(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download"))
        return;
      const url = new URL(link.href);
      if (
        url.origin !== location.origin ||
        (url.pathname === location.pathname && url.search === location.search)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setDestination(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);
  return (
    <WorkspaceDialog
      open={!!destination}
      onClose={() => setDestination("")}
      title="Continuar sem salvar?"
    >
      <p>Há alterações não salvas nesta página. Sair descarta esses campos.</p>
      <div className="hub-inline-actions mt-5">
        <Button type="button" onClick={() => setDestination("")}>
          Continuar editando
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={() => {
            const next = destination;
            setDestination("");
            router.push(next);
          }}
        >
          Descartar e sair
        </Button>
      </div>
    </WorkspaceDialog>
  );
}
