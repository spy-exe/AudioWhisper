"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, describeError } from "@/lib/api";
import { LANGUAGE_OPTIONS, MODEL_OPTIONS } from "@/lib/constants";
import { formatBytes, formatDuration } from "@/lib/format";
import { transcriptionSettingsFrom } from "@/lib/transcription-settings";
import type { AppSettings, MediaFile } from "@/lib/types";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";

export interface UploadItemState {
  clientId: string;
  file: File;
  progress: number;
  status: "uploading" | "ready" | "error" | "starting";
  media?: MediaFile;
  error?: string;
}

interface UploadQueueItemProps {
  item: UploadItemState;
  appSettings: AppSettings | null;
  onRemove: (clientId: string) => void;
}

export function UploadQueueItem({ item, appSettings, onRemove }: UploadQueueItemProps) {
  const router = useRouter();
  const [model, setModel] = useState(appSettings?.default_model ?? "turbo");
  const [language, setLanguage] = useState(appSettings?.default_language ?? "");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleStart = async () => {
    if (!item.media) return;
    setStarting(true);
    setStartError(null);
    try {
      const job = await api.createJob(
        item.media.id,
        transcriptionSettingsFrom(appSettings, { model_name: model, language: language || null }),
      );
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setStartError(describeError(err, "Falha ao iniciar transcrição. Tente novamente."));
      setStarting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-raised p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-text-primary">{item.file.name}</p>
          {item.media?.is_duplicate && <Badge tone="warning">duplicado</Badge>}
          {item.status === "error" && <Badge tone="danger">erro</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-text-muted">
          {formatBytes(item.file.size)}
          {item.media?.duration_seconds != null && ` · ${formatDuration(item.media.duration_seconds)}`}
          {item.media && ` · ${item.media.media_type === "video" ? "vídeo" : "áudio"}`}
        </p>

        {item.status === "uploading" && (
          <div className="mt-2 flex items-center gap-2">
            <ProgressBar value={item.progress / 100} className="max-w-xs" />
            <span className="text-xs text-text-muted">{item.progress}%</span>
          </div>
        )}

        {item.status === "error" && (
          <p className="mt-1 text-xs text-danger">{item.error}</p>
        )}

        {startError && <p className="mt-1 text-xs text-danger">{startError}</p>}
      </div>

      {item.status === "ready" && item.media && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Modelo"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-md border border-border bg-surface-interactive px-2 py-1.5 text-xs text-text-primary"
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Idioma"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="rounded-md border border-border bg-surface-interactive px-2 py-1.5 text-xs text-text-primary"
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <Button variant="primary" size="sm" onClick={handleStart} disabled={starting}>
            {starting ? "Iniciando…" : "Transcrever"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onRemove(item.clientId)}>
            Remover
          </Button>
        </div>
      )}

      {(item.status === "uploading" || item.status === "error") && (
        <Button variant="ghost" size="sm" onClick={() => onRemove(item.clientId)}>
          {item.status === "uploading" ? "Cancelar" : "Remover"}
        </Button>
      )}
    </div>
  );
}
