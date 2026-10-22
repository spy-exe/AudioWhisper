"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { QueueStatus } from "@/lib/types";

const POLL_MS = 8000;

/** What the local engine is doing, visible from any page. Polling pauses in background tabs. */
export function QueueIndicator() {
  const [status, setStatus] = useState<QueueStatus | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      api
        .queue()
        .then((next) => {
          if (active) setStatus(next);
        })
        .catch(() => {
          if (active) setStatus(null);
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  if (!status) return null;
  if (status.error)
    return (
      <span role="status" className="queue-pill queue-warning">
        Fila indisponível
      </span>
    );
  const busy = status.active_count + status.pending_documents;
  if (!busy) return null;
  const stalled = !status.worker_online;
  const label = stalled
    ? `${busy} aguardando · motor parado`
    : `${busy} em processamento`;
  return (
    <Link
      href="/library?status=active"
      className={`queue-pill ${stalled ? "queue-warning" : ""}`}
      aria-label={`${label}. Ver na biblioteca`}
      title={status.active_jobs[0] ? `Agora: ${status.active_jobs[0].title}` : undefined}
    >
      <span aria-hidden="true" className="queue-dot" />
      {label}
    </Link>
  );
}
