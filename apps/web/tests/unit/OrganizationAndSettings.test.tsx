import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import SettingsPage from "@/app/settings/page";
import { OrganizationPanel } from "@/components/workspace/OrganizationPanel";
import { api, ApiError } from "@/lib/api";
import type { AppSettings, Organization } from "@/lib/types";

const settingsState = vi.hoisted(() => ({ settings: null as AppSettings | null, update: vi.fn() }));
vi.mock("@/contexts/SettingsContext", () => ({ useSettings: () => ({ settings: settingsState.settings, loading: false, update: settingsState.update }) }));
vi.mock("@/components/workspace/IntelligenceSettings", () => ({ IntelligenceSettings: () => null }));
vi.mock("@/components/settings/StoragePanel", () => ({ StoragePanel: () => <p>armazenamento</p> }));

const organization: Organization = { title: "Comitê", folder: "", project: "", tags: [], speakers: { SPEAKER_00: "Ana", SPEAKER_01: "Ana (2)" }, diarization_status: "completed", diarization_error: null };

beforeEach(() => {
  vi.restoreAllMocks();
  settingsState.update.mockReset().mockResolvedValue(undefined);
  settingsState.settings = {
    default_model: "turbo", transcription_device: "cuda", transcription_compute_type: "float16", default_beam_size: 5,
    default_vad_enabled: true, default_word_timestamps: true, default_translate_to_english: false, visual_effects_enabled: true,
    default_language: "", vocabulary: "", hotwords: "", low_confidence_threshold: 0.6, notifications_enabled: false,
  };
});

function panel(onChange = vi.fn(), onSegmentsChanged = vi.fn()) {
  render(<OrganizationPanel jobId="j1" value={organization} onChange={onChange} onDiarized={vi.fn()} onSegmentsChanged={onSegmentsChanged} />);
  fireEvent.click(screen.getByText("Organizar conversa e participantes"));
  return { onChange, onSegmentsChanged };
}

it("adds a participant by hand", async () => {
  vi.spyOn(api, "addSpeaker").mockResolvedValue({ ...organization, speakers: { ...organization.speakers, "manual-1": "Bruno" }, speaker_id: "manual-1" });
  const { onChange } = panel();
  fireEvent.change(screen.getByRole("textbox", { name: "Adicionar participante manualmente" }), { target: { value: " Bruno " } });
  fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
  await waitFor(() => expect(api.addSpeaker).toHaveBeenCalledWith("j1", "Bruno"));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ speaker_id: "manual-1" }));
  expect(await screen.findByText(/Bruno adicionado/)).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Adicionar participante manualmente" })).toHaveValue("");
});

it("merges a duplicated speaker and refreshes the transcript", async () => {
  vi.spyOn(api, "mergeSpeakers").mockResolvedValue({ ...organization, speakers: { SPEAKER_00: "Ana" }, moved_segments: 4 });
  const { onSegmentsChanged } = panel();
  fireEvent.change(screen.getByRole("combobox", { name: "Mesclar Ana (2) em outro participante" }), { target: { value: "SPEAKER_00" } });
  await waitFor(() => expect(api.mergeSpeakers).toHaveBeenCalledWith("j1", "SPEAKER_01", "SPEAKER_00"));
  expect(onSegmentsChanged).toHaveBeenCalled();
  expect(await screen.findByText("Ana (2) foi mesclado em Ana.")).toBeVisible();
});

it("removes a participant only after confirmation", async () => {
  vi.spyOn(api, "removeSpeaker").mockResolvedValue({ ...organization, speakers: { SPEAKER_00: "Ana" }, cleared_segments: 2 });
  const { onSegmentsChanged } = panel();
  fireEvent.click(screen.getAllByRole("button", { name: "Remover" })[1]!);
  const dialog = screen.getByRole("alertdialog", { name: "Remover participante?" });
  expect(dialog).toHaveTextContent("Ana (2) voltam a ficar sem falante");
  fireEvent.click(within(dialog).getByRole("button", { name: "Remover participante" }));
  await waitFor(() => expect(api.removeSpeaker).toHaveBeenCalledWith("j1", "SPEAKER_01"));
  expect(onSegmentsChanged).toHaveBeenCalled();
});

it("explains a refused participant name", async () => {
  vi.spyOn(api, "addSpeaker").mockRejectedValue(new ApiError(422, { error: { code: "VALIDATION_ERROR", message: "Já existe um participante com esse nome.", details: {}, request_id: null } }));
  panel();
  fireEvent.change(screen.getByRole("textbox", { name: "Adicionar participante manualmente" }), { target: { value: "ana" } });
  fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Já existe um participante com esse nome.");
});

it("saves the vocabulary and shows validation errors from the server", async () => {
  settingsState.update
    .mockRejectedValueOnce(new ApiError(422, { error: { code: "VALIDATION_ERROR", message: "Revise os valores destacados nas configurações.", details: { fields: { default_beam_size: "Use um número inteiro entre 1 e 10" } }, request_id: null } }))
    .mockResolvedValue(undefined);
  render(<SettingsPage />);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Beam size" }), { target: { value: "0" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Use um número inteiro entre 1 e 10");

  const save = screen.getByRole("button", { name: "Salvar vocabulário" });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: /Contexto e grafias/ }), { target: { value: "Opikode e Trofi" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Palavras prioritárias" }), { target: { value: "Opikode" } });
  fireEvent.click(save);
  await waitFor(() => expect(settingsState.update).toHaveBeenLastCalledWith({ vocabulary: "Opikode e Trofi", hotwords: "Opikode" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Vocabulário salvo");
});

it("saves the language, confidence threshold and notification preference", async () => {
  class FakeNotification {
    static permission: NotificationPermission = "default";
    static requestPermission = vi.fn().mockResolvedValue("denied");
  }
  vi.stubGlobal("Notification", FakeNotification);
  render(<SettingsPage />);
  fireEvent.change(screen.getByRole("combobox", { name: "Idioma padrão" }), { target: { value: "pt" } });
  expect(settingsState.update).toHaveBeenCalledWith({ default_language: "pt" });
  fireEvent.change(screen.getByRole("slider"), { target: { value: "0.75" } });
  expect(settingsState.update).toHaveBeenCalledWith({ low_confidence_threshold: 0.75 });
  const notify = screen.getByRole("switch", { name: /Avisar quando uma transcrição terminar/ });
  fireEvent.click(notify);
  expect(await screen.findByRole("alert")).toHaveTextContent("O navegador bloqueou as notificações");
  FakeNotification.requestPermission.mockResolvedValue("granted");
  fireEvent.click(notify);
  await waitFor(() => expect(settingsState.update).toHaveBeenCalledWith({ notifications_enabled: true }));
  vi.unstubAllGlobals();
});
