"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatTimestamp } from "@/lib/format";
import {
  sourceUrl,
  workspaceApi,
  type Page,
  type Source,
} from "@/lib/workspace-api";
import { useWorkspaceResource } from "@/hooks/useWorkspaceResource";

export function HubPage({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="hub-page">
      <header className="hub-heading">
        <div>
          <h1>{title}</h1>
          {description && <p className="hub-description">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}
export function HubPanel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`hub-panel ${className}`}>
      <header className="hub-panel-heading">
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  );
}
export function HubDisclosure({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`hub-create ${className}`}>
      <summary>
        {title}
        <Icon name="chevron" />
      </summary>
      <div className="hub-create-content">{children}</div>
    </details>
  );
}
export function FilterDisclosure({
  count,
  children,
  label = "Filtros",
}: {
  count: number;
  children: ReactNode;
  label?: string;
}) {
  return (
    <details className="hub-filter-disclosure">
      <summary>
        {label}
        {count > 0 ? ` (${count})` : ""}
      </summary>
      {children}
    </details>
  );
}
export function ResourceState({
  loading,
  error,
  retry,
  empty,
  children,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
  empty?: { title: string; text: string };
  children: ReactNode;
}) {
  if (loading)
    return (
      <div
        role="status"
        aria-label="Carregando workspace"
        className="hub-loading"
      >
        <div className="skeleton h-6 w-2/3" />
        <div className="skeleton h-24" />
        <span>Carregando…</span>
      </div>
    );
  if (error)
    return (
      <div role="alert" className="hub-empty hub-error">
        <Icon name="shield" />
        <h3>Não foi possível atualizar</h3>
        <p>{error}</p>
        <Button onClick={retry}>Tentar novamente</Button>
      </div>
    );
  if (empty)
    return (
      <div className="hub-empty">
        <Icon name="studio" />
        <h3>{empty.title}</h3>
        <p>{empty.text}</p>
      </div>
    );
  return children;
}
export function MutationFeedback({
  error,
  message,
}: {
  error: string;
  message: string;
}) {
  return (
    <>
      {error && (
        <p className="hub-feedback text-danger" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="hub-feedback text-success" role="status">
          {message}
        </p>
      )}
    </>
  );
}
export function useHubFilters() {
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const params = new URLSearchParams(search.toString());
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(search.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "offset") {
      next.delete("offset");
      if (key !== "task_id") next.delete("task_id");
    }
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  return { params, change, key: search.toString() };
}
export function QuerySearch({
  current,
  commit,
  label = "Buscar",
  placeholder = "Buscar",
}: {
  current: string;
  commit: (value: string) => void;
  label?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState(current),
    [composing, setComposing] = useState(false);
  const latest = useRef(commit);
  latest.current = commit;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setValue(current), [current]);
  useEffect(() => {
    if (composing || value === current) return;
    const timer = setTimeout(
      () => latest.current(value.trim()),
      value ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [value, current, composing]);
  return (
    <form
      role="search"
      noValidate
      className="hub-search"
      onSubmit={(e) => {
        e.preventDefault();
        if (!composing) latest.current(value.trim());
      }}
    >
      <Icon name="search" />
      <input
        ref={input}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (composing || e.nativeEvent.isComposing))
            e.preventDefault();
        }}
        maxLength={200}
      />
      {value && (
        <button
          type="button"
          aria-label="Limpar busca"
          onClick={() => {
            setValue("");
            latest.current("");
            input.current?.focus();
          }}
        >
          ×
        </button>
      )}
    </form>
  );
}
export function ProjectField({
  value,
  onChange,
  label = "Projeto",
  allLabel = "Todos os projetos",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  allLabel?: string;
}) {
  const resource = useWorkspaceResource(
    (signal) => workspaceApi.projects({ limit: 100 }, signal),
    "project-options",
  );
  const id = useId();
  return (
    <label className="hub-label">
      {label}
      <select
        className="field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
      >
        <option value="">{allLabel}</option>
        {value && !resource.data?.items.some((p) => p.name === value) && (
          <option value={value}>{value}</option>
        )}
        {resource.data?.items.map((project) => (
          <option key={project.name} value={project.name}>
            {project.name}
          </option>
        ))}
      </select>
      <span id={`${id}-hint`} className="hub-field-hint">
        {resource.error
          ? "Projetos indisponíveis. Atualize a página para tentar novamente."
          : (resource.data?.total ?? 0) > 100
            ? "Lista dos primeiros 100 projetos. Outros ficam acessíveis pela página do projeto."
            : ""}
      </span>
    </label>
  );
}
export function Pagination({
  page,
  change,
}: {
  page: Pick<Page<unknown>, "offset" | "limit" | "total"> | null;
  change: (offset: string) => void;
}) {
  if (!page || page.total <= page.limit) return null;
  return (
    <nav className="hub-pagination" aria-label="Paginação">
      <span>
        {page.offset + 1} a {Math.min(page.total, page.offset + page.limit)} de{" "}
        {page.total}
      </span>
      <Button
        size="sm"
        disabled={!page.offset}
        onClick={() => change(String(Math.max(0, page.offset - page.limit)))}
      >
        Anterior
      </Button>
      <Button
        size="sm"
        disabled={page.offset + page.limit >= page.total}
        onClick={() => change(String(page.offset + page.limit))}
      >
        Próxima
      </Button>
    </nav>
  );
}
export function SourceList({
  sources,
  compact = false,
}: {
  sources: Source[];
  compact?: boolean;
}) {
  if (!sources.length) return null;
  return (
    <details className="hub-sources">
      <summary>
        Conferir fontes · {sources.length}
        {sources.some((source) => source.stale) ? " · fonte alterada" : ""}
      </summary>
      <ul>
        {sources.map((source) => (
          <li key={source.segment_id}>
            <Link href={sourceUrl(source)} className="hub-source-link">
              <Icon name="studio" />
              <span>
                {source.stale ? "Conferir fonte atual" : "Ouvir trecho"} ·{" "}
                {formatTimestamp(source.start)}
                <small>
                  {source.title} · {source.speaker}
                </small>
              </span>
              <Icon name="arrow" />
            </Link>
            {!compact && <blockquote>{source.text}</blockquote>}
            {source.stale && (
              <p className="text-warning text-xs">
                O texto original foi alterado. Confira novamente este trecho.
              </p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
