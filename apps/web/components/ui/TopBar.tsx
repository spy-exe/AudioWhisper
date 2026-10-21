"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";

import { GpuStatusBadge } from "@/components/jobs/GpuStatusBadge";

export function TopBar() {
  const pathname = usePathname();
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
              AudioWhisper{" "}
              <span className="brand-version">
                STUDIO 2.0
              </span>
            </span>
          </Link>
          <div className="header-status">
            <span className="hidden items-center gap-2 text-xs text-text-muted md:flex">
              <Icon name="shield" className="size-4 text-success" />{" "}
              Processamento local
            </span>
            <div className="header-gpu"><GpuStatusBadge /></div>
          </div>
        </div>
      </header>
      <nav className="app-sidebar" aria-label="Navegação principal">
        <p className="mb-3 hidden px-3 text-xs font-semibold uppercase tracking-[.18em] text-text-muted lg:block">
          SEU WORKSPACE
        </p>
        <Link href="/#live-capture-slot" className="nav-create"><Icon name="mic" /> Nova gravação <span aria-hidden="true">+</span></Link>
        {(
          [
            { href: "/", label: "Studio", icon: "studio" },
            { href: "/library", label: "Biblioteca", icon: "library" },
            { href: "/settings", label: "Configurações", icon: "settings" },
          ] as const
        ).map((item) => (
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
        <div className="sidebar-note">
          <Icon name="shield" className="mb-3 size-6 text-success" />
          <p>Seu áudio fica com você.</p>
          <span>Inteligência local, do primeiro segundo ao próximo passo.</span>
        </div>
      </nav>
    </>
  );
}
