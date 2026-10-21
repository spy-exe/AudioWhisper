"use client";

import { formatTimestamp } from "@/lib/format";

import { Button } from "@/components/ui/Button";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

interface PlayerControlsProps {
  playing: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  onTogglePlay: () => void;
  onSeekBack: () => void;
  onSeekForward: () => void;
  onRateChange: (rate: number) => void;
}

export function PlayerControls({
  playing,
  currentTime,
  duration,
  playbackRate,
  onTogglePlay,
  onSeekBack,
  onSeekForward,
  onRateChange,
}: PlayerControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" size="sm" onClick={onSeekBack} aria-label="Voltar 5 segundos">
        ⏮ 5s
      </Button>
      <Button variant="primary" size="sm" onClick={onTogglePlay} aria-label={playing ? "Pausar" : "Reproduzir"}>
        {playing ? "Pausar" : "Reproduzir"}
      </Button>
      <Button variant="secondary" size="sm" onClick={onSeekForward} aria-label="Avançar 5 segundos">
        5s ⏭
      </Button>

      <span className="font-mono text-xs text-text-secondary">
        {formatTimestamp(currentTime)} / {formatTimestamp(duration)}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-1">
        <span className="text-xs text-text-muted">Velocidade</span>
        {SPEEDS.map((speed) => (
          <button
            key={speed}
            onClick={() => onRateChange(speed)}
            aria-pressed={playbackRate === speed}
            className={`min-h-10 min-w-10 rounded-lg px-2 py-2 text-xs transition-colors ${
              playbackRate === speed
                ? "bg-accent text-background"
                : "text-text-secondary hover:bg-surface-interactive"
            }`}
          >
            {speed}×
          </button>
        ))}
      </div>
    </div>
  );
}
