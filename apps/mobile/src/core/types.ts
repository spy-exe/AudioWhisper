export type Source = "microphone" | "system" | "mixed";
export type Tone = "primary" | "success" | "warning" | "danger" | "muted";
export interface Connection {
  id: string; instance_id: string; url: string; name: string;
  defaults: { model_name: string; device: string; compute_type: string; language: string | null };
}
export interface Connections { current: string; profiles: Connection[] }
export interface Recording {
  id: string; title: string; source: Source | "unknown"; created_at: number;
  connection_id: string; instance_id: string; state: "recording" | "stopped";
  duration: number; frames: number; chunks: number; uploaded_chunks: number;
  stop_sent: boolean; interrupted: boolean; job_id: string | null; error: string | null;
  remote_status?: string; remote_error?: string | null; capture_notice?: string | null;
  recovery_required?: boolean;
}
export interface Snapshot { active_id: string | null; sessions: Recording[]; level: number }
export interface Segment { id: string; segment_index: number; text: string; start: number; end: number; speaker_id: string | null }
export interface Transcript { segments: Segment[]; online: boolean; status: string; stage?: string; error?: string | null }
