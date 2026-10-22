"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { workspaceNavigation } from "@/lib/workspace-navigation";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { Icon } from "./Icon";

export function CommandPalette() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !event.isComposing
      ) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const normalized = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR");
  const items = workspaceNavigation.filter((item) =>
    normalized(item.label + " " + item.description).includes(normalized(query)),
  );
  return (
    <>
      <button
        className="command-trigger"
        aria-label="Abrir comandos rápidos"
        aria-keyshortcuts="Control+k Meta+k"
        onClick={() => setOpen(true)}
      >
        <Icon name="search" />
        <span>Ir para…</span>
        <kbd>Ctrl K</kbd>
      </button>
      <WorkspaceDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Ir para"
        initialFocus={input}
      >
        <div className="hub-search">
          <Icon name="search" />
          <input
            ref={input}
            autoFocus
            type="search"
            aria-label="Buscar comando"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Projetos, tarefas, gravações…"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                document
                  .querySelector<HTMLAnchorElement>(".command-options a")
                  ?.focus();
              }
            }}
          />
          {query && (
            <button
              type="button"
              aria-label="Limpar comandos"
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
            >
              ×
            </button>
          )}
        </div>
        <nav
          className="command-options"
          aria-label="Comandos disponíveis"
          onKeyDown={(e) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            const links = [
              ...e.currentTarget.querySelectorAll<HTMLAnchorElement>("a"),
            ];
            const index = links.indexOf(
              document.activeElement as HTMLAnchorElement,
            );
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? links.length - 1
                  : (index + (e.key === "ArrowDown" ? 1 : -1) + links.length) %
                    links.length;
            links[next]?.focus();
          }}
        >
          {items.map((item) => (
            <Link
              href={item.href}
              key={item.href}
              onClick={() => setOpen(false)}
            >
              <Icon name={item.icon} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <Icon name="arrow" />
            </Link>
          ))}
          {!items.length && (
            <p className="hub-empty">Nenhum comando encontrado.</p>
          )}
        </nav>
      </WorkspaceDialog>
    </>
  );
}
