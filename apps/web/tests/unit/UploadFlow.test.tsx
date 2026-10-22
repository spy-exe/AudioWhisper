import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { UploadDropzone } from "@/components/upload/UploadDropzone";
import { api, ApiError } from "@/lib/api";
import type { MediaFile } from "@/lib/types";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
const saved = { default_model: "medium", default_language: "pt", transcription_device: "cpu", transcription_compute_type: "int8",
  default_beam_size: 4, default_vad_enabled: true, default_word_timestamps: true, default_translate_to_english: false, visual_effects_enabled: true,
  vocabulary: "Opikode", hotwords: "" };
const settingsState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/contexts/SettingsContext", () => ({ useSettings: () => ({ settings: settingsState.current }) }));

const media = { id: "m1", original_name: "reuniao.wav", size_bytes: 2048, duration_seconds: 65, media_type: "audio", is_duplicate: true } as MediaFile;
const file = (name: string) => new File(["audio"], name, { type: "audio/wav" });

beforeEach(() => {
  vi.restoreAllMocks();
  nav.push.mockReset();
  settingsState.current = saved;
});

function choose(...files: File[]) {
  render(<UploadDropzone />);
  fireEvent.change(screen.getByLabelText("Selecionar arquivos de áudio ou vídeo"), { target: { files } });
}

it("uploads with progress and starts a transcription with the saved defaults and vocabulary", async () => {
  vi.spyOn(api, "uploadMedia").mockImplementation(async (_file, onProgress) => {
    onProgress?.(40);
    return media;
  });
  const create = vi.spyOn(api, "createJob").mockResolvedValue({ id: "j9" } as never);
  choose(file("reuniao.wav"));
  expect(await screen.findByText("duplicado")).toBeInTheDocument();
  expect(screen.getByText(/1m05s · áudio/)).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Idioma" })).toHaveValue("pt");
  fireEvent.click(screen.getByRole("button", { name: "Transcrever" }));
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/jobs/j9"));
  expect(create).toHaveBeenCalledWith("m1", expect.objectContaining({
    model_name: "medium", language: "pt", device: "cpu", compute_type: "int8", beam_size: 4, initial_prompt: "Opikode",
  }));
});

it("rejects unsupported formats before uploading and lets them be removed", async () => {
  const upload = vi.spyOn(api, "uploadMedia");
  choose(file("planilha.xlsx"));
  expect(await screen.findByText("Formato não suportado (.xlsx)")).toBeInTheDocument();
  expect(upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remover" }));
  await waitFor(() => expect(screen.queryByText("planilha.xlsx")).not.toBeInTheDocument());
});

it("shows server and start errors next to the file", async () => {
  vi.spyOn(api, "uploadMedia")
    .mockRejectedValueOnce(new ApiError(415, { error: { code: "UNSUPPORTED_FORMAT", message: "O conteúdo do arquivo não corresponde a um formato de áudio", details: {}, request_id: null } }))
    .mockResolvedValueOnce({ ...media, is_duplicate: false });
  vi.spyOn(api, "createJob").mockRejectedValue(new ApiError(503, { error: { code: "QUEUE_UNAVAILABLE", message: "A fila de processamento está indisponível.", details: {}, request_id: null } }));
  choose(file("falso.mp3"), file("bom.wav"));
  expect(await screen.findByText("O conteúdo do arquivo não corresponde a um formato de áudio")).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Transcrever" }));
  expect(await screen.findByText("A fila de processamento está indisponível.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Transcrever" })).toBeEnabled();
});

it("cancels an upload in progress without leaving an error behind", async () => {
  vi.spyOn(api, "uploadMedia").mockImplementation((_file, _progress, signal) => new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("Upload cancelado", "AbortError")));
  }));
  choose(file("longo.wav"));
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(screen.queryByText("longo.wav")).not.toBeInTheDocument());
});

it("accepts dropped files", async () => {
  vi.spyOn(api, "uploadMedia").mockResolvedValue(media);
  render(<UploadDropzone />);
  const zone = screen.getByRole("button", { name: /Área de upload/ });
  fireEvent.dragOver(zone);
  fireEvent.drop(zone, { dataTransfer: { files: [file("arrastado.wav")] } });
  expect(await screen.findByText("arrastado.wav")).toBeInTheDocument();
});

it("follows the saved defaults even when the file arrives before the settings", async () => {
  settingsState.current = null;
  vi.spyOn(api, "uploadMedia").mockResolvedValue({ ...media, is_duplicate: false });
  const create = vi.spyOn(api, "createJob").mockResolvedValue({ id: "j1" } as never);
  const view = render(<UploadDropzone />);
  fireEvent.change(screen.getByLabelText("Selecionar arquivos de áudio ou vídeo"), { target: { files: [file("cedo.wav")] } });
  await screen.findByRole("button", { name: "Transcrever" });
  expect(screen.getByRole("combobox", { name: "Modelo" })).toHaveValue("turbo");
  settingsState.current = saved;
  view.rerender(<UploadDropzone />);
  expect(screen.getByRole("combobox", { name: "Modelo" })).toHaveValue("medium");
  expect(screen.getByRole("combobox", { name: "Idioma" })).toHaveValue("pt");
  fireEvent.change(screen.getByRole("combobox", { name: "Idioma" }), { target: { value: "en" } });
  fireEvent.click(screen.getByRole("button", { name: "Transcrever" }));
  await waitFor(() => expect(create).toHaveBeenCalledWith("m1", expect.objectContaining({ model_name: "medium", language: "en" })));
});
