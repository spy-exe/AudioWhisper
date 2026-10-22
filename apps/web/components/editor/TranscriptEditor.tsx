"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import { replaceTranscriptText } from "@/lib/transcript-text";
import type { MediaFile, Organization, TranscriptSegment } from "@/lib/types";
import { AIWorkspace } from "@/components/workspace/AIWorkspace";
import { OrganizationPanel } from "@/components/workspace/OrganizationPanel";
import { MeetingNotebook } from "@/components/hub/NotebookView";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { ExportMenu } from "./ExportMenu";
import { MediaPlayer } from "./MediaPlayer";
import { PlayerControls } from "./PlayerControls";
import { SearchBar } from "./SearchBar";
import { SegmentList } from "./SegmentList";
import { Waveform } from "./Waveform";

const AUTOSAVE_DEBOUNCE_MS = 900;
const UNDO_STACK_LIMIT = 30;

interface TranscriptEditorProps {
  jobId: string;
  media: MediaFile;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function TranscriptEditor({ jobId, media }: TranscriptEditorProps) {
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loadError, setLoadError] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState("");
  const [aiVisible, setAiVisible] = useState(true);
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

  useEffect(() => {
    let active = true;
    Promise.all([api.getSegments(jobId), api.organization(jobId)])
      .then(([text, item]) => {
        if (active) {
          setSegments(text);
          setOrganization(item);
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

  const refreshSegments = useCallback(() => {
    api
      .getSegments(jobId)
      .then(setSegments)
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

  const initialJump = useRef(false);
  useEffect(() => {
    if (!segments || !mediaElement || initialJump.current) return;
    const source = segments.find(segment => segment.id === new URLSearchParams(window.location.search).get("segment"));
    if (!source) return;
    const jump = () => { initialJump.current = true; seekTo(source.start); setSelectedSegmentIds(new Set([source.id])); };
    if (mediaElement.readyState >= 1) jump();
    else mediaElement.addEventListener("loadedmetadata", jump, { once: true });
    return () => mediaElement.removeEventListener("loadedmetadata", jump);
  }, [segments, mediaElement, seekTo]);

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
    navigator.clipboard.writeText(text);
  }, [segments, selectedSegmentIds]);

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

  // --- keyboard shortcuts ---
  useKeyboardShortcuts({
    togglePlay,
    seekBack: () => seekTo(Math.max(0, currentTime - 2)),
    seekForward: () => seekTo(Math.min(duration, currentTime + 2)),
    seekBackBig: () => seekTo(Math.max(0, currentTime - 10)),
    seekForwardBig: () => seekTo(Math.min(duration, currentTime + 10)),
    search: () => setSearchVisible(true),
    save: () => flushSave(),
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="transcript-editor mx-auto flex max-w-[1600px] flex-col gap-6 px-4 py-8 sm:px-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="break-words font-[var(--font-display)] text-2xl font-semibold text-text-primary">
            {organization?.title || media.original_name}
          </h1>
          <p className="text-xs text-text-muted">
            {media.media_type === "video" ? "Vídeo" : "Áudio"} ·{" "}
            {segments.length} segmentos
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={() => setAiVisible(!aiVisible)}
            aria-expanded={aiVisible}
          >
            {aiVisible ? "Recolher documentos" : "Abrir documentos"}
          </Button>
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
          {selectedSegmentIds.size > 0 && (
            <Button variant="ghost" size="sm" onClick={handleCopySelection}>
              Copiar seleção ({selectedSegmentIds.size})
            </Button>
          )}
        </div>
      </div>

      <OrganizationPanel
        jobId={jobId}
        value={organization}
        onChange={setOrganization}
        onDiarized={refreshSegments}
      />
      <div
        className={`grid min-w-0 items-start gap-5 ${aiVisible ? "xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,1fr)]" : ""}`}
      >
        <div className="flex min-w-0 flex-col gap-4">
          {media.media_type === "video" && (
            <MediaPlayer media={media} onElementReady={setMediaElement} />
          )}
          {media.media_type === "audio" && (
            <MediaPlayer media={media} onElementReady={setMediaElement} />
          )}

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
                <select
                  aria-label="Agrupar por falante"
                  className="field w-auto max-w-full"
                  value={speakerFilter}
                  onChange={(e) => setSpeakerFilter(e.target.value)}
                >
                  <option value="">Todos os falantes</option>
                  {Object.entries(organization?.speakers ?? {}).map(
                    ([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ),
                  )}
                </select>
              </div>
            </div>
            <SegmentList
              segments={
                speakerFilter
                  ? segments.filter((s) => s.speaker_id === speakerFilter)
                  : segments
              }
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
            />
          </Panel>
          {loadError && (
            <p role="alert" className="text-xs text-danger">
              {loadError}
            </p>
          )}

          <Panel raised className="flex flex-col gap-2 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Exportar
            </p>
            <ExportMenu jobId={jobId} />
          </Panel>
        </div>
        {aiVisible && (
          <AIWorkspace
            jobId={jobId}
            segments={segments}
            beforeGenerate={flushSave}
            onSource={(id) => {
              const source = segments.find((s) => s.id === id);
              if (source) {
                setSpeakerFilter("");
                handleSelect(id, false);
                setCurrentMatchIndex(0);
                setSelectedSegmentIds(new Set([id]));
                mediaElement?.play().catch(() => undefined);
              }
            }}
          />
        )}
      </div>
      <MeetingNotebook jobId={jobId} segments={segments} currentTime={currentTime} onSource={id => { setSpeakerFilter(""); handleSelect(id, false); mediaElement?.play().catch(() => undefined); }} />
    </motion.div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "saving") return <Badge tone="accent">Salvando…</Badge>;
  if (status === "saved") return <Badge tone="success">Salvo</Badge>;
  if (status === "error") return <Badge tone="danger">Falha ao salvar</Badge>;
  return null;
}
