"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { formatCompactNumber, formatLongDuration } from "@/lib/format";
import type { LibraryStats } from "@/lib/types";

/** Real totals of the library; hidden when empty or unavailable rather than showing zeros. */
export function LibraryStatsStrip() {
  const [stats, setStats] = useState<LibraryStats | null>(null);
  useEffect(() => {
    let active = true;
    api
      .libraryStats()
      .then((result) => {
        if (active) setStats(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  if (!stats || !stats.completed) return null;
  const items = [
    [`${stats.completed}`, stats.completed === 1 ? "gravação transcrita" : "gravações transcritas"],
    [formatLongDuration(stats.transcribed_seconds), "de áudio"],
    [formatCompactNumber(stats.words), "palavras"],
    [`${stats.documents}`, stats.documents === 1 ? "documento" : "documentos"],
  ];
  return (
    <dl className="library-stats" aria-label="Resumo do acervo">
      {items.map(([value, label]) => (
        <div key={label}>
          <dt className="sr-only">{label}</dt>
          <dd>
            <strong>{value}</strong> {label}
          </dd>
        </div>
      ))}
    </dl>
  );
}
