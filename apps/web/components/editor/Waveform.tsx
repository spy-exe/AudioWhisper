"use client";

import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";

interface WaveformProps {
  mediaElement: HTMLMediaElement | null;
}

export function Waveform({ mediaElement }: WaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);

  useEffect(() => {
    if (!containerRef.current || !mediaElement) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      media: mediaElement,
      waveColor: "#3a3f4a",
      progressColor: "#5b8cff",
      cursorColor: "#f1ece1",
      cursorWidth: 1,
      height: 72,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      interact: true,
    });
    waveSurferRef.current = ws;

    return () => {
      ws.destroy();
      waveSurferRef.current = null;
    };
  }, [mediaElement]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Forma de onda do áudio · clique para navegar"
      className="w-full overflow-hidden rounded-md border border-border bg-surface-raised px-1 py-1"
    />
  );
}
