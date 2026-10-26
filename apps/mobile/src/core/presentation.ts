import type { Recording, Segment, Tone } from "./types.ts";

export function duration(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const end = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return hours ? `${hours}:${end}` : end;
}
export function connectionUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Informe o endereço do PC, como http://192.168.1.20:8080."); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Use somente o endereço HTTP ou HTTPS do PC, sem caminho, token ou senha.");
  return url.origin;
}
export const sourceLabel = { microphone: "Microfone", system: "Áudio dos aplicativos", mixed: "Microfone e aplicativos", unknown: "Fonte não identificada" } as const;
export function sessionStatus(item: Recording): { label: string; tone: Tone } {
  if (item.recovery_required) return { label: "Recuperação local", tone: "warning" };
  if (item.remote_status === "completed") return { label: "Transcrição concluída", tone: "success" };
  if (item.remote_status === "failed") return { label: "Falha no processamento", tone: "danger" };
  if (item.error) return { label: "Aguardando conexão", tone: "warning" };
  if (item.state === "recording" && item.chunks === 0) return { label: "Preparando áudio", tone: "primary" };
  if (item.uploaded_chunks < item.chunks) return { label: "Áudio salvo no celular", tone: "warning" };
  if (item.state === "recording") return { label: "Ao vivo no PC", tone: "success" };
  if (item.chunks === 0) return { label: "Sem áudio capturado", tone: "muted" };
  return { label: "Concluindo no PC", tone: "primary" };
}
export function pendingCount(items: Recording[]): number {
  return items.filter(item => item.chunks > item.uploaded_chunks).length;
}
export function mergeSegments(previous: Segment[], incoming: Segment[]): Segment[] {
  const result = new Map(previous.map(segment => [segment.id, segment]));
  for (const segment of incoming) result.set(segment.id, segment);
  return [...result.values()].sort((a, b) => a.segment_index - b.segment_index);
}
