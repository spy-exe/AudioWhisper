"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, describeError } from "@/lib/api";
import type { LibraryFacets, LibraryPage } from "@/lib/types";
import {
  formatDuration,
  formatRelativeTime,
  formatTimestamp,
  statusLabel,
} from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";

const FILTERS = [
  ["folder", "Pasta", "folders"],
  ["project", "Projeto", "projects"],
  ["tag", "Tag", "tags"],
] as const;

const SORTS = [
  ["recent", "Mais recentes"],
  ["oldest", "Mais antigas"],
  ["name", "Nome (A–Z)"],
  ["duration", "Mais longas"],
] as const;

export function LibraryView({ recent = false }: { recent?: boolean }) {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(search.get("q") ?? "");
  const [composing, setComposing] = useState(false);
  const [page, setPage] = useState<LibraryPage | null>(null);
  const [facets, setFacets] = useState<LibraryFacets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkFolder, setBulkFolder] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // A refresh after a bulk action keeps the current rows on screen instead of a skeleton.
  const quietRefresh = useRef(false);
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
    if (recent) return;
    let active = true;
    // Suggestions only: the filters keep working as free text if this request fails.
    Promise.resolve()
      .then(() => api.libraryFacets())
      .then((result) => {
        if (active) setFacets(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [recent, refresh]);

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
    if (!quietRefresh.current) setLoading(true);
    quietRefresh.current = false;
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [paramsString, refresh]);

  const toggle = (jobId: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  const finishBulk = (message: string) => {
    setSelected(new Set());
    setBulkNotice(message);
    quietRefresh.current = true;
    setRefresh((n) => n + 1);
  };
  const organizeSelection = async (values: { folder?: string; add_tags?: string[] }) => {
    setBulkBusy(true);
    try {
      const result = await api.bulk({ action: "organize", job_ids: [...selected], ...values });
      finishBulk(
        `${result.done.length} ${result.done.length === 1 ? "gravação atualizada" : "gravações atualizadas"}.`,
      );
      setBulkFolder("");
      setBulkTag("");
    } catch (failure) {
      setBulkNotice(describeError(failure, "Não foi possível atualizar as gravações."));
    } finally {
      setBulkBusy(false);
    }
  };

  const hasFilters =
    !!currentQuery || FILTERS.some(([key]) => search.get(key)) || !!search.get("status");
  const visibleIds = page?.items.map((item) => item.job.id) ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!recent && (
        <div className="library-filters grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
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
          <select
            aria-label="Ordenar biblioteca"
            className="field w-auto"
            value={search.get("sort") ?? "recent"}
            onChange={(e) => change("sort", e.target.value === "recent" ? "" : e.target.value)}
          >
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:col-span-3 sm:grid-cols-3">
            {FILTERS.map(([key, label, facet]) => (
              <label
                key={key}
                className="flex min-w-0 items-center gap-2 text-xs text-text-muted"
              >
                {label}
                <input
                  aria-label={`Filtrar por ${label.toLowerCase()}`}
                  className="field min-w-0 flex-1"
                  list={`library-${key}-options`}
                  defaultValue={search.get(key) ?? ""}
                  onBlur={(e) => change(key, e.target.value.trim())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      change(key, e.currentTarget.value.trim());
                  }}
                />
                <datalist id={`library-${key}-options`}>
                  {facets?.[facet].map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {`${entry.count} ${entry.count === 1 ? "gravação" : "gravações"}`}
                    </option>
                  ))}
                </datalist>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-3">
            <Link href={`/search${currentQuery ? `?q=${encodeURIComponent(currentQuery)}` : ""}`} className="text-sm text-accent hover:underline">
              Buscar cada momento em que algo foi dito →
            </Link>
            <Button
              size="sm"
              variant={selecting ? "secondary" : "ghost"}
              aria-pressed={selecting}
              onClick={() => {
                setSelecting(!selecting);
                setSelected(new Set());
                setBulkNotice("");
              }}
            >
              {selecting ? "Concluir seleção" : "Selecionar gravações"}
            </Button>
          </div>
        </div>
      )}
      {selecting && (
        <div className="bulk-bar" role="toolbar" aria-label="Ações em lote">
          <span className="text-sm text-text-secondary">
            {selected.size} {selected.size === 1 ? "selecionada" : "selecionadas"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setSelected(selected.size === visibleIds.length ? new Set() : new Set(visibleIds))
            }
          >
            {selected.size === visibleIds.length && visibleIds.length ? "Desmarcar página" : "Selecionar página"}
          </Button>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (bulkFolder.trim()) void organizeSelection({ folder: bulkFolder.trim() });
            }}
          >
            <input
              className="field w-44"
              aria-label="Mover seleção para a pasta"
              placeholder="Pasta"
              list="library-folder-options"
              value={bulkFolder}
              onChange={(e) => setBulkFolder(e.target.value)}
            />
            <Button size="sm" type="submit" disabled={bulkBusy || !selected.size || !bulkFolder.trim()}>
              Mover
            </Button>
          </form>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (bulkTag.trim()) void organizeSelection({ add_tags: [bulkTag.trim()] });
            }}
          >
            <input
              className="field w-36"
              aria-label="Adicionar tag à seleção"
              placeholder="Tag"
              list="library-tag-options"
              value={bulkTag}
              onChange={(e) => setBulkTag(e.target.value)}
            />
            <Button size="sm" type="submit" disabled={bulkBusy || !selected.size || !bulkTag.trim()}>
              Adicionar tag
            </Button>
          </form>
          <Button
            size="sm"
            variant="danger"
            disabled={bulkBusy || !selected.size}
            onClick={() => setConfirmDelete(true)}
          >
            Excluir
          </Button>
        </div>
      )}
      {bulkNotice && (
        <p role="status" className="text-sm text-text-secondary">
          {bulkNotice}
        </p>
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
            {page.items.map((item) => {
              const title = item.title || item.name;
              return (
                <li key={item.job.id} className="library-item">
                  <div className="flex min-w-0 items-stretch">
                    {selecting && (
                      <label className="library-check">
                        <input
                          type="checkbox"
                          checked={selected.has(item.job.id)}
                          onChange={() => toggle(item.job.id)}
                          aria-label={`Selecionar ${title}`}
                        />
                      </label>
                    )}
                    <Link
                      href={`/jobs/${item.job.id}`}
                      className="library-row flex min-w-0 flex-1 flex-wrap items-center gap-4 p-5 sm:px-6"
                    >
                      <span className="library-symbol flex shrink-0 items-center justify-center text-accent">
                        <Icon name="file" />
                      </span>
                      <div className="min-w-0 flex-1 basis-40">
                        <p className="library-title truncate" title={title}>
                          {title}
                        </p>
                        <p className="mt-1 truncate text-xs text-text-muted">
                          {item.project ||
                            item.folder ||
                            (item.media_type === "audio" ? "Áudio" : "Vídeo")}{" "}
                          · {formatRelativeTime(item.job.updated_at)}
                          {item.job.model_name && ` · ${item.job.model_name}`}
                        </p>
                        {item.tags.length > 0 && (
                          <p className="mt-2 flex flex-wrap gap-1.5">
                            {item.tags.slice(0, 5).map((tag) => (
                              <span key={tag} className="tag-chip">
                                {tag}
                              </span>
                            ))}
                          </p>
                        )}
                        {!["completed", "failed", "cancelled"].includes(
                          item.job.status,
                        ) && (
                          <ProgressBar
                            value={item.job.progress}
                            label={`Progresso de ${title}`}
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
                  </div>
                  {item.matches && item.matches.length > 0 && (
                    <ul className="library-matches" aria-label={`Trechos encontrados em ${title}`}>
                      {item.matches.map((match) => (
                        <li key={match.segment_id}>
                          <Link href={`/jobs/${item.job.id}?t=${Math.floor(match.start)}`}>
                            <span className="font-mono text-xs text-accent">
                              {formatTimestamp(match.start)}
                            </span>
                            <span className="snippet">
                              {match.before}
                              <mark>{match.match}</mark>
                              {match.after}
                            </span>
                          </Link>
                        </li>
                      ))}
                      {(item.match_count ?? 0) > item.matches.length && (
                        <li className="text-xs text-text-muted">
                          +{(item.match_count ?? 0) - item.matches.length} trechos nesta gravação
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          !error && (
            <div className="flex min-h-48 flex-col items-center justify-center gap-2 p-6 text-center">
              <Icon name="library" className="mb-2 size-7 text-text-muted" />
              <p className="text-sm">
                {hasFilters
                  ? "Nenhuma gravação encontrada"
                  : "Sua biblioteca começa com uma conversa"}
              </p>
              <p className="text-xs text-text-muted">
                {hasFilters
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
      <ConfirmDialog
        open={confirmDelete}
        title={`Excluir ${selected.size} ${selected.size === 1 ? "gravação" : "gravações"}?`}
        description="Transcrições, marcadores, documentos e links compartilhados serão removidos. Gravações ainda em processamento são mantidas. Não é possível desfazer."
        confirmLabel="Excluir selecionadas"
        danger
        onConfirm={async () => {
          try {
            const result = await api.bulk({ action: "delete", job_ids: [...selected] });
            finishBulk(
              `${result.done.length} excluída(s)` +
                (result.skipped.length ? `; ${result.skipped.length} mantida(s): ${result.skipped[0]!.reason}` : "."),
            );
          } catch (failure) {
            throw new Error(describeError(failure, "Não foi possível excluir as gravações."));
          }
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
