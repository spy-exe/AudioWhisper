"use client";
import { useState } from "react";
import { api, describeError } from "@/lib/api";
import { formatTimestamp } from "@/lib/format";
import type { AIDocument, TranscriptSegment } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SharePanel } from "./SharePanel";
import { DocumentContent } from "./DocumentContent";

export function DocumentView({
  document,
  segments,
  onSource,
  onChange,
}: {
  document: AIDocument;
  segments: TranscriptSegment[];
  onSource: (id: string) => void;
  onChange: () => void;
}) {
  const [draft, setDraft] = useState(document.markdown);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const changed = draft !== document.markdown;
  const save = async (reviewed: boolean) => {
    setBusy(true);
    setError("");
    try {
      await api.reviewDocument(document.id, draft, reviewed);
      setStatus(
        reviewed
          ? "Revisão confirmada. Compartilhamento habilitado."
          : "Rascunho salvo.",
      );
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar documento.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          tone={document.reviewed_at && !document.stale ? "success" : "warning"}
        >
          {document.stale
            ? "Fonte alterada"
            : document.reviewed_at
              ? "Revisado"
              : "Rascunho · revisar"}
        </Badge>
        <span className="text-xs text-text-muted">{document.model}</span>
      </div>
      {document.stale && (
        <p role="alert" className="text-xs leading-relaxed text-warning">
          A transcrição mudou após a geração. Gere um novo documento para usar
          as fontes atuais e compartilhar.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => setEditing(!editing)}
          aria-expanded={editing}
        >
          {editing ? "Ver documento" : "Editar documento"}
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(draft);
              setStatus("Documento copiado.");
            } catch {
              setError(
                "Não foi possível copiar. Abra a edição e selecione o texto.",
              );
            }
          }}
        >
          Copiar
        </Button>
        <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
          Excluir
        </Button>
        <details className="relative">
          <summary className="rounded-md border border-border px-3 py-1 text-xs text-text-secondary hover:bg-surface-interactive">
            Exportar
          </summary>
          <div className="absolute right-0 z-10 mt-2 flex min-w-32 flex-col rounded-lg border border-border bg-surface-raised p-2 shadow-lg">
            {["pdf", "docx", "markdown", "txt", "json"].map((format) => (
              <a
                key={format}
                className="rounded p-2 text-xs hover:bg-surface-interactive"
                href={api.documentDownloadUrl(document.id, format)}
                download
              >
                {format.toUpperCase()}
              </a>
            ))}
          </div>
        </details>
      </div>
      {editing ? (
        <label className="block text-xs text-text-secondary">
          Revisar texto
          <textarea
            className="field mt-2 min-h-80 resize-none leading-relaxed"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
      ) : (
        <div className="max-h-[65vh] overflow-y-auto rounded-xl border border-border bg-background/40 p-5">
          <DocumentContent content={draft} headingLevel={3} />
        </div>
      )}
      {document.items.length > 0 && (
        <details open>
          <summary className="text-xs font-semibold text-text-secondary">
            Verificar fontes ({document.items.length})
          </summary>
          <ul className="mt-3 max-h-72 space-y-3 overflow-y-auto">
            {document.items.map((item, index) => (
              <li
                key={index}
                className="rounded-lg border border-border bg-background/50 p-3"
              >
                <p className="text-sm leading-relaxed">{item.text}</p>
                {item.kind === "action" && (
                  <p className="mt-2 text-xs text-text-muted">
                    {item.assignee || "Responsável não identificado"} ·{" "}
                    {item.due_date || "Prazo não definido"}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.source_segment_ids.map((id) => {
                    const source = segments.find(
                      (segment) => segment.id === id,
                    );
                    return (
                      <button
                        key={id}
                        disabled={!source || document.stale}
                        onClick={() => onSource(id)}
                        className="rounded border border-accent/30 px-2 py-1 font-mono text-xs text-accent hover:bg-accent/10 disabled:opacity-40"
                        aria-label={
                          source
                            ? `Ouvir fonte em ${formatTimestamp(source.start)}`
                            : "Fonte indisponível"
                        }
                      >
                        {source
                          ? `↗ ${formatTimestamp(source.start)}`
                          : "Fonte alterada"}
                      </button>
                    );
                  })}
                </div>
                <blockquote className="mt-2 border-l border-border pl-2 text-xs italic text-text-muted">
                  {item.evidence_quotes.join(" · ")}
                </blockquote>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="space-y-3 border-t border-border pt-4">
        <p className="text-xs leading-relaxed text-text-muted">
          Confira o texto e as fontes antes de confirmar a revisão.
        </p>
        <div className="flex flex-wrap gap-2">
          {changed && (
            <Button
              size="sm"
              disabled={busy || document.stale}
              onClick={() => save(false)}
            >
              Salvar rascunho
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            disabled={busy || document.stale || !draft.trim()}
            onClick={() => save(true)}
          >
            {busy ? "Salvando…" : "Confirmar revisão"}
          </Button>
        </div>
      </div>
      {status && (
        <p role="status" className="text-xs text-success">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {document.status === "reviewed" && !document.stale && !changed && (
        <SharePanel document={document} />
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Excluir este documento?"
        description="O rascunho, a revisão e todos os links privados deste documento deixam de existir. A transcrição não é alterada."
        confirmLabel="Excluir documento"
        danger
        onConfirm={async () => {
          try {
            await api.deleteDocument(document.id);
          } catch (failure) {
            throw new Error(describeError(failure, "Não foi possível excluir o documento."));
          }
          onChange();
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
