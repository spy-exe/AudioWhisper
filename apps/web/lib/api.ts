import type {
  ApiErrorBody,
  AppSettings,
  ExportFile,
  ExportFormat,
  GpuDiagnostics,
  HealthStatus,
  MediaFile,
  LibraryPage,
  Organization,
  AIDocument,
  IntelligenceStatus,
  ShareLink,
  TranscriptionJob,
  TranscriptionSettings,
  TranscriptSegment,
} from "./types";

export class ApiError extends Error {
  code: string;
  details: Record<string, unknown>;
  status: number;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error.code;
    this.details = body.error.details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined")
      window.dispatchEvent(new Event("audiowhisper:unauthorized"));
    let body: ApiErrorBody;
    try {
      body = await res.json();
    } catch {
      body = {
        error: {
          code: "UNKNOWN",
          message: res.statusText,
          details: {},
          request_id: null,
        },
      };
    }
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export const api = {
  intelligence: () => request<IntelligenceStatus>("/api/intelligence"),
  documents: (jobId: string) =>
    request<AIDocument[]>(`/api/jobs/${jobId}/documents`),
  generateDocument: (
    jobId: string,
    kind: string,
    model: string,
    instruction: string,
  ) =>
    request<AIDocument>(`/api/jobs/${jobId}/documents`, {
      method: "POST",
      body: JSON.stringify({ kind, model, instruction }),
    }),
  reviewDocument: (id: string, markdown: string, reviewed: boolean) =>
    request<AIDocument>(`/api/documents/${id}`, {
      method: "PUT",
      body: JSON.stringify({ markdown, reviewed }),
    }),
  documentDownloadUrl: (id: string, format: string) =>
    `/api/documents/${id}/download?format=${format}`,
  shares: (id: string) => request<ShareLink[]>(`/api/documents/${id}/shares`),
  createShare: (id: string, hours: number) =>
    request<ShareLink & { path: string }>(`/api/documents/${id}/shares`, {
      method: "POST",
      body: JSON.stringify({ expires_hours: hours }),
    }),
  revokeShare: (id: string) =>
    request(`/api/shares/${id}`, { method: "DELETE" }),
  emailDocument: (
    id: string,
    recipient: string,
    subject: string,
    requestId: string,
  ) =>
    request<{ status: string }>(`/api/documents/${id}/email`, {
      method: "POST",
      body: JSON.stringify({ recipient, subject, request_id: requestId }),
    }),
  diarize: (jobId: string) =>
    request(`/api/jobs/${jobId}/diarize`, { method: "POST" }),
  assignSpeaker: (
    jobId: string,
    segment: TranscriptSegment,
    speakerId: string | null,
  ) =>
    request<TranscriptSegment>(`/api/jobs/${jobId}/segments/${segment.id}`, {
      method: "PATCH",
      body: JSON.stringify({ text: segment.text, speaker_id: speakerId }),
    }),
  library: (params: URLSearchParams, signal?: AbortSignal) =>
    request<LibraryPage>(`/api/library?${params}`, { signal }),
  organization: (jobId: string) =>
    request<Organization>(`/api/library/${jobId}`),
  organize: (jobId: string, values: Organization) =>
    request<Organization>(`/api/library/${jobId}`, {
      method: "PUT",
      body: JSON.stringify(values),
    }),
  health: () => request<HealthStatus>("/api/health"),
  healthGpu: () => request<GpuDiagnostics>("/api/health/gpu"),

  getSettings: () => request<AppSettings>("/api/settings"),
  updateSettings: (values: Partial<AppSettings>) =>
    request<AppSettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ values }),
    }),

  uploadMedia: (
    file: File,
    onProgress?: (pct: number) => void,
    signal?: AbortSignal,
  ) => uploadWithProgress(file, onProgress, signal),

  listMedia: () => request<MediaFile[]>("/api/media"),
  getMedia: (id: string) => request<MediaFile>(`/api/media/${id}`),
  deleteMedia: (id: string) =>
    request<void>(`/api/media/${id}`, { method: "DELETE" }),

  createJob: (mediaFileId: string, settings: TranscriptionSettings) =>
    request<TranscriptionJob>("/api/jobs", {
      method: "POST",
      body: JSON.stringify({ media_file_id: mediaFileId, settings }),
    }),
  listJobs: () => request<TranscriptionJob[]>("/api/jobs"),
  getJob: (id: string) => request<TranscriptionJob>(`/api/jobs/${id}`),
  cancelJob: (id: string) =>
    request<TranscriptionJob>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  retryJob: (id: string) =>
    request<TranscriptionJob>(`/api/jobs/${id}/retry`, { method: "POST" }),

  getSegments: (jobId: string) =>
    request<TranscriptSegment[]>(`/api/jobs/${jobId}/segments`),
  updateSegment: (
    jobId: string,
    segmentId: string,
    text: string,
    start?: number,
    end?: number,
  ) =>
    request<TranscriptSegment>(`/api/jobs/${jobId}/segments/${segmentId}`, {
      method: "PATCH",
      body: JSON.stringify({ text, start, end }),
    }),
  replaceTranscript: (
    jobId: string,
    segments: { text: string; start?: number; end?: number }[],
  ) =>
    request<TranscriptSegment[]>(`/api/jobs/${jobId}/transcript`, {
      method: "PUT",
      body: JSON.stringify({ segments }),
    }),

  createExports: (
    jobId: string,
    formats: ExportFormat[],
    includeTimestamps = true,
  ) =>
    request<ExportFile[]>(`/api/jobs/${jobId}/exports`, {
      method: "POST",
      body: JSON.stringify({ formats, include_timestamps: includeTimestamps }),
    }),
  listExports: (jobId: string) =>
    request<ExportFile[]>(`/api/jobs/${jobId}/exports`),
  downloadExportUrl: (exportId: string) => `/api/exports/${exportId}/download`,

  mediaFileUrl: (mediaId: string) => `/api/media/${mediaId}/stream`,
};

function uploadWithProgress(
  file: File,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<MediaFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media/upload");

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as MediaFile);
      } else {
        try {
          const body = JSON.parse(xhr.responseText) as ApiErrorBody;
          reject(new ApiError(xhr.status, body));
        } catch {
          reject(new Error(`Upload falhou (${xhr.status})`));
        }
      }
    });

    xhr.addEventListener("error", () =>
      reject(new Error("Falha de rede durante o upload")),
    );
    xhr.addEventListener("abort", () =>
      reject(new DOMException("Upload cancelado", "AbortError")),
    );

    if (signal) {
      signal.addEventListener("abort", () => xhr.abort());
    }

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
}
