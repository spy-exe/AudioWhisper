"use client";

import { useState } from "react";

import { api, describeError } from "@/lib/api";
import { BOOKMARK_COLORS } from "@/lib/constants";
import { formatTimestamp } from "@/lib/format";
import type { Bookmark, BookmarkColor } from "@/lib/types";
import { Button } from "@/components/ui/Button";

interface BookmarksPanelProps {
  jobId: string;
  bookmarks: Bookmark[];
  currentTime: number;
  currentSegmentId: string | null;
  onChange: (bookmarks: Bookmark[]) => void;
  onSeek: (time: number) => void;
}

function swatch(color: string) {
  return (
    BOOKMARK_COLORS.find((c) => c.value === color)?.swatch ??
    "var(--color-amber)"
  );
}

export function BookmarksPanel({
  jobId,
  bookmarks,
  currentTime,
  currentSegmentId,
  onChange,
  onSeek,
}: BookmarksPanelProps) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<BookmarkColor>("amber");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ label: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sorted = [...bookmarks].sort((a, b) => a.start - b.start);
  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(describeError(failure, fallback));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="bookmarks-title" className="editor-side-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="bookmarks-title" className="text-base font-semibold">
          Marcadores
        </h2>
        <span className="text-xs text-text-muted">
          {bookmarks.length}{" "}
          {bookmarks.length === 1 ? "marcador" : "marcadores"}
        </span>
      </div>
      <form
        noValidate
        className="mt-4 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const name =
            label.trim() || `Momento em ${formatTimestamp(currentTime)}`;
          void run(async () => {
            const created = await api.createBookmark(jobId, {
              start: Math.max(0, currentTime),
              label: name,
              color,
              segment_id: currentSegmentId,
            });
            onChange([...bookmarks, created]);
            setLabel("");
          }, "Não foi possível criar o marcador.");
        }}
      >
        <label className="text-xs text-text-secondary">
          Marcar {formatTimestamp(currentTime)}
          <input
            className="field mt-1"
            value={label}
            maxLength={200}
            placeholder="Ex.: decisão sobre o orçamento"
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Cor do marcador</legend>
          {BOOKMARK_COLORS.map((option) => (
            <label
              key={option.value}
              className="bookmark-color"
              title={option.label}
            >
              <input
                type="radio"
                name="bookmark-color"
                value={option.value}
                checked={color === option.value}
                onChange={() => setColor(option.value)}
              />
              <span aria-hidden="true" style={{ background: option.swatch }} />
              <span className="sr-only">{option.label}</span>
            </label>
          ))}
          <Button
            type="submit"
            size="sm"
            variant="primary"
            className="ml-auto"
            disabled={busy}
          >
            Adicionar marcador
          </Button>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {error}
        </p>
      )}
      {sorted.length === 0 ? (
        <p className="mt-5 text-sm leading-relaxed text-text-muted">
          Marque decisões, dúvidas e trechos para voltar depois. Use M durante a
          reprodução para marcar o momento atual.
        </p>
      ) : (
        <ul className="mt-5 flex max-h-80 flex-col gap-2 overflow-y-auto">
          {sorted.map((bookmark) => (
            <li key={bookmark.id} className="bookmark-item">
              <span
                aria-hidden="true"
                className="bookmark-dot"
                style={{ background: swatch(bookmark.color) }}
              />
              {editing === bookmark.id ? (
                <form
                  noValidate
                  className="flex min-w-0 flex-1 flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      const saved = await api.updateBookmark(bookmark.id, {
                        label: draft.label,
                        note: draft.note,
                      });
                      onChange(
                        bookmarks.map((b) => (b.id === saved.id ? saved : b)),
                      );
                      setEditing(null);
                    }, "Não foi possível salvar o marcador.");
                  }}
                >
                  <input
                    className="field"
                    aria-label="Nome do marcador"
                    value={draft.label}
                    maxLength={200}
                    required
                    onChange={(event) =>
                      setDraft({ ...draft, label: event.target.value })
                    }
                  />
                  <textarea
                    className="field min-h-20 resize-y resize-none"
                    aria-label="Nota do marcador"
                    value={draft.note}
                    maxLength={2000}
                    onChange={(event) =>
                      setDraft({ ...draft, note: event.target.value })
                    }
                  />
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      variant="primary"
                      disabled={busy || !draft.label.trim()}
                    >
                      Salvar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(null)}
                    >
                      Cancelar
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onSeek(bookmark.start)}
                    aria-label={`Ir para ${bookmark.label} em ${formatTimestamp(bookmark.start)}`}
                  >
                    <span className="font-mono text-xs text-text-muted">
                      {formatTimestamp(bookmark.start)}
                    </span>
                    <span className="block truncate text-sm text-text-primary">
                      {bookmark.label}
                    </span>
                    {bookmark.note && (
                      <span className="mt-1 block text-xs leading-relaxed text-text-secondary">
                        {bookmark.note}
                      </span>
                    )}
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Editar ${bookmark.label}`}
                      onClick={() => {
                        setDraft({
                          label: bookmark.label,
                          note: bookmark.note,
                        });
                        setEditing(bookmark.id);
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Excluir ${bookmark.label}`}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api.deleteBookmark(bookmark.id);
                          onChange(
                            bookmarks.filter((b) => b.id !== bookmark.id),
                          );
                        }, "Não foi possível excluir o marcador.")
                      }
                    >
                      Excluir
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
