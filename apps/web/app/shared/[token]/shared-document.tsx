"use client";
import { useEffect, useState } from "react";
import { DocumentContent } from "@/components/workspace/DocumentContent";
export function SharedDocument({ token }: { token: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/shared/${encodeURIComponent(token)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((r) => setContent(r.markdown))
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [token]);
  return (
    <article className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-3 text-2xl">Documento compartilhado</h1>
      <p className="mb-8 text-sm text-text-muted">
        Revisado pelo autor · Somente leitura
      </p>
      {error ? (
        <p role="alert">
          Este link expirou, foi revogado ou o documento precisa de uma nova
          revisão.
        </p>
      ) : content === null ? (
        <div
          className="skeleton h-80"
          role="status"
          aria-label="Carregando documento"
        />
      ) : (
        <div className="studio-panel rounded-2xl border border-border bg-surface p-6 sm:p-8">
          <DocumentContent content={content} />
        </div>
      )}
    </article>
  );
}
