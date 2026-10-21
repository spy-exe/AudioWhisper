import Link from "next/link";
import { motion } from "motion/react";

import { formatRelativeTime, statusLabel } from "@/lib/format";
import type { TranscriptionJob } from "@/lib/types";

import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusIcon } from "@/components/ui/StatusIcon";

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "accent"> = {
  queued: "neutral",
  preparing: "accent",
  extracting_audio: "accent",
  loading_model: "accent",
  transcribing: "accent",
  generating_exports: "accent",
  completed: "success",
  failed: "danger",
  cancelled: "warning",
};

export function JobCard({ job }: { job: TranscriptionJob }) {
  const inProgress = !["completed", "failed", "cancelled"].includes(job.status);

  return (
    <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 400, damping: 25 }}>
      <Link
        href={`/jobs/${job.id}`}
        className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 no-underline transition-colors hover:border-accent/50"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2 truncate text-sm font-medium text-text-primary">
            <StatusIcon status={job.status} size={16} />
            {job.model_name}
          </span>
          <Badge tone={STATUS_TONE[job.status] ?? "neutral"}>{statusLabel(job.status)}</Badge>
        </div>
        {inProgress && <ProgressBar value={job.progress} />}
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>{job.current_stage ?? "—"}</span>
          <span>{formatRelativeTime(job.updated_at)}</span>
        </div>
      </Link>
    </motion.div>
  );
}
