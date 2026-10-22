"use client";

import { useEffect, useState } from "react";

import { api, describeError } from "@/lib/api";
import {
  formatCompactNumber,
  formatLongDuration,
  formatPercent,
  formatTimestamp,
} from "@/lib/format";
import type { TranscriptStats } from "@/lib/types";
import { Button } from "@/components/ui/Button";

interface InsightsPanelProps {
  jobId: string;
  /** Changes whenever the transcript changes, so figures never describe an older text. */
  version: string;
  threshold?: number;
  onSeek: (time: number) => void;
  onKeyword: (term: string) => void;
  onReviewUncertain: (segmentIds: string[]) => void;
}

export function InsightsPanel({
  jobId,
  version,
  threshold,
  onSeek,
  onKeyword,
  onReviewUncertain,
}: InsightsPanelProps) {
  const [stats, setStats] = useState<TranscriptStats | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setError("");
    api
      .stats(jobId, threshold)
      .then((result) => {
        if (active) setStats(result);
      })
      .catch((failure) => {
        if (active)
          setError(describeError(failure, "Não foi possível calcular os insights."));
      });
    return () => {
      active = false;
    };
  }, [jobId, version, threshold, attempt]);

  if (error)
    return (
      <section className="editor-side-panel" aria-label="Insights da conversa">
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
        <Button size="sm" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
          Tentar novamente
        </Button>
      </section>
    );
  if (!stats)
    return (
      <div className="skeleton h-72" role="status" aria-label="Calculando insights" />
    );

  const speechShare = stats.duration_seconds
    ? stats.speech_seconds / stats.duration_seconds
    : 0;
  const tiles = [
    { label: "Duração", value: formatLongDuration(stats.duration_seconds) },
    {
      label: "Com fala",
      value: formatLongDuration(stats.speech_seconds),
      hint: stats.duration_seconds ? formatPercent(speechShare) : undefined,
    },
    { label: "Palavras", value: formatCompactNumber(stats.word_count) },
    {
      label: "Ritmo",
      value: stats.words_per_minute != null ? `${Math.round(stats.words_per_minute)}` : "—",
      hint: stats.words_per_minute != null ? "palavras/min" : undefined,
    },
    { label: "Perguntas", value: String(stats.questions) },
    { label: "Trocas de turno", value: String(stats.speaker_turns) },
  ];
  const maxShare = Math.max(...stats.speakers.map((s) => s.share), 0.0001);
  const bucket = stats.activity_bucket_seconds;
  const uncertain = stats.low_confidence;

  return (
    <section aria-labelledby="insights-title" className="editor-side-panel insights">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="insights-title" className="text-base font-semibold">
          Insights da conversa
        </h2>
        <span className="text-xs text-text-muted">calculados da transcrição</span>
      </div>

      <dl className="insight-tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className="insight-tile">
            <dt>{tile.label}</dt>
            <dd>
              {tile.value}
              {tile.hint && <span>{tile.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>

      {stats.speakers.length > 0 && (
        <div className="mt-6">
          <h3 className="insight-heading">Participação por falante</h3>
          <ul className="mt-3 flex flex-col gap-3">
            {stats.speakers.map((speaker) => (
              <li key={speaker.speaker_id ?? "none"} className="speaker-bar">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-text-primary">{speaker.name}</span>
                  <span className="shrink-0 font-mono text-xs text-text-secondary">
                    {formatPercent(speaker.share)} · {formatLongDuration(speaker.speech_seconds)}
                  </span>
                </div>
                <div className="speaker-track" aria-hidden="true">
                  <span style={{ width: `${(speaker.share / maxShare) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats.activity.length > 0 && (
        <div className="mt-6">
          <h3 className="insight-heading" id="activity-title">
            Linha do tempo da fala
          </h3>
          <p className="mt-1 text-xs text-text-muted">
            Altura = parte de cada trecho com fala. Toque para ouvir.
          </p>
          <div className="activity-chart" role="group" aria-labelledby="activity-title">
            {stats.activity.map((value, index) => {
              const from = index * bucket;
              const label = `${formatTimestamp(from)}–${formatTimestamp(from + bucket)}: ${formatPercent(value)} com fala`;
              return (
                <button
                  key={index}
                  type="button"
                  className="activity-column"
                  aria-label={label}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                  onClick={() => onSeek(from)}
                >
                  <span style={{ height: `${Math.max(value * 100, value > 0 ? 6 : 0)}%` }} />
                </button>
              );
            })}
            {hovered !== null && (
              <div
                role="presentation"
                className="chart-tooltip"
                style={{
                  left: `${((hovered + 0.5) / stats.activity.length) * 100}%`,
                }}
              >
                <strong>{formatTimestamp(hovered * bucket)}</strong>{" "}
                {formatPercent(stats.activity[hovered] ?? 0)} com fala
              </div>
            )}
          </div>
          <div className="mt-1 flex justify-between font-mono text-xs text-text-muted">
            <span>00:00</span>
            <span>{formatTimestamp(stats.duration_seconds)}</span>
          </div>
        </div>
      )}

      {stats.longest_turn && stats.longest_turn.seconds > 0 && (
        <button
          type="button"
          className="insight-callout mt-6"
          onClick={() => onSeek(stats.longest_turn!.start)}
        >
          <span className="text-xs text-text-muted">Fala contínua mais longa</span>
          <span className="block text-sm text-text-primary">
            {stats.longest_turn.name} · {formatLongDuration(stats.longest_turn.seconds)} a
            partir de {formatTimestamp(stats.longest_turn.start)}
          </span>
        </button>
      )}

      {stats.keywords.length > 0 && (
        <div className="mt-6">
          <h3 className="insight-heading">Termos mais citados</h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {stats.keywords.map((keyword) => (
              <li key={keyword.term}>
                <button
                  type="button"
                  className="keyword-chip"
                  onClick={() => onKeyword(keyword.term)}
                  aria-label={`Buscar ${keyword.term} na transcrição (${keyword.count} vezes)`}
                >
                  {keyword.term}
                  <span>{keyword.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-border p-4">
        <h3 className="insight-heading">Revisão de confiança</h3>
        {uncertain.segments ? (
          <>
            <p className="mt-2 text-sm text-text-secondary">
              {uncertain.segments}{" "}
              {uncertain.segments === 1 ? "trecho" : "trechos"} abaixo de{" "}
              {formatPercent(uncertain.threshold)} de confiança
              {uncertain.words_total > 0 &&
                ` · ${uncertain.words} de ${formatCompactNumber(uncertain.words_total)} palavras incertas`}
              .
            </p>
            <Button
              size="sm"
              className="mt-3"
              onClick={() => onReviewUncertain(uncertain.segment_ids)}
            >
              Revisar trechos incertos
            </Button>
          </>
        ) : (
          <p className="mt-2 text-sm text-text-secondary">
            Nenhum trecho abaixo de {formatPercent(uncertain.threshold)} de confiança.
          </p>
        )}
      </div>

      {stats.speakers.length > 0 && (
        <details className="mt-4">
          <summary className="text-xs text-text-secondary">Ver dados em tabela</summary>
          <table className="insight-table mt-3">
            <caption className="sr-only">Participação por falante</caption>
            <thead>
              <tr>
                <th scope="col">Falante</th>
                <th scope="col">Fala</th>
                <th scope="col">Palavras</th>
                <th scope="col">Ritmo</th>
              </tr>
            </thead>
            <tbody>
              {stats.speakers.map((speaker) => (
                <tr key={speaker.speaker_id ?? "none"}>
                  <th scope="row">{speaker.name}</th>
                  <td>{formatPercent(speaker.share)}</td>
                  <td>{speaker.words}</td>
                  <td>{speaker.words_per_minute ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
