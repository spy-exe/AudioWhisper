export interface WindowsCaptureStatus {
  version: string;
  recording: boolean;
  job_id?: string;
  title?: string;
  source?: string;
  state?: "recording" | "stopping" | "uploaded";
  duration?: number;
  level: number;
  sleep_protected: boolean;
  pending_total: number;
  error?: string | null;
  delivery_error?: string | null;
  recovery_errors: number;
}
export interface CaptureDevice { id: string; name: string; default: boolean }
export interface WindowsCaptureDevices { microphones: CaptureDevice[]; outputs: CaptureDevice[] }

export async function windowsCapture<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`http://127.0.0.1:8765${path}`, {
    method: body ? "POST" : "GET",
    headers: { "X-AudioWhisper-Capture": "1", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    credentials: "omit",
    cache: "no-store",
    signal: AbortSignal.timeout(body ? 25000 : 3000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "O capturador não concluiu a operação.");
  return data;
}
