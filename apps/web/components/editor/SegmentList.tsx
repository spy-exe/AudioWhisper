"use client";

import { useRef } from "react";

import type { TranscriptSegment } from "@/lib/types";

import { SegmentRow } from "./SegmentRow";

interface SegmentListProps {
  segments: TranscriptSegment[];
  speakerNames?: Record<string, string>;
  onSpeakerChange?: (
    segment: TranscriptSegment,
    speakerId: string | null,
  ) => void;
  currentTime: number;
  onSelect: (segmentId: string, shiftKey: boolean) => void;
  onTextChange: (segmentId: string, text: string) => void;
  matchSegmentIds: Set<string>;
  currentMatchSegmentId: string | null;
  selectedSegmentIds: Set<string>;
}

export function SegmentList({
  segments,
  speakerNames,
  onSpeakerChange,
  currentTime,
  onSelect,
  onTextChange,
  matchSegmentIds,
  currentMatchSegmentId,
  selectedSegmentIds,
}: SegmentListProps) {
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const registerRef = (segmentId: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(segmentId, el);
    else rowRefs.current.delete(segmentId);
  };

  if (segments.length === 0) {
    return (
      <p className="p-6 text-sm text-text-muted">
        Nenhum segmento disponível ainda.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 py-2">
      {segments.map((segment) => {
        const active =
          currentTime >= segment.start && currentTime < segment.end;
        return (
          <SegmentRow
            key={segment.id}
            segment={segment}
            speakerNames={speakerNames}
            onSpeakerChange={onSpeakerChange}
            active={active}
            selected={selectedSegmentIds.has(segment.id)}
            isSearchMatch={matchSegmentIds.has(segment.id)}
            isCurrentMatch={currentMatchSegmentId === segment.id}
            onSelect={onSelect}
            onTextChange={onTextChange}
            registerRef={registerRef}
          />
        );
      })}
    </div>
  );
}
