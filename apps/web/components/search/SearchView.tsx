"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api, describeError, isAbort } from "@/lib/api";
import { formatRelativeTime, formatTimestamp } from "@/lib/format";
import type { SearchHit } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

const PAGE_SIZE = 20;

/** Every moment a term was said, across the library. The query lives in the URL (an explicit,
 * clearable exception to the no-content-in-URL rule, as for library filters). */
export function SearchView() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current = search.get("q") ?? "";
  const [query, setQuery] = useState(current);
  const [composing, setComposing] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setQuery(current), [current]);

  useEffect(() => {
    if (composing || query.trim() === current) return;
    const timer = setTimeout(() => {
      const term = query.trim();
      router.replace(term ? `${pathname}?q=${encodeURIComponent(term)}` : pathname, { scroll: false });
    }, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query, current, composing, pathname, router]);

  useEffect(() => {
    setHits([]);
    setTotal(0);
    setError("");
    if (current.trim().length < 2) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    api
      .search(new URLSearchParams({ q: current, limit: String(PAGE_SIZE) }), controller.signal)
      .then((page) => {
        setHits(page.hits);
        setTotal(page.total);
      })
      .catch((failure) => {
        if (!isAbort(failure)) setError(describeError(failure, "Não foi possível buscar agora. Tente novamente."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [current, attempt]);

  const loadMore = async () => {
    setLoading(true);
    try {
      const page = await api.search(
        new URLSearchParams({ q: current, limit: String(PAGE_SIZE), offset: String(hits.length) }),
      );
      setHits((previous) => [...previous, ...page.hits]);
      setTotal(page.total);
    } catch (failure) {
      setError(describeError(failure, "Não foi possível carregar mais resultados."));
    } finally {
      setLoading(false);
    }
  };

  const tooShort = current.trim().length > 0 && current.trim().length < 2;
  return (
    <div className="flex flex-col gap-5">
      <div className="relative">
        <Icon name="search" className="absolute top-3.5 left-3 size-4 text-text-muted" />
        <input
          ref={input}
          type="search"
          aria-label="Buscar em todas as transcrições"
          className="field pr-12 pl-10 text-lg"
          placeholder="Uma palavra, nome ou frase dita em qualquer gravação…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
        />
        {query && (
          <button
            className="absolute top-1.5 right-1.5 rounded p-2 text-text-secondary hover:bg-surface-interactive"
            aria-label="Limpar busca"
            onClick={() => {
              setQuery("");
              router.replace(pathname, { scroll: false });
              input.current?.focus();
            }}
          >
            ×
          </button>
        )}
      </div>
      <p className="text-xs text-text-muted" aria-live="polite">
        {tooShort
          ? "Digite pelo menos dois caracteres."
          : current && !loading && !error
            ? `${total} ${total === 1 ? "momento encontrado" : "momentos encontrados"} · acentos e maiúsculas ignorados`
            : "Somente gravações concluídas. Acentos e maiúsculas são ignorados."}
      </p>
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {error}
          <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
            Tentar novamente
          </Button>
        </div>
      )}
      {loading && !hits.length ? (
        <div className="skeleton h-48" role="status" aria-label="Buscando" />
      ) : hits.length > 0 ? (
        <ul className="search-results">
          {hits.map((hit) => (
            <li key={hit.segment_id}>
              <Link href={`/jobs/${hit.job_id}?t=${Math.floor(hit.start)}`} className="search-hit">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-text-primary">{hit.title}</span>
                  <span className="text-xs text-text-muted">{formatRelativeTime(hit.job_created_at)}</span>
                </span>
                <span className="mt-2 flex gap-3">
                  <span className="shrink-0 font-mono text-xs text-accent">{formatTimestamp(hit.start)}</span>
                  <span className="snippet">
                    {hit.speaker && <strong className="text-text-primary">{hit.speaker}: </strong>}
                    {hit.snippet.before}
                    <mark>{hit.snippet.match}</mark>
                    {hit.snippet.after}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        current.trim().length >= 2 &&
        !loading &&
        !error && (
          <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-border p-6 text-center">
            <p className="text-sm">Ninguém disse “{current}” nas gravações concluídas.</p>
            <p className="text-xs text-text-muted">Tente uma variação da palavra ou um termo mais curto.</p>
          </div>
        )
      )}
      {hits.length > 0 && hits.length < total && (
        <Button className="self-center" onClick={loadMore} disabled={loading}>
          {loading ? "Carregando…" : `Mostrar mais (${total - hits.length})`}
        </Button>
      )}
    </div>
  );
}
