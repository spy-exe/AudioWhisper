"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, describeError } from "@/lib/api";
import { DEFAULT_LOW_CONFIDENCE } from "@/lib/constants";
import { formatTimestamp } from "@/lib/format";
import { replaceTranscriptText } from "@/lib/transcript-text";
import type { Bookmark, MediaFile, Organization, TranscriptSegment } from "@/lib/types";
import { useSettings } from "@/contexts/SettingsContext";
import { AIWorkspace } from "@/components/workspace/AIWorkspace";
import { OrganizationPanel } from "@/components/workspace/OrganizationPanel";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Panel } from "@/components/ui/Panel";
import { BookmarksPanel } from "./BookmarksPanel";
import { ExportMenu } from "./ExportMenu";
import { InsightsPanel } from "./InsightsPanel";
import { MediaPlayer } from "./MediaPlayer";
import { PlayerControls } from "./PlayerControls";
import { RetranscribeDialog } from "./RetranscribeDialog";
import { SearchBar } from "./SearchBar";
import { SegmentList } from "./SegmentList";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Waveform } from "./Waveform";

const AUTOSAVE_DEBOUNCE_MS = 900;
const UNDO_STACK_LIMIT = 30;

interface TranscriptEditorProps {
  jobId: string;
  media: MediaFile;
  modelName?: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";
type SidePanel = "assistant" | "insights" | "bookmarks";

const SIDE_PANELS: { id: SidePanel; label: string }[] = [
  { id: "assistant", label: "Assistente" },
  { id: "insights", label: "Insights" },
  { id: "bookmarks", label: "Marcadores" },
];

function containing(segments: TranscriptSegment[], time: number) {
  return (
    segments.find((s) => time >= s.start && time < s.end) ??
    [...segments].reverse().find((s) => s.start <= time) ??
    segments[0]
  );
}

export function TranscriptEditor({ jobId, media, modelName = "" }: TranscriptEditorProps) {
  const router = useRouter();
  const search = useSearchParams();
  const { settings } = useSettings();
  const threshold = Number(settings?.low_confidence_threshold ?? DEFAULT_LOW_CONFIDENCE);

  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState("");
  const [sidePanel, setSidePanel] = useState<SidePanel | null>("assistant");
  const [review, setReview] = useState<string[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<"shortcuts" | "retranscribe" | "delete" | null>(null);
  const [structuring, setStructuring] = useState(false);
  const [mediaElement, setMediaElement] = useState<HTMLMediaElement | null>(
    null,
  );
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  const [searchVisible, setSearchVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(
    new Set(),
  );
  const lastSelectedIndex = useRef<number | null>(null);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const dirtyRef = useRef<
    Map<string, { text: string; start: number; end: number }>
  >(new Map());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const undoStack = useRef<TranscriptSegment[][]>([]);
  const deepLinked = useRef(false);

  useEffect(() => {
    let active = true;
    Promise.all([api.getSegments(jobId), api.organization(jobId), api.bookmarks(jobId)])
      .then(([text, item, marks]) => {
        if (active) {
          setSegments(text);
          setOrganization(item);
          setBookmarks(marks);
        }
      })
      .catch(() => {
        if (active)
          setLoadError(
            "Não foi possível carregar a transcrição. Tente novamente.",
          );
      });
    return () => {
      active = false;
    };
  }, [jobId]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const refreshSegments = useCallback(() => {
    api
      .getSegments(jobId)
      .then((next) => {
        setSegments(next);
        setRevision((n) => n + 1);
      })
      .catch(() => setLoadError("Falha ao atualizar os falantes."));
  }, [jobId]);

  // --- media element wiring ---
  useEffect(() => {
    if (!mediaElement) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrentTime(mediaElement.currentTime);
    const onMeta = () =>
      setDuration(mediaElement.duration || media.duration_seconds || 0);
    const onRate = () => setPlaybackRate(mediaElement.playbackRate);

    mediaElement.addEventListener("play", onPlay);
    mediaElement.addEventListener("pause", onPause);
    mediaElement.addEventListener("timeupdate", onTime);
    mediaElement.addEventListener("loadedmetadata", onMeta);
    mediaElement.addEventListener("ratechange", onRate);
    return () => {
      mediaElement.removeEventListener("play", onPlay);
      mediaElement.removeEventListener("pause", onPause);
      mediaElement.removeEventListener("timeupdate", onTime);
      mediaElement.removeEventListener("loadedmetadata", onMeta);
      mediaElement.removeEventListener("ratechange", onRate);
    };
  }, [mediaElement, media.duration_seconds]);

  const seekTo = useCallback(
    (time: number) => {
      if (mediaElement) mediaElement.currentTime = time;
      setCurrentTime(time);
    },
    [mediaElement],
  );

  const togglePlay = useCallback(() => {
    if (!mediaElement) return;
    if (mediaElement.paused) mediaElement.play();
    else mediaElement.pause();
  }, [mediaElement]);

  const changeRate = useCallback(
    (rate: number) => {
      if (mediaElement) mediaElement.playbackRate = rate;
      setPlaybackRate(rate);
    },
    [mediaElement],
  );

  // --- autosave ---
  const flushSave = useCallback(async (): Promise<boolean> => {
    if (saveInFlight.current) {
      const saved = await saveInFlight.current;
      return saved && dirtyRef.current.size > 0 ? flushSave() : saved;
    }
    if (dirtyRef.current.size === 0) return true;
    const task = (async () => {
      setSaveStatus("saving");
      while (dirtyRef.current.size > 0) {
        const pending = Array.from(dirtyRef.current.entries());
        dirtyRef.current.clear();
        try {
          await Promise.all(
            pending.map(([segmentId, { text, start, end }]) =>
              api.updateSegment(jobId, segmentId, text, start, end),
            ),
          );
        } catch {
          setSaveStatus("error");
          pending.forEach(([id, value]) => {
            if (!dirtyRef.current.has(id)) dirtyRef.current.set(id, value);
          });
          return false;
        }
      }
      setSaveStatus("saved");
      setRevision((n) => n + 1);
      setTimeout(
        () => setSaveStatus((s) => (s === "saved" ? "idle" : s)),
        2000,
      );
      return true;
    })();
    saveInFlight.current = task;
    try {
      return await task;
    } finally {
      saveInFlight.current = null;
    }
  }, [jobId]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushSave, AUTOSAVE_DEBOUNCE_MS);
  }, [flushSave]);

  const pushUndoSnapshot = useCallback(() => {
    if (!segments) return;
    undoStack.current.push(segments.map((s) => ({ ...s })));
    if (undoStack.current.length > UNDO_STACK_LIMIT) undoStack.current.shift();
  }, [segments]);

  const handleTextChange = useCallback(
    (segmentId: string, text: string) => {
      setSegments((prev) => {
        if (!prev) return prev;
        return prev.map((s) =>
          s.id === segmentId ? { ...s, text, edited: true } : s,
        );
      });
      const seg = segments?.find((s) => s.id === segmentId);
      if (seg)
        dirtyRef.current.set(segmentId, {
          text,
          start: seg.start,
          end: seg.end,
        });
      scheduleSave();
    },
    [segments, scheduleSave],
  );

  // wraps handleTextChange so each edit "session" (first change since last commit) snapshots undo
  const editingSessionActive = useRef(false);
  const onSegmentTextChange = useCallback(
    (segmentId: string, text: string) => {
      if (!editingSessionActive.current) {
        pushUndoSnapshot();
        editingSessionActive.current = true;
        setTimeout(() => {
          editingSessionActive.current = false;
        }, AUTOSAVE_DEBOUNCE_MS + 200);
      }
      handleTextChange(segmentId, text);
    },
    [handleTextChange, pushUndoSnapshot],
  );

  const handleUndo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    setSegments(previous);
    previous.forEach((s) =>
      dirtyRef.current.set(s.id, { text: s.text, start: s.start, end: s.end }),
    );
    scheduleSave();
  }, [scheduleSave]);

  // --- selection ---
  const handleSelect = useCallback(
    (segmentId: string, shiftKey: boolean) => {
      if (!segments) return;
      const index = segments.findIndex((s) => s.id === segmentId);
      if (index === -1) return;
      seekTo(segments[index]!.start);

      if (shiftKey && lastSelectedIndex.current !== null) {
        const from = Math.min(lastSelectedIndex.current, index);
        const to = Math.max(lastSelectedIndex.current, index);
        setSelectedSegmentIds(
          new Set(segments.slice(from, to + 1).map((s) => s.id)),
        );
      } else {
        setSelectedSegmentIds(new Set([segmentId]));
        lastSelectedIndex.current = index;
      }
    },
    [segments, seekTo],
  );

  const handleCopySelection = useCallback(() => {
    if (!segments) return;
    const text = segments
      .filter((s) => selectedSegmentIds.has(s.id))
      .map((s) => s.text)
      .join(" ");
    navigator.clipboard
      .writeText(text)
      .then(() => setNotice("Trechos copiados."))
      .catch(() => setNotice("Não foi possível copiar. Selecione o texto manualmente."));
  }, [segments, selectedSegmentIds]);

  // Deep link from search results: /jobs/{id}?t=SECONDS opens at that moment.
  useEffect(() => {
    if (deepLinked.current || !segments?.length) return;
    const raw = search?.get("t");
    if (raw == null) return;
    const time = Number(raw);
    if (!Number.isFinite(time) || time < 0) return;
    if (!mediaElement) return;
    deepLinked.current = true;
    const target = containing(segments, time);
    seekTo(time);
    if (target) {
      setSelectedSegmentIds(new Set([target.id]));
      lastSelectedIndex.current = segments.indexOf(target);
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-segment-id="${target.id}"]`)
          ?.scrollIntoView({ block: "center" }),
      );
    }
  }, [search, segments, mediaElement, seekTo]);

  // --- search ---
  const matchSegmentIds = useMemo(() => {
    if (!query.trim() || !segments) return [];
    const q = query.toLowerCase();
    return segments
      .filter((s) => s.text.toLowerCase().includes(q))
      .map((s) => s.id);
  }, [query, segments]);
  const matchSegmentIdSet = useMemo(
    () => new Set(matchSegmentIds),
    [matchSegmentIds],
  );
  const currentMatchSegmentId = matchSegmentIds[currentMatchIndex] ?? null;

  useEffect(() => setCurrentMatchIndex(0), [query]);

  const handleReplaceAll = useCallback(() => {
    if (!query.trim() || !segments) return;
    pushUndoSnapshot();
    const q = query.toLowerCase();
    setSegments((prev) => {
      if (!prev) return prev;
      return prev.map((s) => {
        if (!s.text.toLowerCase().includes(q)) return s;
        const replaced = replaceTranscriptText(s.text, query, replaceValue);
        dirtyRef.current.set(s.id, {
          text: replaced,
          start: s.start,
          end: s.end,
        });
        return { ...s, text: replaced, edited: true };
      });
    });
    scheduleSave();
  }, [query, replaceValue, segments, pushUndoSnapshot, scheduleSave]);

  // --- uncertain segments and review mode ---
  const uncertainIds = useMemo(
    () =>
      new Set(
        (segments ?? [])
          .filter((s) => s.confidence != null && s.confidence < threshold)
          .map((s) => s.id),
      ),
    [segments, threshold],
  );
  const bookmarkedIds = useMemo(
    () => new Set(bookmarks.map((b) => b.segment_id).filter((id): id is string => !!id)),
    [bookmarks],
  );

  const goToUncertain = useCallback(
    (direction: 1 | -1) => {
      if (!segments) return;
      const pool = segments.filter((s) =>
        review ? review.includes(s.id) : uncertainIds.has(s.id),
      );
      if (!pool.length) {
        setNotice("Nenhum trecho incerto para revisar.");
        return;
      }
      const ordered = direction === 1 ? pool : [...pool].reverse();
      const next =
        ordered.find((s) => (direction === 1 ? s.start > currentTime + 0.01 : s.start < currentTime - 0.01)) ??
        ordered[0]!;
      handleSelect(next.id, false);
      document
        .querySelector(`[data-segment-id="${next.id}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
    [segments, review, uncertainIds, currentTime, handleSelect],
  );

  // --- structural edits (split, merge, speakers) ---
  const restructure = useCallback(
    async (action: () => Promise<TranscriptSegment[]>, success: string, fallback: string) => {
      if (!(await flushSave())) {
        setNotice("Salve as alterações pendentes antes de reorganizar os trechos.");
        return;
      }
      setStructuring(true);
      try {
        const next = await action();
        setSegments(next);
        // Snapshots reference segments that no longer exist after a split or merge.
        undoStack.current = [];
        setSelectedSegmentIds(new Set());
        setRevision((n) => n + 1);
        setNotice(success);
      } catch (failure) {
        setNotice(describeError(failure, fallback));
      } finally {
        setStructuring(false);
      }
    },
    [flushSave],
  );

  const handleSplit = useCallback(
    (segment: TranscriptSegment, offset: number) => {
      if (!segment.text.slice(0, offset).trim() || !segment.text.slice(offset).trim()) {
        setNotice("Posicione o cursor no ponto da divisão, entre duas palavras do trecho.");
        return;
      }
      void restructure(
        () => api.splitSegment(jobId, segment.id, offset),
        "Trecho dividido.",
        "Não foi possível dividir o trecho.",
      );
    },
    [jobId, restructure],
  );

  const selectedInOrder = useMemo(
    () => (segments ?? []).filter((s) => selectedSegmentIds.has(s.id)),
    [segments, selectedSegmentIds],
  );

  const handleMerge = useCallback(() => {
    void restructure(
      () => api.mergeSegments(jobId, selectedInOrder.map((s) => s.id)),
      `${selectedInOrder.length} trechos unidos.`,
      "Não foi possível juntar os trechos.",
    );
  }, [jobId, restructure, selectedInOrder]);

  const assignSelection = useCallback(
    async (speakerId: string | null) => {
      if (!selectedInOrder.length) return;
      try {
        const saved = await api.assignSpeakers(jobId, selectedInOrder.map((s) => s.id), speakerId);
        const byId = new Map(saved.map((s) => [s.id, s]));
        setSegments((previous) => previous?.map((s) => byId.get(s.id) ?? s) ?? null);
        setRevision((n) => n + 1);
        setNotice(`Falante atualizado em ${saved.length} ${saved.length === 1 ? "trecho" : "trechos"}.`);
      } catch (failure) {
        setNotice(describeError(failure, "Não foi possível atribuir o falante."));
      }
    },
    [jobId, selectedInOrder],
  );

  const createBookmark = useCallback(
    async (start: number, label: string, segmentId: string | null) => {
      try {
        const created = await api.createBookmark(jobId, { start, label, segment_id: segmentId });
        setBookmarks((previous) => [...previous, created]);
        setNotice(`Marcador criado em ${formatTimestamp(start)}.`);
      } catch (failure) {
        setNotice(describeError(failure, "Não foi possível criar o marcador."));
      }
    },
    [jobId],
  );

  const bookmarkSegment = useCallback(
    (segment: TranscriptSegment) => {
      const words = segment.text.trim().split(/\s+/).slice(0, 8).join(" ");
      void createBookmark(segment.start, words || `Momento em ${formatTimestamp(segment.start)}`, segment.id);
    },
    [createBookmark],
  );

  const copyMomentLink = useCallback(
    (segment: TranscriptSegment) => {
      const url = `${window.location.origin}/jobs/${jobId}?t=${Math.floor(segment.start)}`;
      navigator.clipboard
        .writeText(url)
        .then(() => setNotice(`Link para ${formatTimestamp(segment.start)} copiado.`))
        .catch(() => setNotice(url));
    },
    [jobId],
  );

  // --- keyboard shortcuts ---
  useKeyboardShortcuts({
    togglePlay,
    seekBack: () => seekTo(Math.max(0, currentTime - 2)),
    seekForward: () => seekTo(Math.min(duration, currentTime + 2)),
    seekBackBig: () => seekTo(Math.max(0, currentTime - 10)),
    seekForwardBig: () => seekTo(Math.min(duration, currentTime + 10)),
    search: () => setSearchVisible(true),
    save: () => flushSave(),
    undo: handleUndo,
    bookmark: () => {
      const active = segments ? containing(segments, currentTime) : undefined;
      void createBookmark(currentTime, `Momento em ${formatTimestamp(currentTime)}`, active?.id ?? null);
    },
    nextUncertain: () => goToUncertain(1),
    previousUncertain: () => goToUncertain(-1),
    help: () => setDialog("shortcuts"),
  });

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current.size > 0 || saveInFlight.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  if (!segments) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-8">
        {loadError ? (
          <div role="alert">
            <p className="mb-3 text-sm text-danger">{loadError}</p>
            <Button onClick={() => window.location.reload()}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <div
            className="skeleton h-80"
            role="status"
            aria-label="Carregando transcrição"
          />
        )}
      </div>
    );
  }

  const speakers = organization?.speakers ?? {};
  const hasSpeakers = Object.keys(speakers).length > 0;
  const visibleSegments = segments.filter(
    (s) =>
      (!speakerFilter || s.speaker_id === speakerFilter) &&
      (!review || review.includes(s.id)),
  );
  const title = organization?.title || media.original_name;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="transcript-editor mx-auto flex max-w-[1600px] flex-col gap-6 px-4 py-8 sm:px-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words font-[var(--font-display)] text-2xl font-semibold text-text-primary">
            {title}
          </h1>
          <p className="text-xs text-text-muted">
            {media.media_type === "video" ? "Vídeo" : "Áudio"} ·{" "}
            {segments.length} segmentos
            {modelName && ` · modelo ${modelName}`}
            {uncertainIds.size > 0 && ` · ${uncertainIds.size} incertos`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AnimatePresence mode="wait">
            {saveStatus !== "idle" && (
              <motion.span
                key={saveStatus}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.15 }}
              >
                <SaveIndicator status={saveStatus} />
              </motion.span>
            )}
          </AnimatePresence>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleUndo}
            disabled={undoStack.current.length === 0}
          >
            Desfazer
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDialog("shortcuts")} aria-label="Atalhos do teclado">
            Atalhos <kbd className="ml-1 rounded border border-border px-1 font-mono">?</kbd>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDialog("retranscribe")}>
            Transcrever novamente
          </Button>
          <Button variant="danger" size="sm" onClick={() => setDialog("delete")}>
            Excluir
          </Button>
        </div>
      </div>

      <OrganizationPanel
        jobId={jobId}
        value={organization}
        onChange={setOrganization}
        onDiarized={refreshSegments}
        onSegmentsChanged={refreshSegments}
      />
      <div
        className={`grid min-w-0 items-start gap-5 ${sidePanel ? "xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,1fr)]" : ""}`}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <MediaPlayer media={media} onElementReady={setMediaElement} />

          <Panel raised className="flex flex-col gap-3 p-4">
            <Waveform mediaElement={mediaElement} />
            <PlayerControls
              playing={playing}
              currentTime={currentTime}
              duration={duration}
              playbackRate={playbackRate}
              onTogglePlay={togglePlay}
              onSeekBack={() => seekTo(Math.max(0, currentTime - 5))}
              onSeekForward={() => seekTo(Math.min(duration, currentTime + 5))}
              onRateChange={changeRate}
            />
          </Panel>

          <AnimatePresence>
            {searchVisible && (
              <motion.div
                initial={{ opacity: 0, y: -10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -10, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <SearchBar
                  query={query}
                  onQueryChange={setQuery}
                  replaceValue={replaceValue}
                  onReplaceChange={setReplaceValue}
                  matchCount={matchSegmentIds.length}
                  currentMatchIndex={currentMatchIndex}
                  onNext={() =>
                    setCurrentMatchIndex(
                      (i) => (i + 1) % Math.max(1, matchSegmentIds.length),
                    )
                  }
                  onPrev={() =>
                    setCurrentMatchIndex(
                      (i) =>
                        (i - 1 + matchSegmentIds.length) %
                        Math.max(1, matchSegmentIds.length),
                    )
                  }
                  onReplaceAll={handleReplaceAll}
                  onClose={() => setSearchVisible(false)}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {review && (
            <div role="status" className="review-banner">
              <span>
                Revisando {review.length} {review.length === 1 ? "trecho incerto" : "trechos incertos"}. Use N
                para avançar.
              </span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => goToUncertain(1)}>
                  Próximo
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setReview(null)}>
                  Sair da revisão
                </Button>
              </div>
            </div>
          )}

          <Panel className="max-h-[60vh] overflow-y-auto">
            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface p-3">
              <h2 className="text-sm font-medium">Transcrição</h2>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSearchVisible(!searchVisible)}
                >
                  Buscar no texto
                </Button>
                {uncertainIds.size > 0 && !review && (
                  <Button size="sm" variant="ghost" onClick={() => setReview([...uncertainIds])}>
                    Revisar incertos ({uncertainIds.size})
                  </Button>
                )}
                <select
                  aria-label="Agrupar por falante"
                  className="field w-auto max-w-full"
                  value={speakerFilter}
                  onChange={(e) => setSpeakerFilter(e.target.value)}
                >
                  <option value="">Todos os falantes</option>
                  {Object.entries(speakers).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {selectedInOrder.length > 0 && (
              <div className="selection-bar" role="toolbar" aria-label="Ações da seleção">
                <span className="text-xs text-text-secondary">
                  {selectedInOrder.length} {selectedInOrder.length === 1 ? "trecho selecionado" : "trechos selecionados"}
                  {selectedInOrder.length === 1 && " · Shift+clique no horário seleciona um intervalo"}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={handleCopySelection}>
                    Copiar
                  </Button>
                  {selectedInOrder.length > 1 && (
                    <Button size="sm" onClick={handleMerge} disabled={structuring}>
                      Juntar {selectedInOrder.length} trechos
                    </Button>
                  )}
                  {hasSpeakers && (
                    <select
                      aria-label="Atribuir falante à seleção"
                      className="field w-auto max-w-full"
                      value=""
                      onChange={(e) => {
                        if (e.target.value) void assignSelection(e.target.value === "__none" ? null : e.target.value);
                      }}
                    >
                      <option value="">Atribuir falante…</option>
                      {Object.entries(speakers).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                      <option value="__none">Não identificado</option>
                    </select>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setSelectedSegmentIds(new Set())}>
                    Limpar seleção
                  </Button>
                </div>
              </div>
            )}
            <SegmentList
              segments={visibleSegments}
              speakerNames={organization?.speakers}
              onSpeakerChange={async (segment, id) => {
                if (!(await flushSave())) return;
                try {
                  const saved = await api.assignSpeaker(jobId, segment, id);
                  setSegments(
                    (previous) =>
                      previous?.map((s) => (s.id === saved.id ? saved : s)) ??
                      null,
                  );
                  setRevision((n) => n + 1);
                } catch {
                  setLoadError("Falha ao salvar o falante. Tente novamente.");
                }
              }}
              currentTime={currentTime}
              onSelect={handleSelect}
              onTextChange={onSegmentTextChange}
              matchSegmentIds={matchSegmentIdSet}
              currentMatchSegmentId={currentMatchSegmentId}
              selectedSegmentIds={selectedSegmentIds}
              uncertainSegmentIds={uncertainIds}
              bookmarkedSegmentIds={bookmarkedIds}
              onBookmark={bookmarkSegment}
              onSplit={structuring ? undefined : handleSplit}
              onCopyLink={copyMomentLink}
              emptyMessage={review ? "Todos os trechos incertos foram revisados." : undefined}
            />
          </Panel>
          {notice && (
            <p role="status" className="text-xs text-text-secondary">
              {notice}
            </p>
          )}
          {loadError && (
            <p role="alert" className="text-xs text-danger">
              {loadError}
            </p>
          )}

          <Panel raised className="flex flex-col gap-2 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Exportar
            </p>
            <ExportMenu jobId={jobId} hasSpeakers={segments.some((s) => s.speaker_id)} />
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div
            className="side-tabs"
            role="tablist"
            aria-label="Painel lateral"
            onKeyDown={(event) => {
              if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const index = SIDE_PANELS.findIndex((panel) => panel.id === sidePanel);
              const last = SIDE_PANELS.length - 1;
              const next =
                event.key === "Home" ? 0 : event.key === "End" ? last
                  : event.key === "ArrowRight" ? (index + 1) % SIDE_PANELS.length
                    : (index - 1 + SIDE_PANELS.length) % SIDE_PANELS.length;
              setSidePanel(SIDE_PANELS[next]!.id);
              document.getElementById(`tab-${SIDE_PANELS[next]!.id}`)?.focus();
            }}
          >
            {SIDE_PANELS.map((panel) => (
              <button
                key={panel.id}
                type="button"
                role="tab"
                id={`tab-${panel.id}`}
                aria-selected={sidePanel === panel.id}
                aria-controls={sidePanel === panel.id ? `panel-${panel.id}` : undefined}
                tabIndex={sidePanel === panel.id || (!sidePanel && panel.id === "assistant") ? 0 : -1}
                onClick={() => setSidePanel(sidePanel === panel.id ? null : panel.id)}
              >
                {panel.label}
                {panel.id === "bookmarks" && bookmarks.length > 0 && (
                  <span className="side-tab-count">{bookmarks.length}</span>
                )}
              </button>
            ))}
          </div>
          {sidePanel && (
            <div role="tabpanel" id={`panel-${sidePanel}`} aria-labelledby={`tab-${sidePanel}`}>
              {sidePanel === "assistant" && (
                <AIWorkspace
                  jobId={jobId}
                  segments={segments}
                  beforeGenerate={flushSave}
                  onSource={(id) => {
                    const source = segments.find((s) => s.id === id);
                    if (source) {
                      setSpeakerFilter("");
                      setReview(null);
                      handleSelect(id, false);
                      setCurrentMatchIndex(0);
                      setSelectedSegmentIds(new Set([id]));
                      mediaElement?.play().catch(() => undefined);
                    }
                  }}
                />
              )}
              {sidePanel === "insights" && (
                <InsightsPanel
                  jobId={jobId}
                  version={String(revision)}
                  threshold={threshold}
                  onSeek={(time) => {
                    seekTo(time);
                    const target = containing(segments, time);
                    if (target) handleSelect(target.id, false);
                  }}
                  onKeyword={(term) => {
                    setQuery(term);
                    setSearchVisible(true);
                  }}
                  onReviewUncertain={(ids) => {
                    setReview(ids);
                    setSpeakerFilter("");
                  }}
                />
              )}
              {sidePanel === "bookmarks" && (
                <BookmarksPanel
                  jobId={jobId}
                  bookmarks={bookmarks}
                  currentTime={currentTime}
                  currentSegmentId={containing(segments, currentTime)?.id ?? null}
                  onChange={setBookmarks}
                  onSeek={(time) => {
                    seekTo(time);
                    const target = containing(segments, time);
                    if (target) handleSelect(target.id, false);
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <ShortcutsDialog open={dialog === "shortcuts"} onClose={() => setDialog(null)} />
      {dialog === "retranscribe" && (
        <RetranscribeDialog open jobId={jobId} currentModel={modelName} onClose={() => setDialog(null)} />
      )}
      <ConfirmDialog
        open={dialog === "delete"}
        title="Excluir esta gravação?"
        description={
          <>
            A transcrição, os marcadores, os documentos e os links compartilhados de “{title}” serão
            removidos. O arquivo original também é apagado se nenhuma outra versão o usar. Não é possível desfazer.
          </>
        }
        confirmLabel="Excluir gravação"
        danger
        onConfirm={async () => {
          try {
            await api.deleteJob(jobId);
          } catch (failure) {
            throw new Error(describeError(failure, "Não foi possível excluir a gravação."));
          }
          router.push("/library");
        }}
        onClose={() => setDialog(null)}
      />
    </motion.div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "saving") return <Badge tone="accent">Salvando…</Badge>;
  if (status === "saved") return <Badge tone="success">Salvo</Badge>;
  if (status === "error") return <Badge tone="danger">Falha ao salvar</Badge>;
  return null;
}
