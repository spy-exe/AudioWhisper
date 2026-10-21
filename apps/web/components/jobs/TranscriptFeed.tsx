"use client";
import { useState } from "react";
import { formatTimestamp } from "@/lib/format";
import type { TranscriptSegment } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export function TranscriptFeed({
  segments,
  provisional = [],
  pending = false,
}: {
  segments: TranscriptSegment[];
  provisional?: TranscriptSegment[];
  pending?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? segments : segments.slice(-100);
  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-surface"
      aria-label="Transcrição em processamento"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold">Transcrição</h2>
        <Badge tone="success">{segments.length} confirmados</Badge>
      </div>
      <div className="max-h-[60vh] min-h-64 space-y-5 overflow-y-auto p-5">
        {segments.length > 100 && !showAll && (
          <Button size="sm" onClick={() => setShowAll(true)}>
            Mostrar {segments.length - 100} trechos anteriores
          </Button>
        )}
        {!segments.length && !provisional.length && (
          <p className="py-6 text-sm leading-relaxed text-text-muted">
            Os trechos aparecem aqui conforme o áudio é processado. O texto
            confirmado permanece salvo na biblioteca.
          </p>
        )}
        {visible.map((segment) => (
          <div key={segment.id} className="flex gap-4">
            <span className="shrink-0 pt-1 font-mono text-xs text-accent">
              {formatTimestamp(segment.start)}
            </span>
            <p className="min-w-0 text-sm leading-relaxed text-text-primary">
              {segment.text}
            </p>
          </div>
        ))}
        <div aria-live="polite" aria-atomic="false">
          {provisional.map((segment) => (
            <div
              key={segment.id}
              className="mt-4 flex gap-4 rounded-lg border border-dashed border-accent/30 bg-accent/5 p-3"
            >
              <span className="shrink-0 font-mono text-xs text-text-muted">
                {formatTimestamp(segment.start)}
              </span>
              <div className="min-w-0">
                <span className="text-xs uppercase tracking-widest text-accent">
                  Provisório
                </span>
                <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                  {segment.text}
                </p>
              </div>
            </div>
          ))}
        </div>
        {pending && (
          <p
            role="status"
            className="flex items-center gap-2 border-t border-border pt-4 text-xs text-text-muted"
          >
            <span className="size-1.5 rounded-full bg-accent" />
            Processando próximo trecho…
          </p>
        )}
      </div>
    </section>
  );
}
