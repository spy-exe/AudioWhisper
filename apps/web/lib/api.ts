import type {
  ApiErrorBody,
  AppSettings,
  Bookmark,
  BookmarkColor,
  BulkResult,
  ExportFile,
  ExportFormat,
  GpuDiagnostics,
  HealthStatus,
  MediaFile,
  LibraryPage,
  Organization,
  AIDocument,
  IntelligenceStatus,
  LibraryFacets,
  LibraryStats,
  QueueStatus,
  SearchPage,
  ShareLink,
  StorageInfo,
  TranscriptionJob,
  TranscriptionSettings,
  TranscriptSegment,
  TranscriptStats,
} from "./types";

export const NETWORK_ERROR_MESSAGE =
  "Sem conexão com o AudioWhisper. Verifique a rede e tente novamente.";

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

/** A readable message for any failure: API errors keep their own text, aborts stay silent. */
export function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const fields = error.details?.fields as Record<string, string> | undefined;
    if (fields && Object.keys(fields).length)
      return `${error.message} ${Object.values(fields).join(" ")}`;
    return error.message || fallback;
  }
  return fallback;
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    // fetch only rejects for network failures and aborts; aborts must stay recognizable.
    if (isAbort(error)) throw error;
    throw new ApiError(0, {
      error: {
        code: "NETWORK_ERROR",
        message: NETWORK_ERROR_MESSAGE,
        details: {},
        request_id: null,
      },
    });
  }

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
  integrations: () =>
    request<{ smtp_available: boolean; diarization_configured: boolean }>(
      "/api/integrations",
    ),
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
    includeSpeakers = true,
  ) =>
    request<ExportFile[]>(`/api/jobs/${jobId}/exports`, {
      method: "POST",
      body: JSON.stringify({
        formats,
        include_timestamps: includeTimestamps,
        include_speakers: includeSpeakers,
      }),
    }),
  listExports: (jobId: string) =>
    request<ExportFile[]>(`/api/jobs/${jobId}/exports`),
  downloadExportUrl: (exportId: string) => `/api/exports/${exportId}/download`,

  mediaFileUrl: (mediaId: string) => `/api/media/${mediaId}/stream`,

  deleteJob: (jobId: string) =>
    request<void>(`/api/jobs/${jobId}`, { method: "DELETE" }),
  retranscribe: (jobId: string, settings: TranscriptionSettings) =>
    request<TranscriptionJob>(`/api/jobs/${jobId}/retranscribe`, {
      method: "POST",
      body: JSON.stringify(settings),
    }),
  stats: (jobId: string, threshold?: number) =>
    request<TranscriptStats>(
      `/api/jobs/${jobId}/stats${threshold ? `?threshold=${threshold}` : ""}`,
    ),
  splitSegment: (jobId: string, segmentId: string, offset: number) =>
    request<TranscriptSegment[]>(
      `/api/jobs/${jobId}/segments/${segmentId}/split`,
      { method: "POST", body: JSON.stringify({ offset }) },
    ),
  mergeSegments: (jobId: string, segmentIds: string[]) =>
    request<TranscriptSegment[]>(`/api/jobs/${jobId}/segments/merge`, {
      method: "POST",
      body: JSON.stringify({ segment_ids: segmentIds }),
    }),

  bookmarks: (jobId: string) =>
    request<Bookmark[]>(`/api/jobs/${jobId}/bookmarks`),
  createBookmark: (
    jobId: string,
    values: {
      start: number;
      label: string;
      note?: string;
      color?: BookmarkColor;
      segment_id?: string | null;
    },
  ) =>
    request<Bookmark>(`/api/jobs/${jobId}/bookmarks`, {
      method: "POST",
      body: JSON.stringify(values),
    }),
  updateBookmark: (
    id: string,
    values: Partial<Pick<Bookmark, "start" | "label" | "note" | "color">>,
  ) =>
    request<Bookmark>(`/api/bookmarks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    }),
  deleteBookmark: (id: string) =>
    request<void>(`/api/bookmarks/${id}`, { method: "DELETE" }),

  addSpeaker: (jobId: string, name: string) =>
    request<Organization & { speaker_id: string }>(
      `/api/jobs/${jobId}/speakers`,
      { method: "POST", body: JSON.stringify({ name }) },
    ),
  mergeSpeakers: (jobId: string, source: string, target: string) =>
    request<Organization & { moved_segments: number }>(
      `/api/jobs/${jobId}/speakers/merge`,
      { method: "POST", body: JSON.stringify({ source, target }) },
    ),
  removeSpeaker: (jobId: string, speakerId: string) =>
    request<Organization & { cleared_segments: number }>(
      `/api/jobs/${jobId}/speakers/${encodeURIComponent(speakerId)}`,
      { method: "DELETE" },
    ),
  assignSpeakers: (
    jobId: string,
    segmentIds: string[],
    speakerId: string | null,
  ) =>
    request<TranscriptSegment[]>(`/api/jobs/${jobId}/segments/speaker`, {
      method: "PUT",
      body: JSON.stringify({ segment_ids: segmentIds, speaker_id: speakerId }),
    }),

  search: (params: URLSearchParams, signal?: AbortSignal) =>
    request<SearchPage>(`/api/search?${params}`, { signal }),
  libraryFacets: () => request<LibraryFacets>("/api/library/facets"),
  libraryStats: () => request<LibraryStats>("/api/library/stats"),
  bulk: (
    payload:
      | { action: "delete"; job_ids: string[] }
      | {
          action: "organize";
          job_ids: string[];
          folder?: string;
          project?: string;
          add_tags?: string[];
        },
  ) =>
    request<BulkResult>("/api/library/bulk", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  exportBundleUrl: (
    jobId: string,
    options: { includeTimestamps?: boolean; includeSpeakers?: boolean } = {},
  ) =>
    `/api/jobs/${jobId}/exports/bundle?include_timestamps=${options.includeTimestamps ?? true}&include_speakers=${options.includeSpeakers ?? true}`,
  deleteDocument: (id: string) =>
    request<void>(`/api/documents/${id}`, { method: "DELETE" }),

  storage: () => request<StorageInfo>("/api/system/storage"),
  cleanup: (target: "tmp" | "exports") =>
    request<{ target: string; freed_bytes: number; removed: number }>(
      "/api/system/cleanup",
      { method: "POST", body: JSON.stringify({ target }) },
    ),
  queue: () => request<QueueStatus>("/api/system/queue"),
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
          // A proxy error page (HTML) instead of the API's JSON body.
          reject(
            new ApiError(xhr.status, {
              error: {
                code: `HTTP_${xhr.status}`,
                message:
                  xhr.status === 413
                    ? "O arquivo excede o limite de envio configurado no servidor."
                    : `O servidor não aceitou o envio (${xhr.status}). Tente novamente.`,
                details: {},
                request_id: null,
              },
            }),
          );
        }
      }
    });

    xhr.addEventListener("error", () =>
      reject(
        new ApiError(0, {
          error: {
            code: "NETWORK_ERROR",
            message: "Falha de rede durante o upload. Tente enviar novamente.",
            details: {},
            request_id: null,
          },
        }),
      ),
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
