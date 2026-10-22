import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "@/lib/api";
import type { MediaFile, Organization, TranscriptSegment } from "@/lib/types";
import { TranscriptEditor } from "@/components/editor/TranscriptEditor";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, useSearchParams: () => nav.params, usePathname: () => "/jobs/j1" }));
vi.mock("@/contexts/SettingsContext", () => ({ useSettings: () => ({ settings: { low_confidence_threshold: 0.6 } }) }));
vi.mock("@/components/editor/Waveform", () => ({ Waveform: () => null }));
vi.mock("@/components/editor/MediaPlayer", () => ({
  MediaPlayer: ({ onElementReady }: { onElementReady: (el: HTMLMediaElement | null) => void }) => (
    <audio data-testid="player" ref={onElementReady} />
  ),
}));
vi.mock("@/components/workspace/AIWorkspace", () => ({ AIWorkspace: () => <p>assistente</p> }));
vi.mock("@/components/workspace/OrganizationPanel", () => ({ OrganizationPanel: () => null }));
vi.mock("@/components/editor/InsightsPanel", () => ({
  InsightsPanel: ({ onReviewUncertain }: { onReviewUncertain: (ids: string[]) => void }) => (
    <button onClick={() => onReviewUncertain(["s2"])}>revisar pelos insights</button>
  ),
}));

const media = { id: "m1", original_name: "reuniao.wav", media_type: "audio", duration_seconds: 9 } as MediaFile;
const organization: Organization = { title: "Comitê", folder: "", project: "", tags: [], speakers: { S1: "Ana" }, diarization_status: "idle", diarization_error: null };

function segment(id: string, index: number, text: string, extra: Partial<TranscriptSegment> = {}): TranscriptSegment {
  return { id, job_id: "j1", segment_index: index, start: index * 3, end: index * 3 + 3, text, confidence: 0.9, words: null, edited: false, speaker_id: null, updated_at: "2026-10-19T12:00:00Z", ...extra };
}
const segments = [segment("s1", 0, "Primeira frase longa"), segment("s2", 1, "Talvez incerto", { confidence: 0.3 }), segment("s3", 2, "Fim")];

beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.push.mockReset();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(api, "getSegments").mockResolvedValue(segments);
  vi.spyOn(api, "organization").mockResolvedValue(organization);
  vi.spyOn(api, "bookmarks").mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

async function open() {
  render(<TranscriptEditor jobId="j1" media={media} modelName="turbo" />);
  return screen.findByRole("textbox", { name: "Texto em 00:00" });
}

it("serializes autosaves so an older request cannot overwrite a newer edit", async () => {
  let resolveFirst!: (value: TranscriptSegment) => void;
  const first = new Promise<TranscriptSegment>((resolve) => { resolveFirst = resolve; });
  const update = vi.spyOn(api, "updateSegment").mockReturnValueOnce(first).mockResolvedValue(segments[0]!);
  const input = await open();
  fireEvent.change(input, { target: { value: "Primeira edição" } });
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: "Edição mais recente" } });
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  expect(update).toHaveBeenCalledTimes(1);
  await act(async () => resolveFirst(segments[0]!));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update.mock.calls[1]?.[2]).toBe("Edição mais recente");
});

it("saves pending edits before splitting at the cursor and replaces the segment list", async () => {
  const update = vi.spyOn(api, "updateSegment").mockResolvedValue(segments[0]!);
  const split = vi.spyOn(api, "splitSegment").mockResolvedValue([
    segment("s1", 0, "Primeira"), segment("new", 1, "frase longa editada"), segment("s2", 2, "Talvez incerto"), segment("s3", 3, "Fim"),
  ]);
  const input = (await open()) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "Primeira frase longa editada" } });
  input.setSelectionRange(9, 9);
  fireEvent.select(input);
  fireEvent.click(within(screen.getByRole("group", { name: "Ações do trecho em 00:00" })).getByRole("button", { name: "Dividir no cursor" }));
  await waitFor(() => expect(split).toHaveBeenCalledWith("j1", "s1", 9));
  expect(update).toHaveBeenCalledWith("j1", "s1", "Primeira frase longa editada", 0, 3);
  expect(update.mock.invocationCallOrder[0]).toBeLessThan(split.mock.invocationCallOrder[0]!);
  expect(await screen.findByText("Trecho dividido.")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Texto em 00:03" })).toHaveValue("frase longa editada");
  expect(screen.getByRole("button", { name: "Desfazer" })).toBeDisabled();
})

it("explains instead of calling the API when the cursor is at an edge", async () => {
  const split = vi.spyOn(api, "splitSegment");
  const input = (await open()) as HTMLTextAreaElement;
  input.setSelectionRange(0, 0);
  fireEvent.select(input);
  fireEvent.click(within(screen.getByRole("group", { name: "Ações do trecho em 00:00" })).getByRole("button", { name: "Dividir no cursor" }));
  expect(await screen.findByText(/Posicione o cursor/)).toBeInTheDocument();
  expect(split).not.toHaveBeenCalled();
});

it("merges a shift-selected range and assigns a speaker to the selection", async () => {
  const merge = vi.spyOn(api, "mergeSegments").mockResolvedValue([segment("s1", 0, "Primeira frase longa Talvez incerto"), segment("s3", 1, "Fim")]);
  const assign = vi.spyOn(api, "assignSpeakers").mockResolvedValue([segment("s3", 1, "Fim", { speaker_id: "S1" })]);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Ir para 00:03" }));
  fireEvent.click(screen.getByRole("button", { name: "Ir para 00:00" }), { shiftKey: true });
  expect(screen.getByText("2 trechos selecionados")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Juntar 2 trechos" }));
  await waitFor(() => expect(merge).toHaveBeenCalledWith("j1", ["s1", "s2"]));
  expect(await screen.findByText("2 trechos unidos.")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Ir para 00:03" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Atribuir falante à seleção" }), { target: { value: "S1" } });
  await waitFor(() => expect(assign).toHaveBeenCalledWith("j1", ["s3"], "S1"));
  expect(await screen.findByText("Falante atualizado em 1 trecho.")).toBeInTheDocument();
});

it("shows merge failures from the API without losing the transcript", async () => {
  vi.spyOn(api, "mergeSegments").mockRejectedValue(new ApiError(422, { error: { code: "VALIDATION_ERROR", message: "Selecione dois ou mais segmentos consecutivos para juntar.", details: {}, request_id: null } }));
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Ir para 00:00" }));
  fireEvent.click(screen.getByRole("button", { name: "Ir para 00:06" }), { shiftKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Juntar 3 trechos" }));
  expect(await screen.findByText(/consecutivos para juntar/)).toBeInTheDocument();
  expect(screen.getAllByRole("textbox", { name: /^Texto em/ })).toHaveLength(3);
});

it("flags uncertain segments and reviews only them, from the toolbar or the insights panel", async () => {
  await open();
  expect(screen.getByText(/incerto · 30/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Revisar incertos (1)" }));
  expect(screen.getAllByRole("textbox", { name: /^Texto em/ })).toHaveLength(1);
  expect(screen.getByText(/Revisando 1 trecho incerto/)).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "n" });
  expect(screen.getByRole("button", { name: "Ir para 00:03 (selecionado)" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sair da revisão" }));
  expect(screen.getAllByRole("textbox", { name: /^Texto em/ })).toHaveLength(3);

  fireEvent.click(screen.getByRole("tab", { name: "Insights" }));
  fireEvent.click(screen.getByRole("button", { name: "revisar pelos insights" }));
  expect(screen.getAllByRole("textbox", { name: /^Texto em/ })).toHaveLength(1);
});

it("opens a deep link at the requested moment", async () => {
  nav.params = new URLSearchParams("t=4");
  await open();
  await waitFor(() => expect(screen.getByRole("button", { name: "Ir para 00:03 (selecionado)" })).toBeInTheDocument());
  expect((screen.getByTestId("player") as HTMLMediaElement).currentTime).toBe(4);
});

it("creates bookmarks from the keyboard and from a segment", async () => {
  const create = vi.spyOn(api, "createBookmark").mockImplementation(async (_job, values) => ({
    id: `b-${values.start}`, job_id: "j1", segment_id: values.segment_id ?? null, start: values.start, label: values.label, note: "", color: "amber", created_at: "", updated_at: "",
  }));
  await open();
  fireEvent.keyDown(window, { key: "m" });
  await waitFor(() => expect(create).toHaveBeenCalledWith("j1", { start: 0, label: "Momento em 00:00", segment_id: "s1" }));
  fireEvent.click(screen.getByRole("button", { name: "Ir para 00:06" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Ações do trecho em 00:06" })).getByRole("button", { name: "Marcar" }));
  await waitFor(() => expect(create).toHaveBeenLastCalledWith("j1", { start: 6, label: "Fim", segment_id: "s3" }));
  expect(await screen.findByText("Marcador criado em 00:06.")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Marcadores 2" })).toBeInTheDocument();
});

it("copies a link to a moment", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Ir para 00:03" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Ações do trecho em 00:03" })).getByRole("button", { name: "Copiar link do momento" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/jobs/j1?t=3`));
  expect(await screen.findByText("Link para 00:03 copiado.")).toBeInTheDocument();
});

it("shows the shortcuts with ? and closes them with Escape", async () => {
  await open();
  fireEvent.keyDown(window, { key: "?" });
  const dialog = screen.getByRole("dialog", { name: "Atalhos do editor" });
  expect(within(dialog).getByText("Marcar o momento atual")).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("switches side panels with the arrow keys", async () => {
  await open();
  const assistant = screen.getByRole("tab", { name: "Assistente" });
  expect(assistant).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(assistant, { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "Insights" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "Insights" })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("tab", { name: "Insights" }), { key: "End" });
  expect(screen.getByRole("tab", { name: "Marcadores" })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByRole("tab", { name: "Marcadores" }));
  expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
});

it("deletes the recording only after confirmation and keeps errors inside the dialog", async () => {
  const remove = vi.spyOn(api, "deleteJob")
    .mockRejectedValueOnce(new ApiError(409, { error: { code: "CONFLICT", message: "Cancele o processamento antes de excluir esta gravação.", details: {}, request_id: null } }))
    .mockResolvedValue(undefined);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
  const dialog = screen.getByRole("alertdialog", { name: "Excluir esta gravação?" });
  expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus();
  fireEvent.click(within(dialog).getByRole("button", { name: "Excluir gravação" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Cancele o processamento");
  expect(nav.push).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Excluir gravação" }));
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/library"));
  expect(remove).toHaveBeenCalledTimes(2);
});

it("offers a new transcription with another model", async () => {
  const retranscribe = vi.spyOn(api, "retranscribe").mockResolvedValue({ id: "j2" } as never);
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Transcrever novamente" }));
  const dialog = screen.getByRole("dialog", { name: "Transcrever novamente" });
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Modelo" }), { target: { value: "large-v3" } });
  fireEvent.change(within(dialog).getByRole("textbox", { name: /Vocabulário/ }), { target: { value: "Opikode" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Transcrever novamente" }));
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/jobs/j2"));
  expect(retranscribe.mock.calls[0]?.[1]).toMatchObject({ model_name: "large-v3", initial_prompt: "Opikode", temperature: 0 });
});

it("keeps a load failure recoverable", async () => {
  vi.spyOn(api, "bookmarks").mockRejectedValue(new Error("offline"));
  render(<TranscriptEditor jobId="j1" media={media} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar a transcrição");
  expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
});
