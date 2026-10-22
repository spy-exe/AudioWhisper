import type { AppSettings, TranscriptionSettings } from "./types";

/** The full settings sent when a transcription starts, from the saved defaults plus choices
 * made for this recording. Every entry point (upload, capture, new run) uses the same rules. */
export function transcriptionSettingsFrom(
  settings: AppSettings | null,
  overrides: Partial<TranscriptionSettings> = {},
): TranscriptionSettings {
  const vocabulary = settings?.vocabulary?.trim();
  const hotwords = settings?.hotwords?.trim();
  return {
    model_name: settings?.default_model ?? "turbo",
    language: settings?.default_language || null,
    device: settings?.transcription_device ?? "cuda",
    compute_type: settings?.transcription_compute_type ?? "float16",
    beam_size: settings?.default_beam_size ?? 5,
    vad_enabled: settings?.default_vad_enabled ?? true,
    word_timestamps: settings?.default_word_timestamps ?? true,
    translate_to_english: settings?.default_translate_to_english ?? false,
    temperature: 0,
    initial_prompt: vocabulary || null,
    hotwords: hotwords || null,
    ...overrides,
  };
}
