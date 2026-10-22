"use client";

import { useEffect, useRef } from "react";
import { clsx } from "clsx";

import { formatPercent, formatTimestamp } from "@/lib/format";
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
  uncertain?: boolean;
  bookmarked?: boolean;
  onSelect: (segmentId: string, shiftKey: boolean) => void;
  onTextChange: (segmentId: string, text: string) => void;
  onBookmark?: (segment: TranscriptSegment) => void;
  onSplit?: (segment: TranscriptSegment, offset: number) => void;
  onCopyLink?: (segment: TranscriptSegment) => void;
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
  uncertain = false,
  bookmarked = false,
  onSelect,
  onTextChange,
  onBookmark,
  onSplit,
  onCopyLink,
  registerRef,
}: SegmentRowProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cursor = useRef<number | null>(null);

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

  const time = formatTimestamp(segment.start);
  const rememberCursor = () => {
    cursor.current = textareaRef.current?.selectionStart ?? null;
  };

  return (
    <div
      ref={containerRef}
      data-segment-id={segment.id}
      className={clsx(
        "segment-row group flex flex-col gap-2 rounded-lg px-4 py-3 transition-colors sm:flex-row sm:gap-3",
        active && "is-active bg-accent/10",
        selected && "is-selected",
        selected && !active && "bg-accent-violet/10",
        isCurrentMatch && "ring-1 ring-accent",
        uncertain && "is-uncertain",
        !active && !selected && "hover:bg-surface-interactive/50",
      )}
    >
      <button
        onClick={(e) => onSelect(segment.id, e.shiftKey)}
        className="mt-0.5 min-h-10 w-fit shrink-0 rounded-lg bg-surface-interactive px-2 py-2 font-mono text-xs text-text-secondary transition-colors hover:bg-accent hover:text-background"
        aria-label={`Ir para ${time}${selected ? " (selecionado)" : ""}`}
      >
        {time}
        {bookmarked && (
          <span className="ml-1 text-amber" aria-label="com marcador">
            ◆
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        {speakerNames && Object.keys(speakerNames).length > 0 && (
          <select
            aria-label={`Falante em ${time}`}
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
          onSelect={rememberCursor}
          onKeyUp={rememberCursor}
          onClick={rememberCursor}
          rows={1}
          aria-label={`Texto em ${time}`}
          className={clsx(
            "w-full min-w-0 resize-none overflow-hidden rounded bg-transparent text-sm leading-relaxed text-text-primary",
            isSearchMatch &&
              "underline decoration-accent decoration-2 underline-offset-2",
          )}
        />
        {(onBookmark || onSplit || onCopyLink) && (
          <div className="segment-actions" role="group" aria-label={`Ações do trecho em ${time}`}>
            {onBookmark && (
              <button type="button" onClick={() => onBookmark(segment)}>
                Marcar
              </button>
            )}
            {onSplit && (
              <button
                type="button"
                onClick={() =>
                  onSplit(segment, cursor.current ?? textareaRef.current?.selectionStart ?? 0)
                }
              >
                Dividir no cursor
              </button>
            )}
            {onCopyLink && (
              <button type="button" onClick={() => onCopyLink(segment)}>
                Copiar link do momento
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-row gap-2 sm:flex-col sm:items-end">
        {uncertain && segment.confidence != null && (
          <span
            className="h-fit rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning"
            title="Confiança média do reconhecimento neste trecho"
          >
            incerto · {formatPercent(segment.confidence)}
          </span>
        )}
        {segment.edited && (
          <span className="mt-0.5 h-fit text-xs uppercase tracking-wide text-text-muted">
            editado
          </span>
        )}
      </div>
    </div>
  );
}
