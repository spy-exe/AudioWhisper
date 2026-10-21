"use client";

import { useEffect, useRef } from "react";
import { clsx } from "clsx";

import { formatTimestamp } from "@/lib/format";
import type { TranscriptSegment } from "@/lib/types";

interface SegmentRowProps {
  segment: TranscriptSegment;
  speakerNames?: Record<string, string>;
  onSpeakerChange?: (
    segment: TranscriptSegment,
    speakerId: string | null,
  ) => void;
  active: boolean;
  selected: boolean;
  isSearchMatch: boolean;
  isCurrentMatch: boolean;
  onSelect: (segmentId: string, shiftKey: boolean) => void;
  onTextChange: (segmentId: string, text: string) => void;
  registerRef: (segmentId: string, el: HTMLDivElement | null) => void;
}

export function SegmentRow({
  segment,
  speakerNames,
  onSpeakerChange,
  active,
  selected,
  isSearchMatch,
  isCurrentMatch,
  onSelect,
  onTextChange,
  registerRef,
}: SegmentRowProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [segment.text]);

  useEffect(() => {
    registerRef(segment.id, containerRef.current);
    return () => registerRef(segment.id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment.id]);

  useEffect(() => {
    if (isCurrentMatch) {
      containerRef.current?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }
  }, [isCurrentMatch]);

  useEffect(() => {
    if (active && document.activeElement !== textareaRef.current) {
      containerRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      className={clsx(
        "group flex flex-col gap-2 rounded-lg px-4 py-3 transition-colors sm:flex-row sm:gap-3",
        active && "bg-accent/10",
        selected && !active && "bg-accent-violet/10",
        isCurrentMatch && "ring-1 ring-accent",
        !active && !selected && "hover:bg-surface-interactive/50",
      )}
    >
      <button
        onClick={(e) => onSelect(segment.id, e.shiftKey)}
        className="mt-0.5 min-h-10 w-fit shrink-0 rounded-lg bg-surface-interactive px-2 py-2 font-mono text-xs text-text-secondary transition-colors hover:bg-accent hover:text-background"
        aria-label={`Ir para ${formatTimestamp(segment.start)}`}
      >
        {formatTimestamp(segment.start)}
      </button>

      <div className="min-w-0 flex-1">
        {speakerNames && Object.keys(speakerNames).length > 0 && (
          <select
            aria-label={`Falante em ${formatTimestamp(segment.start)}`}
            className={`mb-2 max-w-full rounded border border-border bg-surface px-2 py-1 text-xs ${Object.keys(speakerNames).indexOf(segment.speaker_id ?? "") % 2 ? "text-accent-violet" : "text-accent-spectral"}`}
            value={segment.speaker_id ?? ""}
            onChange={(e) => onSpeakerChange?.(segment, e.target.value || null)}
          >
            <option value="">Não identificado</option>
            {Object.entries(speakerNames).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
        <textarea
          ref={textareaRef}
          value={segment.text}
          onChange={(e) => onTextChange(segment.id, e.target.value)}
          rows={1}
          aria-label={`Texto em ${formatTimestamp(segment.start)}`}
          className={clsx(
            "w-full min-w-0 resize-none overflow-hidden rounded bg-transparent text-sm leading-relaxed text-text-primary",
            isSearchMatch &&
              "underline decoration-accent decoration-2 underline-offset-2",
          )}
        />
      </div>

      {segment.edited && (
        <span className="mt-0.5 h-fit shrink-0 text-xs uppercase tracking-wide text-text-muted">
          editado
        </span>
      )}
    </div>
  );
}
