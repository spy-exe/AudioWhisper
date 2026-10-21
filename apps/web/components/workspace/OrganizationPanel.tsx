"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Organization } from "@/lib/types";
import { Button } from "@/components/ui/Button";

export function OrganizationPanel({
  jobId,
  value,
  onChange,
  onDiarized,
}: {
  jobId: string;
  value: Organization | null;
  onChange: (value: Organization) => void;
  onDiarized: () => void;
}) {
  const [draft, setDraft] = useState<Organization | null>(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (value) setDraft(value);
  }, [value]);
  const running =
    value?.diarization_status === "queued" ||
    value?.diarization_status === "processing";
  useEffect(() => {
    if (!running) return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const next = await api.organization(jobId);
        if (!active) return;
        onChange(next);
        if (next.diarization_status === "completed") onDiarized();
      } catch {
        if (active)
          setError("Não foi possível atualizar a identificação de falantes.");
      }
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [jobId, running, onChange, onDiarized]);
  if (!draft)
    return (
      <div
        className="skeleton h-12"
        role="status"
        aria-label="Carregando organização"
      />
    );
  const update = (field: keyof Organization, text: string) =>
    setDraft({
      ...draft,
      [field]:
        field === "tags"
          ? text
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
          : text,
    });
  return (
    <details className="rounded-xl border border-border bg-surface">
      <summary className="px-5 py-4 text-sm font-medium hover:bg-surface-raised">
        Organizar conversa e participantes
      </summary>
      <div className="space-y-4 border-t border-border p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["title", "Título"],
              ["folder", "Pasta"],
              ["project", "Projeto"],
            ] as const
          ).map(([field, label]) => (
            <label key={field} className="text-xs text-text-secondary">
              {label}
              <input
                className="field mt-1"
                value={draft[field]}
                onChange={(e) => update(field, e.target.value)}
                maxLength={field === "title" ? 512 : 128}
              />
            </label>
          ))}
          <label className="text-xs text-text-secondary">
            Tags, separadas por vírgula
            <input
              className="field mt-1"
              defaultValue={draft.tags.join(", ")}
              onBlur={(e) => update("tags", e.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div>
            <h3 className="text-sm font-medium">Participantes</h3>
            <p className="mt-1 text-xs text-text-muted">
              Identifique os falantes localmente e revise seus nomes.
            </p>
          </div>
          <Button
            size="sm"
            disabled={busy || running}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api.diarize(jobId);
                onChange(await api.organization(jobId));
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Falha ao identificar falantes.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {running ? "Identificando falantes…" : "Identificar falantes"}
          </Button>
        </div>
        {Object.entries(draft.speakers).map(([id, name], i) => (
          <label
            key={id}
            className="flex items-center gap-3 text-xs text-text-muted"
          >
            <span
              className={`size-2 shrink-0 rounded-full ${i % 2 ? "bg-accent-violet" : "bg-accent-spectral"}`}
            />
            <span className="w-24 truncate" title={id}>
              {id}
            </span>
            <input
              className="field"
              aria-label={`Nome de ${id}`}
              value={name}
              maxLength={128}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  speakers: { ...draft.speakers, [id]: e.target.value },
                })
              }
            />
          </label>
        ))}
        {value?.diarization_error && (
          <p role="alert" className="text-xs text-warning">
            {value.diarization_error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const next = await api.organize(jobId, draft);
                onChange(next);
                setStatus("Organização salva.");
              } catch {
                setError(
                  "Não foi possível salvar a organização. Seus valores foram preservados.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Salvar organização
          </Button>
          {status && (
            <span role="status" className="text-xs text-success">
              {status}
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
