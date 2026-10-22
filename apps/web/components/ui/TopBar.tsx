"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { workspaceNavigation } from "@/lib/workspace-navigation";
import { Icon } from "./Icon";
import { CommandPalette } from "./CommandPalette";
import { WorkspaceDialog } from "./WorkspaceDialog";

import { GpuStatusBadge } from "@/components/jobs/GpuStatusBadge";

export function TopBar() {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  useEffect(() => {
    setMore(false);
  }, [pathname]);
  if (pathname.startsWith("/shared/"))
    return (
      <header className="border-b border-border px-6 py-5 text-sm font-semibold text-text-secondary">
        AudioWhisper{" "}
        <span className="ml-2 text-xs font-normal text-text-muted">
          Documento privado compartilhado
        </span>
      </header>
    );
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-surface focus:p-3"
      >
        Ir para o conteúdo
      </a>
      <header className="app-header">
        <div className="app-header-inner">
          <Link
            href="/"
            className="brand-link"
            aria-label="AudioWhisper 2.0 — Studio"
          >
            <span className="brand-mark">
              <Icon name="studio" />
            </span>
            <span className="brand-title">
              AudioWhisper <span className="brand-version">STUDIO 2.0</span>
            </span>
          </Link>
          <div className="header-status">
            <CommandPalette />
            <span className="hidden items-center gap-2 text-xs text-text-muted md:flex">
              <Icon name="shield" className="size-4 text-success" />{" "}
              Processamento local
            </span>
            <div className="header-gpu">
              <GpuStatusBadge />
            </div>
          </div>
        </div>
      </header>
      <nav className="app-sidebar" aria-label="Navegação principal">
        <p className="mb-3 hidden px-3 text-xs font-semibold uppercase tracking-[.18em] text-text-muted lg:block">
          SEU WORKSPACE
        </p>
        <Link href="/#live-capture-slot" className="nav-create">
          <Icon name="mic" /> Nova gravação <span aria-hidden="true">+</span>
        </Link>
        <div className="desktop-destinations">
          {workspaceNavigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="app-nav-link"
              aria-current={
                (
                  item.href === "/"
                    ? pathname === "/" || pathname.startsWith("/jobs/")
                    : pathname.startsWith(item.href)
                )
                  ? "page"
                  : undefined
              }
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
        <div className="mobile-destinations">
          {workspaceNavigation.slice(0, 3).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="app-nav-link"
              aria-current={pathname === item.href ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
          <button
            className="app-nav-link"
            aria-expanded={more}
            onClick={() => setMore(true)}
          >
            <Icon name="command" />
            <span>Mais</span>
          </button>
        </div>
        <div className="sidebar-note">
          <Icon name="shield" className="mb-3 size-6 text-success" />
          <p>Seu áudio fica com você.</p>
          <span>Inteligência local, do primeiro segundo ao próximo passo.</span>
        </div>
      </nav>
      <WorkspaceDialog
        open={more}
        onClose={() => setMore(false)}
        title="Seu workspace"
      >
        <nav className="command-options" aria-label="Todas as ferramentas">
          {workspaceNavigation.map((item) => (
            <Link
              href={item.href}
              key={item.href}
              onClick={() => setMore(false)}
              aria-current={pathname === item.href ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <Icon name="arrow" />
            </Link>
          ))}
        </nav>
      </WorkspaceDialog>
    </>
  );
}
