"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { api, describeError } from "@/lib/api";
import type { TranscriptionJob } from "@/lib/types";

import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { StatusIcon } from "@/components/ui/StatusIcon";

export function JobErrorView({
  job,
  onRetried,
}: {
  job: TranscriptionJob;
  onRetried: (job: TranscriptionJob) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFailed = job.status === "failed";

  const handleRetry = async () => {
    setRetrying(true);
    setError(null);
    try {
      // The page keeps its own job state: hand the requeued job back instead of a server refresh,
      // which would leave this error view on screen.
      onRetried(await api.retryJob(job.id));
    } catch (err) {
      setError(describeError(err, "Falha ao reprocessar. Tente novamente."));
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
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mx-auto flex flex-wrap justify-center gap-3">
        <Button variant="primary" onClick={handleRetry} disabled={retrying}>
          {retrying ? "Reiniciando…" : "Tentar novamente"}
        </Button>
        <Link href="/library" className="inline-flex min-h-12 items-center px-4 text-sm text-text-secondary hover:text-accent">
          Voltar à biblioteca
        </Link>
      </div>
    </motion.div>
  );
}
