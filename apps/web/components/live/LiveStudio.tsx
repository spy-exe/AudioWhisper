"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";
import { LiveAudio, type CapturedChunk } from "@/lib/live-audio";
import {
  liveStore,
  type StoredCapture,
  type StoredChunk,
} from "@/lib/live-store";
import { useSettings } from "@/contexts/SettingsContext";
import { useJobProgress } from "@/hooks/useJobProgress";
import { TranscriptFeed } from "@/components/jobs/TranscriptFeed";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export function LiveStudio() {
  const pathname = usePathname();
  const { settings } = useSettings();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [source, setSource] = useState("microphone");
  const [device, setDevice] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [title, setTitle] = useState("");
  const [capture, setCapture] = useState<StoredCapture | null>(null);
  const captureRef = useRef<StoredCapture | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const engine = useRef<LiveAudio | null>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const uploads = useRef<Promise<unknown>>(Promise.resolve());
  const { job, newSegments, provisionalSegments, connectionError } =
    useJobProgress(capture?.jobId ?? null);

  useEffect(() => {
    setSlot(
      pathname === "/" ? document.getElementById("live-capture-slot") : null,
    );
  }, [pathname]);
  useEffect(() => {
    let active = true;
    liveStore
      .capture()
      .then((saved) => {
        if (active && saved) {
          captureRef.current = saved;
          setCapture(saved);
          setSeconds(saved.duration);
        }
      })
      .catch(() => {
        if (active)
          setError(
            "O armazenamento de recuperação não está disponível neste navegador.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [recording]);
  useEffect(() => () => engine.current?.release(), []);
  useEffect(() => {
    if (job?.status === "completed" && job.id === capture?.jobId) {
      void liveStore.clear().catch(() => undefined);
    }
  }, [job?.status, job?.id, capture?.jobId]);

  const upload = useCallback(async (chunk: StoredChunk) => {
    const body = new FormData();
    body.append("file", chunk.blob, "chunk.wav");
    const params = new URLSearchParams({
      start: String(chunk.start),
      revision: String(chunk.revision),
      final: String(chunk.final),
    });
    const response = await fetch(
      `/api/live/${chunk.jobId}/chunks/${chunk.sequence}?${params}`,
      { method: "POST", body },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(
        data?.detail ??
          data?.error?.message ??
          "Trecho pendente. Verifique a conexão e recupere a captura.",
      );
    }
    await liveStore.putChunk({ ...chunk, uploaded: true });
  }, []);
  const queue = useCallback(
    (data: CapturedChunk, jobId: string) => {
      const stored: StoredChunk = {
        ...data,
        id: `${jobId}-${data.sequence}-${data.revision}`,
        jobId,
        uploaded: false,
      };
      setPending((n) => n + 1);
      // Persist independently of network latency so later audio remains recoverable.
      const persisted = writes.current
        .then(async () => {
          await liveStore.putChunk(stored); // Commit locally before attempting the network.
          if (captureRef.current) {
            captureRef.current.duration = Math.max(
              captureRef.current.duration,
              stored.start + (stored.blob.size - 44) / 32000,
            );
            await liveStore.putCapture(captureRef.current);
          }
          return true;
        })
        .catch(() => {
          setError(
            "Não foi possível preservar o trecho no navegador. Encerre a captura e verifique o espaço em disco.",
          );
          return false;
        });
      writes.current = persisted;
      uploads.current = uploads.current
        .catch(() => undefined)
        .then(async () => {
          if (!(await persisted)) return;
          try {
            await upload(stored);
            setPending((n) => Math.max(0, n - 1));
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Áudio preservado neste navegador. Recupere a captura após reconectar.",
            );
          }
        });
    },
    [upload],
  );

  const stop = useCallback(async () => {
    if (!engine.current || busy) return;
    setBusy(true);
    try {
      const result = await engine.current.stop();
      engine.current = null;
      setRecording(false);
      await uploads.current;
      const saved = { ...captureRef.current!, ...result };
      captureRef.current = saved;
      setCapture(saved);
      await liveStore.putCapture(saved);
      const response = await fetch(`/api/live/${saved.jobId}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      });
      if (!response.ok)
        throw new Error(
          "Não foi possível encerrar no servidor. Use Recuperar captura.",
        );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Falha ao encerrar. O áudio salvo pode ser recuperado.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const start = async () => {
    if (busy || capture) return;
    setBusy(true);
    setError("");
    let created: StoredCapture | null = null;
    try {
      // Verify persistence before requesting access to an audio source.
      await liveStore.chunks();
      const response = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:
            title.trim() || `Captura ${new Date().toLocaleString("pt-BR")}`,
          source,
          settings: {
            model_name: settings?.default_model ?? "turbo",
            device: settings?.transcription_device ?? "cuda",
            compute_type: settings?.transcription_compute_type ?? "float16",
            word_timestamps: true,
          },
        }),
      });
      if (!response.ok)
        throw new Error("Não foi possível criar a captura no servidor.");
      const next = await response.json();
      created = {
        id: "capture",
        jobId: next.id,
        title: title || "Nova captura",
        duration: 0,
      };
      captureRef.current = created;
      await liveStore.putCapture(created);
      setCapture(created);
      const audio = new LiveAudio(
        (chunk) => queue(chunk, next.id),
        (value, duration) => {
          setLevel(value);
          setSeconds(duration);
        },
      );
      engine.current = audio;
      audio.onEnded = () => {
        setError(
          "A fonte de áudio foi encerrada. Finalize a captura para consolidar o que foi gravado.",
        );
      };
      await audio.start(source, device);
      setRecording(true);
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput"));
    } catch (e) {
      engine.current?.release();
      engine.current = null;
      if (created) {
        try {
          await fetch(`/api/live/${created.jobId}/stop`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expected_chunks: 0, duration: 0 }),
          });
          await liveStore.clear();
        } catch {
          /* Keep recovery data when the server cannot confirm. */
        }
      }
      captureRef.current = null;
      setCapture(null);
      setError(
        e instanceof Error
          ? e.message
          : "Permita o acesso ao áudio e tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  };

  const recover = async () => {
    if (!capture || busy) return;
    setBusy(true);
    setError("");
    try {
      const all = (await liveStore.chunks()).filter(
        (c) => c.jobId === capture.jobId,
      );
      const latest = new Map<number, StoredChunk>();
      for (const chunk of all)
        if (
          !latest.has(chunk.sequence) ||
          latest.get(chunk.sequence)!.revision < chunk.revision
        )
          latest.set(chunk.sequence, chunk);
      for (let chunk of latest.values()) {
        if (!recording && !chunk.final) {
          chunk = {
            ...chunk,
            final: true,
            revision: chunk.revision + 1,
            id: `${capture.jobId}-${chunk.sequence}-${chunk.revision + 1}`,
            uploaded: false,
          };
          await liveStore.putChunk(chunk);
        }
        if (!chunk.uploaded) await upload(chunk);
      }
      setPending(0);
      if (!recording) {
        const expected =
          capture.expected_chunks ??
          (latest.size ? Math.max(...latest.keys()) + 1 : 0);
        const response = await fetch(`/api/live/${capture.jobId}/stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expected_chunks: expected,
            duration: capture.duration,
          }),
        });
        if (!response.ok)
          throw new Error(
            "Servidor indisponível. Os trechos continuam preservados neste navegador.",
          );
        await fetch(`/api/live/${capture.jobId}/retry`, { method: "POST" });
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível recuperar a captura.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (pathname.startsWith("/shared/")) return null;
  const completed = job?.status === "completed" && job.id === capture?.jobId;
  const controls = (
    <section
      className="capture-panel space-y-5"
      aria-label="Live Studio"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="capture-symbol">
            <Icon name="mic" />
          </span>
          <div>
            <h2 className="ingest-heading">Live Studio</h2>
            <p className="mt-1 text-xs text-text-muted">
              {recording
                ? "Capturando e transcrevendo"
                : completed
                  ? "Gravação consolidada"
                  : capture
                    ? "Captura preservada · recuperação disponível"
                    : "Uma conversa começa aqui."}
            </p>
          </div>
        </div>
        {capture && (
          <span className="font-mono text-sm text-accent">
            {formatDuration(seconds)}
          </span>
        )}
      </div>
      {!capture && (
        <div className="space-y-4">
          <input
            aria-label="Título da captura"
            className="field w-full"
            placeholder="Dê um nome à conversa…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <fieldset disabled={busy}>
            <legend className="mb-3 text-sm font-semibold">O que você quer gravar?</legend>
            <div className="capture-sources">
              {[
                { value: "microphone", label: "Microfone", description: "Sua voz e o ambiente" },
                { value: "system", label: "Áudio do desktop", description: "O som dos aplicativos" },
                { value: "mixed", label: "Desktop e microfone", description: "A conversa dos dois lados" },
                { value: "obs", label: "OBS / entrada virtual", description: "Uma entrada de áudio dedicada" },
              ].map((option) => (
                <label key={option.value} className="capture-source">
                  <input type="radio" name="capture-source" value={option.value}
                    checked={source === option.value} onChange={() => setSource(option.value)} />
                  <span>
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className="mt-1 block text-xs text-text-muted">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {(source === "system" || source === "mixed") && (
            <p className="rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs leading-relaxed text-text-secondary">
              No Chrome ou Edge, selecione a tela ou aba e marque <strong>Compartilhar áudio</strong>.
              {" "}Somente o áudio é gravado; o vídeo da tela não é salvo.
            </p>
          )}
        </div>
      )}
      {!capture && source !== "system" && (
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="field w-auto max-w-full"
            aria-label="Dispositivo de áudio"
            value={device}
            onChange={(e) => setDevice(e.target.value)}
          >
            <option value="">Dispositivo padrão</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Entrada de áudio"}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            onClick={async () => {
              try {
                const permission = await navigator.mediaDevices.getUserMedia({
                  audio: true,
                });
                permission.getTracks().forEach((t) => t.stop());
                setDevices(
                  (await navigator.mediaDevices.enumerateDevices()).filter(
                    (d) => d.kind === "audioinput",
                  ),
                );
              } catch {
                setError(
                  "Permita o microfone para listar os dispositivos disponíveis.",
                );
              }
            }}
          >
            Listar entradas
          </Button>
          {source === "obs" && (
            <p className="text-xs leading-relaxed text-text-muted">
              No OBS, encaminhe a monitoração para um cabo de áudio virtual e
              selecione essa entrada.
            </p>
          )}
        </div>
      )}
      {!capture && (
        <Button disabled={busy || !settings} variant="primary" onClick={start} className="w-full">
          <Icon name="mic" />
          {busy ? "Preparando…" : "Iniciar captura"}
        </Button>
      )}
      {!completed && (
        <p className="text-xs leading-relaxed text-text-muted">
          Pode minimizar ou trocar de aba. Mantenha esta aba aberta e o computador ligado durante a captura.
          {" "}O Whisper processa os trechos em segundo plano.
        </p>
      )}
      {recording && (
        <div className="flex items-center gap-4">
          <span className="text-xs text-success">● Gravando</span>
          <div
            className="h-2 flex-1 overflow-hidden rounded-full bg-surface-interactive"
            aria-label="Nível de áudio"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level * 100)}
          >
            <div
              className="h-full bg-accent transition-[width] duration-150"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
          <Button variant="danger" size="sm" disabled={busy} onClick={stop}>
            Encerrar captura
          </Button>
        </div>
      )}
      {capture && (
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/jobs/${capture.jobId}`}
            className="text-xs text-accent hover:underline"
          >
            Abrir transcrição →
          </Link>
          {!completed && (
            <Button size="sm" disabled={busy} onClick={recover}>
              {busy ? "Recuperando…" : "Recuperar captura"}
            </Button>
          )}
          {completed && (
            <Button
              size="sm"
              onClick={() => {
                captureRef.current = null;
                setCapture(null);
                setSeconds(0);
                setError("");
                setPending(0);
              }}
            >
              Nova captura
            </Button>
          )}
          {pending > 0 && (
            <span className="text-xs text-warning">
              {pending} atualizações pendentes
            </span>
          )}
        </div>
      )}
      {(error || connectionError) && (
        <p role="alert" className="text-xs leading-relaxed text-warning">
          {error || connectionError}
        </p>
      )}
    </section>
  );
  if (slot)
    return createPortal(
      <div className="space-y-5">
        {controls}
        {capture && !completed && (
          <TranscriptFeed
            segments={newSegments}
            provisional={provisionalSegments}
            pending={recording}
          />
        )}
      </div>,
      slot,
    );
  return capture && !completed ? (
    <div className="fixed right-4 bottom-4 left-4 z-40 max-w-lg shadow-xl lg:left-auto">
      {controls}
    </div>
  ) : null;
}
