"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type {
  ProgressEvent,
  TranscriptionJob,
  TranscriptSegment,
} from "@/lib/types";
import { TERMINAL_STATUSES } from "@/lib/types";

export function mergeSegments(
  previous: TranscriptSegment[],
  incoming: TranscriptSegment[],
) {
  const segments = new Map(previous.map((segment) => [segment.id, segment]));
  for (const segment of incoming) {
    const existing = segments.get(segment.id);
    if (
      !existing ||
      Date.parse(segment.updated_at) >= Date.parse(existing.updated_at)
    )
      segments.set(segment.id, segment);
  }
  return [...segments.values()].sort(
    (a, b) => a.segment_index - b.segment_index,
  );
}

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** `attempt` restarts the subscription, e.g. after a terminal job is retried in place. */
export function useJobProgress(jobId: string | null, attempt = 0) {
  const [job, setJob] = useState<TranscriptionJob | null>(null);
  const [eta, setEta] = useState<number | null>(null);
  const [newSegments, setSegments] = useState<TranscriptSegment[]>([]);
  const [provisionalSegments, setProvisional] = useState<TranscriptSegment[]>(
    [],
  );
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    setJob(null);
    setSegments([]);
    setProvisional([]);
    setConnectionError(null);
    setEta(null);
    if (!jobId) return;
    let disposed = false;
    let terminal = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let syncing = false;
    let attemptStarted: string | null = null;

    const acceptJob = (next: TranscriptionJob) => {
      if (disposed) return;
      if (attemptStarted && next.started_at !== attemptStarted) setSegments([]);
      attemptStarted = next.started_at;
      terminal = isTerminal(next.status);
      setJob(next);
    };
    const reconcile = async () => {
      if (disposed || syncing || terminal) return;
      syncing = true;
      try {
        const nextJob = await api.getJob(jobId);
        const segments = await api.getSegments(jobId);
        if (disposed) return;
        acceptJob(nextJob);
        setSegments((previous) => mergeSegments(previous, segments));
      } catch {
        if (!disposed)
          setConnectionError(
            "Conexão interrompida. Reconectando e recuperando os trechos salvos…",
          );
      } finally {
        syncing = false;
      }
    };
    const connect = () => {
      if (disposed || terminal) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${protocol}//${window.location.host}/ws/jobs/${jobId}`,
      );
      socket.onmessage = (event: MessageEvent<string>) => {
        if (disposed) return;
        try {
          const data = JSON.parse(event.data) as ProgressEvent;
          if (data.type === "error") {
            setConnectionError(
              data.message ?? "Falha ao acompanhar a transcrição",
            );
            return;
          }
          attempts = 0;
          setConnectionError(null);
          if (data.type === "snapshot" && data.job) {
            acceptJob(data.job);
            setSegments(data.segments ?? []);
          } else if (data.type === "progress") {
            terminal = data.status ? isTerminal(data.status) : terminal;
            setEta(terminal ? null : (data.eta_seconds ?? null));
            setJob((previous) =>
              previous
                ? {
                    ...previous,
                    status: data.status ?? previous.status,
                    progress: data.progress ?? previous.progress,
                    current_stage: data.current_stage ?? previous.current_stage,
                    language_detected:
                      data.language_detected ?? previous.language_detected,
                    error_code: data.error_code ?? previous.error_code,
                    error_message: data.error_message ?? previous.error_message,
                  }
                : previous,
            );
            if (data.new_segments)
              setSegments((previous) =>
                mergeSegments(previous, data.new_segments!),
              );
          }
          if (data.provisional_segments)
            setProvisional(data.provisional_segments);
          if (terminal) {
            setProvisional([]);
            void api
              .getSegments(jobId)
              .then((s) => {
                if (!disposed) setSegments(s);
              })
              .catch(() => undefined);
          }
        } catch {
          setConnectionError(
            "Atualização inválida. Recuperando a transcrição salva…",
          );
          void reconcile();
        }
      };
      socket.onerror = () => {
        if (!disposed) setConnectionError("Reconectando à transcrição…");
      };
      socket.onclose = () => {
        if (disposed || terminal) return;
        setConnectionError("Reconectando e recuperando os trechos salvos…");
        void reconcile();
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 10000));
      };
    };
    void reconcile();
    connect();
    const poll = setInterval(reconcile, 5000);
    return () => {
      disposed = true;
      clearInterval(poll);
      clearTimeout(retry);
      socket?.close();
    };
  }, [jobId, attempt]);

  return { job, newSegments, provisionalSegments, connectionError, eta };
}
