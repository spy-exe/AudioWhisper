"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "@/contexts/SettingsContext";
import { useJobProgress } from "@/hooks/useJobProgress";
import { formatDuration } from "@/lib/format";
import {
  windowsCapture,
  type WindowsCaptureDevices,
  type WindowsCaptureStatus,
} from "@/lib/windows-capture";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { TranscriptFeed } from "@/components/jobs/TranscriptFeed";
import { CaptureSources } from "./CaptureSources";

export function WindowsCapture({
  onRecordingChange,
  onBusyChange,
}: {
  onRecordingChange: (active: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { settings } = useSettings();
  const [status, setStatus] = useState<WindowsCaptureStatus | null>(null);
  const [devices, setDevices] = useState<WindowsCaptureDevices>({
    microphones: [],
    outputs: [],
  });
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [transportError, setTransportError] = useState("");
  const commanding = useRef(false);
  const statusEpoch = useRef(0);
  const [source, setSource] = useState("mixed");
  const [title, setTitle] = useState("");
  const [microphone, setMicrophone] = useState("");
  const [output, setOutput] = useState("");
  const [preventSleep, setPreventSleep] = useState(true);
  const { job, newSegments, provisionalSegments, connectionError } =
    useJobProgress(status?.job_id ?? null);

  const connect = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const next = await windowsCapture<WindowsCaptureStatus>("/status");
      setStatus(next);
      setConnected(true);
      const inputs = await windowsCapture<WindowsCaptureDevices>("/devices");
      setDevices(inputs);
    } catch (e) {
      setError(
        e instanceof Error && !/fetch|network|timeout/i.test(e.message)
          ? e.message
          : "O capturador Windows não está conectado. Inicie-o e tente conectar novamente.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void connect();
  }, [connect]);
  useEffect(() => {
    onRecordingChange(status?.recording ?? false);
  }, [status?.recording, onRecordingChange]);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const epoch = statusEpoch.current;
      try {
        const next = await windowsCapture<WindowsCaptureStatus>("/status");
        if (active && !commanding.current && epoch === statusEpoch.current) {
          setStatus(next);
          setTransportError("");
        }
      } catch {
        if (active)
          setTransportError(
            "Conexão com o capturador perdida. A gravação pode continuar no Windows. Reconectando automaticamente…",
          );
      } finally {
        if (active) timer = setTimeout(poll, 2000);
      }
    };
    timer = setTimeout(poll, 2000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [connected]);

  const command = async (stop: boolean) => {
    if (commanding.current) return;
    commanding.current = true;
    statusEpoch.current += 1;
    setBusy(true);
    setError("");
    try {
      const next = await windowsCapture<WindowsCaptureStatus>(
        stop ? "/stop" : "/start",
        stop
          ? {}
          : {
              title:
                title.trim() ||
                `Gravação ${new Date().toLocaleString("pt-BR")}`,
              source,
              microphone,
              output,
              prevent_sleep: preventSleep,
              settings: {
                model_name: settings?.default_model ?? "turbo",
                device: settings?.transcription_device ?? "cuda",
                compute_type: settings?.transcription_compute_type ?? "float16",
                word_timestamps: true,
              },
            },
      );
      setStatus(next);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível controlar o capturador. Verifique o ícone na bandeja do Windows.",
      );
    } finally {
      statusEpoch.current += 1;
      commanding.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <section
        className="capture-panel space-y-5"
        aria-label="Capturador Windows"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="capture-symbol">
              <Icon name="studio" />
            </span>
            <div>
              <h2 className="ingest-heading">Gravação em segundo plano</h2>
              <p className="mt-1 text-xs text-text-muted">
                {status?.recording
                  ? "Gravando no Windows · pode fechar o navegador"
                  : connected
                    ? "Capturador Windows conectado"
                    : "Conecte seu capturador local"}
              </p>
            </div>
          </div>
          {status?.job_id && (
            <span className="font-mono text-sm text-accent">
              {formatDuration(status.duration ?? 0)}
            </span>
          )}
        </div>
        <p className="text-xs leading-relaxed text-text-secondary">
          Pode fechar o navegador. Mantenha o capturador e o Docker em execução.
        </p>
        {!connected && (
          <div className="space-y-3 rounded-xl border border-border bg-background p-4 text-xs leading-relaxed">
            <p>Na pasta do AudioWhisper, execute uma vez no PowerShell:</p>
            <code className="block break-all text-accent">
              .\scripts\Start-Capturador.ps1
            </code>
            <p className="text-text-muted">
              Ele fica na bandeja do Windows, onde você também pode encerrar a
              gravação. Se o navegador pedir, permita a conexão ao dispositivo
              local.
            </p>
            <Button size="sm" disabled={busy} onClick={connect}>
              {busy ? "Conectando…" : "Conectar capturador"}
            </Button>
          </div>
        )}
        {connected && !status?.recording && (
          <div className="space-y-4">
            <input
              className="field w-full"
              aria-label="Título da gravação no Windows"
              placeholder="Título da gravação"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
            <CaptureSources
              source={source}
              onChange={setSource}
              disabled={busy}
            />
            <details className="hub-disclosure" open={source === "obs"}>
              <summary>Dispositivos de áudio</summary>
              <div className="space-y-3 pt-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {(source === "mixed" || source === "system") && (
                    <label className="space-y-2 text-xs">
                      Saída do desktop
                      <select
                        className="field w-full"
                        value={output}
                        disabled={busy}
                        onChange={(e) => setOutput(e.target.value)}
                      >
                        <option value="">Saída padrão do Windows</option>
                        {devices.outputs.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {source !== "system" && (
                    <label className="space-y-2 text-xs">
                      Microfone / entrada
                      <select
                        className="field w-full"
                        value={microphone}
                        disabled={busy}
                        onChange={(e) => setMicrophone(e.target.value)}
                      >
                        <option value="">Entrada padrão do Windows</option>
                        {devices.microphones.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {source === "mixed" && (
                  <p className="text-xs leading-relaxed text-text-muted">
                    Use fones para evitar que o microfone grave novamente o som
                    dos alto-falantes.
                  </p>
                )}
                <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-text-secondary">
                  <input
                    type="checkbox"
                    className="mt-1 h-6 w-6 shrink-0 accent-accent"
                    checked={preventSleep}
                    onChange={(e) => setPreventSleep(e.target.checked)}
                  />
                  Evitar suspensão automática do Windows enquanto grava
                </label>
              </div>
            </details>
            <Button
              variant="primary"
              className="w-full"
              disabled={busy || !settings}
              onClick={() => command(false)}
            >
              {busy ? "Preparando…" : "Iniciar no Windows"}
            </Button>
          </div>
        )}
        {status?.recording && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-xs text-success">
                ● Gravando no Windows
              </span>
              <div
                className="h-2 min-w-20 flex-1 overflow-hidden rounded-full bg-surface-interactive"
                role="meter"
                aria-label="Nível de áudio do Windows"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(status.level * 100)}
              >
                <div
                  className="h-full bg-accent transition-[width] duration-150"
                  style={{ width: `${Math.round(status.level * 100)}%` }}
                />
              </div>
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => command(true)}
              >
                {busy ? "Encerrando…" : "Encerrar no Windows"}
              </Button>
            </div>
            <p className="text-xs text-text-muted">
              {status.sleep_protected
                ? "Proteção contra suspensão automática ativa. A tela pode apagar."
                : "Evite suspender o computador durante a gravação."}
            </p>
          </div>
        )}
        {status?.job_id && (
          <Link
            className="text-sm text-accent hover:underline"
            href={`/jobs/${status.job_id}`}
          >
            Abrir transcrição →
          </Link>
        )}
        {!!status?.pending_total && (
          <p className="text-xs text-warning">
            {status.pending_total} trechos salvos no Windows aguardando envio
            automático
          </p>
        )}
        {!!status?.recovery_errors && (
          <p role="alert" className="text-xs text-warning">
            Uma captura requer recuperação manual. Os arquivos continuam na
            pasta de recuperação do capturador.
          </p>
        )}
        {(error ||
          transportError ||
          status?.error ||
          status?.delivery_error ||
          connectionError) && (
          <p role="alert" className="text-xs leading-relaxed text-warning">
            {error ||
              transportError ||
              status?.error ||
              status?.delivery_error ||
              connectionError}
          </p>
        )}
      </section>
      {status?.job_id && job?.status !== "completed" && (
        <TranscriptFeed
          segments={newSegments}
          provisional={provisionalSegments}
          pending={status.recording}
        />
      )}
    </div>
  );
}
