export type JobStatus =
  | "queued"
  | "preparing"
  | "extracting_audio"
  | "loading_model"
  | "transcribing"
  | "generating_exports"
  | "completed"
  | "failed"
  | "cancelled";

export const TERMINAL_STATUSES: readonly JobStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export type MediaType = "audio" | "video";
export type ExportFormat =
  "txt" | "markdown" | "json" | "srt" | "vtt" | "pdf" | "docx";

export interface MediaFile {
  id: string;
  original_name: string;
  mime_type: string;
  extension: string;
  size_bytes: number;
  sha256: string;
  duration_seconds: number | null;
  media_type: MediaType;
  metadata: Record<string, unknown> | null;
  created_at: string;
  is_duplicate: boolean;
  duplicate_of_job_ids: string[];
}

export interface TranscriptionSettings {
  model_name: string;
  language: string | null;
  device: string;
  compute_type: string;
  beam_size: number;
  vad_enabled: boolean;
  word_timestamps: boolean;
  translate_to_english: boolean;
  temperature: number;
}

export interface TranscriptionJob {
  id: string;
  media_file_id: string;
  status: JobStatus;
  cancel_requested: boolean;
  progress: number;
  current_stage: string | null;
  model_name: string;
  language_requested: string | null;
  language_detected: string | null;
  compute_type: string;
  device: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  processing_seconds: number | null;
  real_time_factor: number | null;
  created_at: string;
  updated_at: string;
}

export interface Word {
  word: string;
  start: number;
  end: number;
  probability: number | null;
}

export interface TranscriptSegment {
  id: string;
  job_id: string;
  segment_index: number;
  start: number;
  end: number;
  text: string;
  confidence: number | null;
  words: Word[] | null;
  edited: boolean;
  speaker_id?: string | null;
  updated_at: string;
}

export interface ExportFile {
  id: string;
  job_id: string;
  format: ExportFormat;
  size_bytes: number;
  created_at: string;
}

export interface GpuDiagnostics {
  gpu_available: boolean;
  gpu_name: string | null;
  total_memory_mb: number | null;
  free_memory_mb: number | null;
  driver_version: string | null;
  cuda_runtime_version: string | null;
  ctranslate2_version: string | null;
  ctranslate2_cuda_device_count: number | null;
  loaded_model: string | null;
  compute_type: string | null;
  device_in_use: string | null;
  checked_at: number | null;
  error: string | null;
}

export interface HealthStatus {
  status: "ok" | "degraded";
  service: string;
  database: boolean;
  redis: boolean;
  time: number;
}

export interface AppSettings {
  default_model: string;
  transcription_device: string;
  transcription_compute_type: string;
  default_beam_size: number;
  default_vad_enabled: boolean;
  default_word_timestamps: boolean;
  default_translate_to_english: boolean;
  visual_effects_enabled: boolean;
  [key: string]: unknown;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
    request_id: string | null;
  };
}

export interface ProgressEvent {
  type: "snapshot" | "progress" | "error";
  job?: TranscriptionJob;
  segment_count?: number;
  job_id?: string;
  status?: JobStatus;
  progress?: number;
  current_stage?: string | null;
  language_detected?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  new_segments?: TranscriptSegment[];
  segments?: TranscriptSegment[];
  provisional_segments?: TranscriptSegment[];
  ts?: number;
  message?: string;
}

export interface Organization {
  title: string;
  folder: string;
  project: string;
  tags: string[];
  speakers: Record<string, string>;
  diarization_status: string;
  diarization_error: string | null;
}

export interface LibraryItem extends Organization {
  job: TranscriptionJob;
  name: string;
  duration_seconds: number | null;
  media_type: MediaType;
}

export interface LibraryPage {
  items: LibraryItem[];
  total: number;
  offset: number;
  limit: number;
}

export interface EvidenceItem {
  kind: string;
  text: string;
  source_segment_ids: string[];
  evidence_quotes: string[];
  assignee: string | null;
  due_date: string | null;
}

export interface AIDocument {
  id: string;
  job_id: string;
  kind: string;
  model: string;
  status: "queued" | "generating" | "generated" | "reviewed" | "failed";
  markdown: string;
  items: EvidenceItem[];
  error: string | null;
  stale: boolean;
  reviewed_at: string | null;
  created_at: string;
}

export interface IntelligenceStatus {
  provider: string;
  available: boolean;
  models: string[];
  error: string | null;
}

export interface ShareLink {
  id: string;
  expires_at: string;
  revoked: boolean;
}
