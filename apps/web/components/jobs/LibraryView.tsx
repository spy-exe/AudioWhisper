"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { LibraryPage } from "@/lib/types";
import { formatDuration, formatRelativeTime, statusLabel } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";

export function LibraryView({ recent = false }: { recent?: boolean }) {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(search.get("q") ?? "");
  const [composing, setComposing] = useState(false);
  const [page, setPage] = useState<LibraryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const paramsString = recent ? "limit=5" : search.toString();
  const currentQuery = search.get("q") ?? "";

  const change = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "offset") next.delete("offset");
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  useEffect(() => {
    setQuery(currentQuery);
  }, [currentQuery]);
  useEffect(() => {
    if (recent || composing || query === currentQuery) return;
    const timer = setTimeout(
      () => {
        const next = new URLSearchParams(search);
        if (query.trim()) next.set("q", query.trim());
        else next.delete("q");
        next.delete("offset");
        router.replace(`${pathname}?${next}`, { scroll: false });
      },
      query ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, currentQuery, composing, pathname, router, search, recent]);

  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await api.library(
          new URLSearchParams(paramsString),
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setPage(result);
          setError(null);
        }
      } catch {
        if (!controller.signal.aborted)
          setError(
            "Não foi possível carregar a biblioteca. Verifique a conexão e tente novamente.",
          );
      } finally {
        busy = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    setLoading(true);
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [paramsString, refresh]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!recent && (
        <div className="library-filters grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative min-w-0 flex-1 basis-64">
            <Icon
              name="search"
              className="absolute top-3 left-3 size-4 text-text-muted"
            />
            <input
              ref={input}
              aria-label="Buscar na biblioteca"
              type="search"
              className="field pr-12 pl-10"
              placeholder="Título ou palavras da transcrição…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
            />
            {query && (
              <button
                className="absolute top-1 right-1 rounded p-2 text-text-secondary hover:bg-surface-interactive"
                aria-label="Limpar busca"
                onClick={() => {
                  setQuery("");
                  change("q", "");
                  input.current?.focus();
                }}
              >
                ×
              </button>
            )}
          </div>
          <select
            aria-label="Filtrar por status"
            className="field w-auto"
            value={search.get("status") ?? "all"}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="all">Todos os status</option>
            <option value="active">Em processamento</option>
            <option value="completed">Concluídos</option>
            <option value="failed">Com falha</option>
            <option value="cancelled">Cancelados</option>
          </select>
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-3">
          {(
            [
              ["folder", "Pasta"],
              ["project", "Projeto"],
              ["tag", "Tag"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex min-w-0 items-center gap-2 text-xs text-text-muted"
            >
              {label}
              <input
                aria-label={`Filtrar por ${label.toLowerCase()}`}
                className="field min-w-0 flex-1"
                defaultValue={search.get(key) ?? ""}
                onBlur={(e) => change(key, e.target.value.trim())}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    change(key, e.currentTarget.value.trim());
                }}
              />
            </label>
          ))}
          </div>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger"
        >
          {error}
          <Button size="sm" onClick={() => setRefresh((n) => n + 1)}>
            Tentar novamente
          </Button>
        </div>
      )}
      <div
        aria-busy={loading}
        className="library-surface overflow-hidden rounded-2xl border border-border bg-surface"
      >
        {loading ? (
          <div
            className="divide-y divide-border"
            role="status"
            aria-label="Carregando biblioteca"
          >
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex min-h-25 items-center gap-4 p-5 sm:px-6">
                <div className="skeleton size-12 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-2/3" />
                  <div className="skeleton h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : page?.items.length ? (
          <ul className="divide-y divide-border">
            {page.items.map((item) => (
              <li key={item.job.id}>
                <Link
                  href={`/jobs/${item.job.id}`}
                  className="library-row flex min-w-0 flex-wrap items-center gap-4 p-5 sm:px-6"
                >
                  <span className="library-symbol flex shrink-0 items-center justify-center text-accent">
                    <Icon name="file" />
                  </span>
                  <div className="min-w-0 flex-1 basis-40">
                    <p
                      className="library-title truncate"
                      title={item.title || item.name}
                    >
                      {item.title || item.name}
                    </p>
                    <p className="mt-1 truncate text-xs text-text-muted">
                      {item.project ||
                        item.folder ||
                        (item.media_type === "audio" ? "Áudio" : "Vídeo")}{" "}
                      ·{" "}
                      {formatRelativeTime(item.job.updated_at)}
                    </p>
                    {!["completed", "failed", "cancelled"].includes(
                      item.job.status,
                    ) && (
                      <ProgressBar
                        value={item.job.progress}
                        label={`Progresso de ${item.title || item.name}`}
                        className="mt-2 max-w-xs"
                      />
                    )}
                  </div>
                  <span className="font-mono text-xs text-text-muted">
                    {item.duration_seconds != null
                      ? formatDuration(item.duration_seconds)
                      : "—"}
                  </span>
                  <Badge
                    tone={
                      item.job.status === "completed"
                        ? "success"
                        : item.job.status === "failed"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {statusLabel(item.job.status)}
                  </Badge>
                  <Icon
                    name="arrow"
                    className="hidden size-4 text-text-muted sm:block"
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          !error && (
            <div className="flex min-h-48 flex-col items-center justify-center gap-2 p-6 text-center">
              <Icon name="library" className="mb-2 size-7 text-text-muted" />
              <p className="text-sm">
                {currentQuery || search.get("status")
                  ? "Nenhuma gravação encontrada"
                  : "Sua biblioteca começa com uma conversa"}
              </p>
              <p className="text-xs text-text-muted">
                {currentQuery
                  ? "Tente outro termo ou limpe os filtros."
                  : "Importe um áudio ou comece uma captura no Studio."}
              </p>
              <Link
                href="/#importar"
                className="mt-3 text-sm text-accent hover:underline"
              >
                Importar gravação →
              </Link>
            </div>
          )
        )}
      </div>
      {recent ? (
        <Link
          href="/library"
          className="self-end text-xs text-text-secondary hover:text-accent"
        >
          Abrir biblioteca →
        </Link>
      ) : (
        page && (
          <div
            className="flex items-center justify-between gap-3 text-xs text-text-muted"
            aria-live="polite"
          >
            <span>
              {page.total} gravações
              {page.total > 0 &&
                ` · ${Math.min(page.offset + 1, page.total)}–${Math.min(page.offset + page.limit, page.total)}`}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={loading || !page.offset}
                onClick={() =>
                  change(
                    "offset",
                    String(Math.max(0, page.offset - page.limit)),
                  )
                }
              >
                Anterior
              </Button>
              <Button
                size="sm"
                disabled={loading || page.offset + page.limit >= page.total}
                onClick={() =>
                  change("offset", String(page.offset + page.limit))
                }
              >
                Próxima
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
