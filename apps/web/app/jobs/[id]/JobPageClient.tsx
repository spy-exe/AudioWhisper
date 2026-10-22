"use client";

import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { signalQueueChanged } from "@/lib/events";
import { notifyJobFinished, progressTitle } from "@/lib/notifications";
import type { MediaFile, TranscriptionJob } from "@/lib/types";
import { isTerminal, useJobProgress } from "@/hooks/useJobProgress";
import { useSettings } from "@/contexts/SettingsContext";

import { JobErrorView } from "@/components/jobs/JobErrorView";
import { ProcessingView } from "@/components/jobs/ProcessingView";
import { TranscriptEditor } from "@/components/editor/TranscriptEditor";

const DEFAULT_TITLE = "AudioWhisper 2.1 · Studio";

export function JobPageClient({ jobId }: { jobId: string }) {
  const [attempt, setAttempt] = useState(0);
  const {
    job: liveJob,
    newSegments,
    provisionalSegments,
    connectionError,
    eta,
  } = useJobProgress(jobId, attempt);
  const { settings } = useSettings();
  const [initialJob, setInitialJob] = useState<TranscriptionJob | null>(null);
  const [media, setMedia] = useState<MediaFile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const previousStatus = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setInitialJob(null);
    setMedia(null);
    setNotFound(false);
    previousStatus.current = null;
    api
      .getJob(jobId)
      .then((value) => {
        if (active) setInitialJob(value);
      })
      .catch(() => {
        if (active) setNotFound(true);
      });
    return () => {
      active = false;
    };
  }, [jobId]);

  const job =
    (liveJob?.id === jobId ? liveJob : null) ??
    (initialJob?.id === jobId ? initialJob : null);
  const mediaId = job?.media_file_id;
  useEffect(() => {
    if (!mediaId || media?.id === mediaId) return;
    let active = true;
    api
      .getMedia(mediaId)
      .then((value) => {
        if (active) setMedia(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [mediaId, media?.id]);

  // Progress in the tab title, and a notification when a long run ends while the tab is hidden.
  useEffect(() => {
    if (!job) return;
    const name = media?.original_name ?? "AudioWhisper";
    if (!isTerminal(job.status))
      document.title = progressTitle(`${name} · AudioWhisper`, job.progress);
    else document.title = `${name} · AudioWhisper`;
    const previous = previousStatus.current;
    previousStatus.current = job.status;
    if (previous && !isTerminal(previous) && isTerminal(job.status)) {
      signalQueueChanged();
      if (settings?.notifications_enabled) notifyJobFinished(name, job.status);
    }
  }, [job, media, settings?.notifications_enabled]);

  useEffect(
    () => () => {
      document.title = DEFAULT_TITLE;
    },
    [],
  );

  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center text-text-secondary">
        Trabalho não encontrado.
      </div>
    );
  }

  if (!job) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center text-text-muted">
        Carregando…
      </div>
    );
  }

  if (job.status === "failed" || job.status === "cancelled") {
    return (
      <JobErrorView
        job={job}
        onRetried={(next) => {
          signalQueueChanged();
          previousStatus.current = next.status;
          setInitialJob(next);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  if (job.status === "completed") {
    if (!media || media.id !== job.media_file_id) {
      return (
        <div className="mx-auto max-w-2xl px-6 py-16 text-center text-text-muted">
          Carregando transcrição…
        </div>
      );
    }
    return (
      <TranscriptEditor
        key={jobId}
        jobId={jobId}
        media={media}
        modelName={job.model_name}
      />
    );
  }

  return (
    <ProcessingView
      job={job}
      newSegments={newSegments}
      provisionalSegments={provisionalSegments}
      connectionError={connectionError}
      eta={eta}
    />
  );
}
