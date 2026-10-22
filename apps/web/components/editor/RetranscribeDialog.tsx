"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, describeError } from "@/lib/api";
import { LANGUAGE_OPTIONS, MODEL_OPTIONS } from "@/lib/constants";
import { signalQueueChanged } from "@/lib/events";
import { transcriptionSettingsFrom } from "@/lib/transcription-settings";
import { useSettings } from "@/contexts/SettingsContext";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

interface RetranscribeDialogProps {
  open: boolean;
  jobId: string;
  currentModel: string;
  onClose: () => void;
}

/** A new run on the same media: the current transcript, edits and documents are kept. */
export function RetranscribeDialog({ open, jobId, currentModel, onClose }: RetranscribeDialogProps) {
  const router = useRouter();
  const { settings } = useSettings();
  const [model, setModel] = useState<string>(
    MODEL_OPTIONS.find((option) => option.value !== currentModel)?.value ?? "turbo",
  );
  const [language, setLanguage] = useState(settings?.default_language ?? "");
  const [vocabulary, setVocabulary] = useState(settings?.vocabulary ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <Dialog
      open={open}
      title="Transcrever novamente"
      description="Cria uma nova versão a partir do arquivo original. Esta transcrição, suas edições e documentos continuam na biblioteca."
      onClose={() => !busy && onClose()}
    >
      <form
        className="mt-5 flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const job = await api.retranscribe(
              jobId,
              transcriptionSettingsFrom(settings, {
                model_name: model,
                language: language || null,
                initial_prompt: vocabulary.trim() || null,
              }),
            );
            signalQueueChanged();
            router.push(`/jobs/${job.id}`);
          } catch (failure) {
            setError(describeError(failure, "Não foi possível iniciar a nova transcrição."));
            setBusy(false);
          }
        }}
      >
        <label className="text-sm text-text-secondary">
          Modelo
          <select className="field mt-1" value={model} onChange={(e) => setModel(e.target.value)} data-autofocus>
            {MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
                {option.value === currentModel ? " (atual)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-text-secondary">
          Idioma
          <select className="field mt-1" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-text-secondary">
          Vocabulário (nomes, siglas e termos técnicos)
          <textarea
            className="field mt-1 min-h-20 resize-y"
            maxLength={1000}
            value={vocabulary}
            placeholder="Ex.: Opikode, Trofi, Kubernetes, Ana Paula"
            onChange={(e) => setVocabulary(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Iniciando…" : "Transcrever novamente"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
