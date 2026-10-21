"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { GpuDiagnostics } from "@/lib/types";

import { Badge } from "@/components/ui/Badge";
import { useMotionPreference } from "@/hooks/useMotionPreference";

const POLL_INTERVAL_MS = 10_000;

export function GpuStatusBadge() {
  const reduced = useMotionPreference();
  const [diagnostics, setDiagnostics] = useState<GpuDiagnostics | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      api
        .healthGpu()
        .then((d) => {
          if (!cancelled) setDiagnostics(d);
        })
        .catch(() => {
          if (!cancelled) setDiagnostics(null);
        });
    };
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!diagnostics) {
    return <Badge tone="neutral">GPU — verificando…</Badge>;
  }

  if (!diagnostics.gpu_available) {
    return (
      <Badge tone="warning" title={diagnostics.error ?? undefined}>
        CPU
      </Badge>
    );
  }

  const freePct =
    diagnostics.free_memory_mb && diagnostics.total_memory_mb
      ? Math.round((diagnostics.free_memory_mb / diagnostics.total_memory_mb) * 100)
      : null;
  const active = diagnostics.device_in_use === "cuda" && !!diagnostics.loaded_model;

  return (
    <Badge
      tone="success"
      title={active ? `Modelo ativo: ${diagnostics.loaded_model}` : (diagnostics.gpu_name ?? undefined)}
      className="max-w-[40vw] truncate sm:max-w-none"
    >
      {active && (
        <motion.span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-success"
          animate={{ opacity: reduced ? 1 : [1, 0.3, 1] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {diagnostics.gpu_name ?? "GPU"}
      <span className="hidden sm:inline">{freePct !== null && ` · ${freePct}% livre`}</span>
    </Badge>
  );
}
