import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LibraryStatsStrip } from "@/components/home/LibraryStatsStrip";
import { QueueIndicator } from "@/components/jobs/QueueIndicator";
import { StoragePanel } from "@/components/settings/StoragePanel";
import { useKeyboardShortcuts, type ShortcutHandlers } from "@/hooks/useKeyboardShortcuts";
import { api, ApiError } from "@/lib/api";
import type { QueueStatus, StorageInfo } from "@/lib/types";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const queue = (extra: Partial<QueueStatus> = {}): QueueStatus => ({
  queued: 1, worker_online: true, pending_documents: 0, active_count: 2, error: null,
  active_jobs: [{ id: "j1", status: "transcribing", progress: 0.4, current_stage: "Transcrevendo", title: "Comitê" }], ...extra,
});

it("shows what the engine is processing and refreshes on an interval", async () => {
  vi.useFakeTimers();
  const load = vi.spyOn(api, "queue").mockResolvedValueOnce(queue()).mockResolvedValue(queue({ active_count: 0, active_jobs: [] }));
  render(<QueueIndicator />);
  await act(async () => {});
  const link = screen.getByRole("link", { name: "2 em processamento. Ver na biblioteca" });
  expect(link).toHaveAttribute("href", "/library?status=active");
  expect(link).toHaveAttribute("title", "Agora: Comitê");
  await act(async () => { vi.advanceTimersByTime(8000); });
  expect(load).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("warns about a stalled engine and an unavailable queue", async () => {
  vi.spyOn(api, "queue").mockResolvedValueOnce(queue({ worker_online: false, pending_documents: 1 }));
  const { unmount } = render(<QueueIndicator />);
  expect(await screen.findByRole("link", { name: /3 aguardando · motor parado/ })).toBeVisible();
  unmount();
  vi.spyOn(api, "queue").mockResolvedValueOnce(queue({ error: "Redis indisponível" }));
  render(<QueueIndicator />);
  expect(await screen.findByRole("status")).toHaveTextContent("Fila indisponível");
});

it("stays hidden when the queue cannot be read", async () => {
  vi.spyOn(api, "queue").mockRejectedValue(new Error("offline"));
  const { container } = render(<QueueIndicator />);
  await waitFor(() => expect(api.queue).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

const storage: StorageInfo = {
  directories: { uploads: { bytes: 5 * 1024 ** 3, files: 12 }, exports: { bytes: 2 * 1024 ** 2, files: 30 }, tmp: { bytes: 0, files: 0 },
    models: { bytes: 3 * 1024 ** 3, files: 9 }, database: { bytes: 4 * 1024 ** 2, files: 1 } },
  disk: { total_bytes: 100 * 1024 ** 3, free_bytes: 5 * 1024 ** 3, used_bytes: 95 * 1024 ** 3 },
  counts: { media: 12, jobs: 14, segments: 900, documents: 3, exports: 30 },
};

it("shows disk usage with a severity meter and cleans regenerable data after confirmation", async () => {
  const load = vi.spyOn(api, "storage").mockResolvedValue(storage);
  const cleanup = vi.spyOn(api, "cleanup").mockResolvedValue({ target: "exports", freed_bytes: 2 * 1024 ** 2, removed: 30 });
  render(<StoragePanel />);
  const meter = await screen.findByRole("meter", { name: "Uso do disco" });
  expect(meter).toHaveAttribute("aria-valuenow", "95");
  expect(meter).toHaveClass("is-critical");
  expect(screen.getByText(/Pouco espaço livre/)).toBeVisible();
  expect(screen.getByText("5.0 GB")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Remover exportações" }));
  const dialog = screen.getByRole("alertdialog", { name: "Remover exportações salvas?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Remover exportações" }));
  await waitFor(() => expect(cleanup).toHaveBeenCalledWith("exports"));
  expect(await screen.findByText("2.0 MB liberados (30 arquivos).")).toBeVisible();
  expect(load).toHaveBeenCalledTimes(2);
});

it("lets the storage read be retried", async () => {
  vi.spyOn(api, "storage").mockRejectedValueOnce(new ApiError(0, { error: { code: "NETWORK_ERROR", message: "Sem conexão com o AudioWhisper.", details: {}, request_id: null } }))
    .mockResolvedValue({ ...storage, disk: { ...storage.disk, used_bytes: 10 * 1024 ** 3 } });
  render(<StoragePanel />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão");
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  const meter = await screen.findByRole("meter");
  expect(meter).not.toHaveClass("is-critical");
});

it("summarizes the library only when there is something to show", async () => {
  vi.spyOn(api, "libraryStats").mockResolvedValueOnce({ recordings: 14, completed: 12, active: 1, transcribed_seconds: 19_920, words: 48_200, documents: 1, last_7_days: 3 });
  const { unmount } = render(<LibraryStatsStrip />);
  expect(await screen.findByText("gravações transcritas", { exact: false, selector: "dd" })).toBeVisible();
  expect(screen.getByText("5 h 32 min")).toBeVisible();
  expect(screen.getByText("48,2 mil", { exact: false })).toBeVisible();
  expect(screen.getByText("documento", { exact: false, selector: "dd" })).toBeVisible();
  unmount();
  vi.spyOn(api, "libraryStats").mockResolvedValueOnce({ recordings: 1, completed: 0, active: 1, transcribed_seconds: 0, words: 0, documents: 0, last_7_days: 1 });
  const { container } = render(<LibraryStatsStrip />);
  await waitFor(() => expect(api.libraryStats).toHaveBeenCalledTimes(2));
  expect(container).toBeEmptyDOMElement();
});

function Shortcuts(props: ShortcutHandlers) {
  useKeyboardShortcuts(props);
  return (
    <>
      <textarea aria-label="campo" />
      <div aria-modal="true"><button>dentro do diálogo</button></div>
    </>
  );
}

it("routes editor shortcuts and respects fields and dialogs", () => {
  const handlers = { togglePlay: vi.fn(), bookmark: vi.fn(), nextUncertain: vi.fn(), previousUncertain: vi.fn(), help: vi.fn(),
    undo: vi.fn(), save: vi.fn(), search: vi.fn(), seekBackBig: vi.fn(), seekForward: vi.fn() };
  render(<Shortcuts {...handlers} />);
  fireEvent.keyDown(window, { key: "m" });
  fireEvent.keyDown(window, { key: "n" });
  fireEvent.keyDown(window, { key: "N", shiftKey: true });
  fireEvent.keyDown(window, { key: "?" });
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  fireEvent.keyDown(window, { key: "J", shiftKey: true });
  fireEvent.keyDown(window, { key: "l" });
  fireEvent.keyDown(window, { key: "m", altKey: true });
  expect(handlers.bookmark).toHaveBeenCalledTimes(1);
  expect(handlers.nextUncertain).toHaveBeenCalledTimes(1);
  expect(handlers.previousUncertain).toHaveBeenCalledTimes(1);
  expect(handlers.help).toHaveBeenCalledTimes(1);
  expect(handlers.undo).toHaveBeenCalledTimes(1);
  expect(handlers.seekBackBig).toHaveBeenCalledTimes(1);
  expect(handlers.seekForward).toHaveBeenCalledTimes(1);

  const field = screen.getByRole("textbox", { name: "campo" });
  fireEvent.keyDown(field, { key: "m" });
  fireEvent.keyDown(field, { key: "z", ctrlKey: true });
  fireEvent.keyDown(field, { key: "s", ctrlKey: true });
  expect(handlers.bookmark).toHaveBeenCalledTimes(1);
  expect(handlers.undo).toHaveBeenCalledTimes(1);
  expect(handlers.save).toHaveBeenCalledTimes(1);

  fireEvent.keyDown(screen.getByRole("button", { name: "dentro do diálogo" }), { key: "f", ctrlKey: true });
  expect(handlers.search).not.toHaveBeenCalled();
});
