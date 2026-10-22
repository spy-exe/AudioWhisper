"use client";
import { useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";
import type { Organization } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export function OrganizationPanel({
  jobId,
  value,
  onChange,
  onDiarized,
  onSegmentsChanged,
}: {
  jobId: string;
  value: Organization | null;
  onChange: (value: Organization) => void;
  onDiarized: () => void;
  onSegmentsChanged?: () => void;
}) {
  const [draft, setDraft] = useState<Organization | null>(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [newSpeaker, setNewSpeaker] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const speakerAction = async (action: () => Promise<Organization>, success: string, fallback: string) => {
    setBusy(true);
    setError("");
    try {
      const next = await action();
      onChange(next);
      setStatus(success);
      onSegmentsChanged?.();
    } catch (failure) {
      setError(describeError(failure, fallback));
    } finally {
      setBusy(false);
    }
  };
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
        {Object.entries(draft.speakers).map(([id, name], i) => {
          const others = Object.entries(value?.speakers ?? {}).filter(([other]) => other !== id);
          return (
            <div key={id} className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
              <label className="flex min-w-0 flex-1 basis-64 items-center gap-3">
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
              {value?.speakers[id] !== undefined && (
                <div className="flex flex-wrap gap-2">
                  {others.length > 0 && (
                    <select
                      className="field w-auto"
                      aria-label={`Mesclar ${name || id} em outro participante`}
                      value=""
                      disabled={busy}
                      onChange={(e) => {
                        const target = e.target.value;
                        if (!target) return;
                        void speakerAction(
                          () => api.mergeSpeakers(jobId, id, target),
                          `${name || id} foi mesclado em ${value?.speakers[target] ?? target}.`,
                          "Não foi possível mesclar os participantes.",
                        );
                      }}
                    >
                      <option value="">Mesclar em…</option>
                      {others.map(([other, otherName]) => (
                        <option key={other} value={other}>
                          {otherName || other}
                        </option>
                      ))}
                    </select>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemoving(id)}>
                    Remover
                  </Button>
                </div>
              )}
            </div>
          );
        })}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const name = newSpeaker.trim();
            if (!name) return;
            void speakerAction(
              async () => {
                const next = await api.addSpeaker(jobId, name);
                setNewSpeaker("");
                return next;
              },
              `${name} adicionado. Atribua os trechos pelo seletor de cada fala ou pela seleção.`,
              "Não foi possível adicionar o participante.",
            );
          }}
        >
          <label className="min-w-0 flex-1 basis-56 text-xs text-text-secondary">
            Adicionar participante manualmente
            <input
              className="field mt-1"
              value={newSpeaker}
              maxLength={128}
              placeholder="Nome de quem fala"
              onChange={(e) => setNewSpeaker(e.target.value)}
            />
          </label>
          <Button type="submit" size="sm" disabled={busy || !newSpeaker.trim()}>
            Adicionar
          </Button>
        </form>
        <ConfirmDialog
          open={removing !== null}
          title="Remover participante?"
          description={`Os trechos atribuídos a ${removing ? (value?.speakers[removing] || removing) : ""} voltam a ficar sem falante. O texto não muda.`}
          confirmLabel="Remover participante"
          danger
          onConfirm={async () => {
            const id = removing!;
            try {
              const next = await api.removeSpeaker(jobId, id);
              onChange(next);
              setStatus("Participante removido.");
              onSegmentsChanged?.();
            } catch (failure) {
              throw new Error(describeError(failure, "Não foi possível remover o participante."));
            }
          }}
          onClose={() => setRemoving(null)}
        />
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
