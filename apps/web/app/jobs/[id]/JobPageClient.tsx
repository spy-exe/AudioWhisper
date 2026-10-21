"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { MediaFile, TranscriptionJob } from "@/lib/types";
import { useJobProgress } from "@/hooks/useJobProgress";

import { JobErrorView } from "@/components/jobs/JobErrorView";
import { ProcessingView } from "@/components/jobs/ProcessingView";
import { TranscriptEditor } from "@/components/editor/TranscriptEditor";

export function JobPageClient({ jobId }: { jobId: string }) {
  const { job: liveJob, newSegments, provisionalSegments, connectionError } = useJobProgress(jobId);
  const [initialJob, setInitialJob] = useState<TranscriptionJob | null>(null);
  const [media, setMedia] = useState<MediaFile | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api
      .getJob(jobId)
      .then(setInitialJob)
      .catch(() => setNotFound(true));
  }, [jobId]);

  const job = liveJob ?? initialJob;

  useEffect(() => {
    if (job?.status === "completed" && !media) {
      api.getMedia(job.media_file_id).then(setMedia).catch(() => undefined);
    }
  }, [job?.status, job?.media_file_id, media]);

  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center text-text-secondary">
        Trabalho não encontrado.
      </div>
    );
  }

  if (!job) {
    return <div className="mx-auto max-w-2xl px-6 py-16 text-center text-text-muted">Carregando…</div>;
  }

  if (job.status === "failed" || job.status === "cancelled") {
    return <JobErrorView job={job} />;
  }

  if (job.status === "completed") {
    if (!media) {
      return <div className="mx-auto max-w-2xl px-6 py-16 text-center text-text-muted">Carregando transcrição…</div>;
    }
    return <TranscriptEditor jobId={jobId} media={media} />;
  }

  return <ProcessingView job={job} newSegments={newSegments} provisionalSegments={provisionalSegments} connectionError={connectionError} />;
}
