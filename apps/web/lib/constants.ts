export const ACCEPTED_EXTENSIONS = [
  "wav",
  "mp3",
  "m4a",
  "aac",
  "flac",
  "ogg",
  "opus",
  "mp4",
  "mkv",
  "mov",
  "webm",
  "avi",
] as const;

export const ACCEPTED_ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export const MODEL_OPTIONS = [
  { value: "small", label: "Small — rápido, menos preciso" },
  { value: "medium", label: "Medium — equilíbrio" },
  { value: "turbo", label: "Turbo (large-v3) — recomendado" },
  { value: "large-v3", label: "Large-v3 — mais preciso, mais lento" },
] as const;

export const LANGUAGE_OPTIONS = [
  { value: "", label: "Detectar automaticamente" },
  { value: "pt", label: "Português" },
  { value: "en", label: "Inglês" },
  { value: "es", label: "Espanhol" },
  { value: "fr", label: "Francês" },
  { value: "de", label: "Alemão" },
  { value: "it", label: "Italiano" },
  { value: "ja", label: "Japonês" },
  { value: "zh", label: "Chinês" },
] as const;

export const BOOKMARK_COLORS = [
  { value: "amber", label: "Âmbar", swatch: "var(--color-amber)" },
  { value: "blue", label: "Azul", swatch: "var(--color-accent)" },
  { value: "violet", label: "Violeta", swatch: "var(--color-accent-violet)" },
  { value: "spectral", label: "Verde-água", swatch: "var(--color-accent-spectral)" },
  { value: "rose", label: "Rosa", swatch: "var(--color-danger)" },
] as const;

export const DEFAULT_LOW_CONFIDENCE = 0.6;
