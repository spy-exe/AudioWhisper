"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatDuration, statusLabel } from "@/lib/format";
import type {
  MediaFile,
  TranscriptionJob,
  TranscriptSegment,
} from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { TranscriptFeed } from "./TranscriptFeed";

const stages = [
  "queued",
  "preparing",
  "extracting_audio",
  "loading_model",
  "transcribing",
  "generating_exports",
];
export function ProcessingView({
  job,
  newSegments,
  provisionalSegments = [],
  connectionError,
}: {
  job: TranscriptionJob;
  newSegments: TranscriptSegment[];
  provisionalSegments?: TranscriptSegment[];
  connectionError: string | null;
}) {
  const [media, setMedia] = useState<MediaFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelledJobId, setCancelledJobId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const cancellationRequested = cancelledJobId === job.id || job.cancel_requested;
  useEffect(() => {
    let active = true;
    api
      .getMedia(job.media_file_id)
      .then((m) => {
        if (active) setMedia(m);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [job.media_file_id]);
  const live = media?.metadata?.live === true;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-8">
      <Link
        href="/library"
        className="text-xs text-text-muted hover:text-accent"
      >
        ← Biblioteca
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-2 text-xs uppercase tracking-widest text-accent">
            {live ? "Captura ao vivo" : "Processamento local"}
          </p>
          <h1 className="break-words font-[var(--font-display)] text-2xl font-semibold">
            {media?.original_name ?? "Preparando gravação…"}
          </h1>
          <p className="mt-2 text-xs text-text-muted">
            {job.model_name} · {job.device.toUpperCase()}
            {media?.duration_seconds != null &&
              ` · ${formatDuration(media.duration_seconds)}`}
          </p>
        </div>
        <Badge tone="accent">{statusLabel(job.status)}</Badge>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <TranscriptFeed
          segments={newSegments}
          provisional={provisionalSegments}
          pending={job.status === "transcribing"}
        />
        <aside className="space-y-5 rounded-xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold">
            {live ? "Estado da captura" : "Acompanhar processamento"}
          </h2>
          {!live && <ProgressBar value={job.progress} />}
          <p role="status" className="text-sm text-text-secondary">
            {cancellationRequested
              ? "Cancelamento solicitado. Aguardando o motor liberar a etapa atual."
              : (job.current_stage ?? statusLabel(job.status))}
          </p>
          {!live && (
            <ol className="space-y-3">
              {stages.map((stage, index) => (
                <li
                  key={stage}
                  className={`flex items-center gap-3 text-xs ${index <= stages.indexOf(job.status) ? "text-text-primary" : "text-text-muted"}`}
                >
                  <span className="font-mono text-accent">
                    {index < stages.indexOf(job.status)
                      ? "✓"
                      : String(index + 1).padStart(2, "0")}
                  </span>
                  {statusLabel(stage)}
                </li>
              ))}
            </ol>
          )}
          {live && (
            <Link
              href={`/?capture=${job.id}`}
              className="block text-sm text-accent hover:underline"
            >
              Recuperar controle da captura →
            </Link>
          )}
          {connectionError && (
            <p role="status" className="text-xs leading-relaxed text-warning">
              {connectionError}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <Button
            variant="danger"
            className="w-full"
            disabled={busy || cancellationRequested}
            onClick={async () => {
              setBusy(true);
              try {
                await api.cancelJob(job.id);
                setCancelledJobId(job.id);
              } catch {
                setError("Não foi possível cancelar. Tente novamente.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {cancellationRequested
              ? "Aguardando cancelamento…"
              : busy ? "Cancelando…" : "Cancelar"}
          </Button>
        </aside>
      </div>
    </div>
  );
}
