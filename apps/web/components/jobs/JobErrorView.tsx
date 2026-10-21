"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, ApiError } from "@/lib/api";
import type { TranscriptionJob } from "@/lib/types";

import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { StatusIcon } from "@/components/ui/StatusIcon";

export function JobErrorView({ job }: { job: TranscriptionJob }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFailed = job.status === "failed";

  const handleRetry = async () => {
    setRetrying(true);
    setError(null);
    try {
      await api.retryJob(job.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao reprocessar");
      setRetrying(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-6 py-16 text-center"
    >
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.1 }}
        className="rounded-full bg-surface-interactive p-4"
      >
        <StatusIcon status={job.status} size={32} />
      </motion.div>
      <h1 className="font-[var(--font-display)] text-2xl text-text-primary">
        {isFailed ? "Não foi possível concluir a transcrição" : "Trabalho cancelado"}
      </h1>
      {isFailed && job.error_message && (
        <Panel raised className="mx-auto max-w-md p-4 text-left text-sm text-text-secondary">
          {job.error_message}
        </Panel>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="mx-auto">
        <Button variant="primary" onClick={handleRetry} disabled={retrying}>
          {retrying ? "Reiniciando…" : "Tentar novamente"}
        </Button>
      </div>
    </motion.div>
  );
}
