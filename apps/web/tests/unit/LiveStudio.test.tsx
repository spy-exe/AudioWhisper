import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveStudio } from "@/components/live/LiveStudio";
import { liveStore } from "@/lib/live-store";
import type { CapturedChunk } from "@/lib/live-audio";

const audio = vi.hoisted(() => ({
  onChunk: null as ((chunk: CapturedChunk) => void) | null,
  instance: null as { onEnded?: () => void } | null,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: { default_model: "tiny" } }),
}));
vi.mock("@/hooks/useJobProgress", () => ({
  useJobProgress: () => ({ job: null, newSegments: [], provisionalSegments: [] }),
}));
vi.mock("@/lib/live-store", () => ({
  liveStore: {
    capture: vi.fn().mockResolvedValue(undefined),
    chunks: vi.fn().mockResolvedValue([]),
    putChunk: vi.fn().mockResolvedValue(undefined),
    putCapture: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/lib/live-audio", () => ({
  LiveAudio: class {
    constructor(onChunk: (chunk: CapturedChunk) => void) {
      audio.onChunk = onChunk;
      audio.instance = this;
    }
    onEnded?: () => void;
    async start() {}
    async prepare() {}
    async stop() { return { expected_chunks: 1, duration: 1 }; }
    release() {}
  },
}));

beforeEach(() => {
  vi.mocked(liveStore.chunks).mockResolvedValue([]);
  vi.mocked(liveStore.putChunk).mockResolvedValue("chunk");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.getElementById("live-capture-slot")?.remove();
});

it("makes desktop capture discoverable and explains the sharing permission", async () => {
  const slot = document.createElement("div");
  slot.id = "live-capture-slot";
  document.body.append(slot);
  const { unmount } = render(<LiveStudio />);
  const desktop = await screen.findByRole("radio", { name: /Desktop e microfone/ });
  fireEvent.click(desktop);
  expect(desktop).toBeChecked();
  expect(screen.getByText(/Compartilhar áudio/)).toBeVisible();
  expect(screen.getByText(/mantenha esta aba aberta/i)).toBeVisible();
  unmount();
});

it("preserves new audio locally while an earlier upload is still pending", async () => {
  const slot = document.createElement("div");
  slot.id = "live-capture-slot";
  document.body.append(slot);
  let finishUpload!: (response: Response) => void;
  const upload = new Promise<Response>((resolve) => { finishUpload = resolve; });
  const fetchMock = vi.fn().mockImplementation((url: string) =>
    url.includes("/chunks/")
      ? upload
      : Promise.resolve({ ok: true, json: async () => ({ id: "capture-1" }) }),
  );
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { enumerateDevices: async () => [] },
  });
  const { unmount } = render(<LiveStudio />);
  fireEvent.click(await screen.findByRole("button", { name: "Iniciar captura" }));
  await screen.findByRole("button", { name: "Encerrar captura" });
  const blob = new Blob([new Uint8Array(32044)], { type: "audio/wav" });
  act(() => audio.onChunk!({ sequence: 0, revision: 0, start: 0, final: false, blob }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  act(() => audio.onChunk!({ sequence: 0, revision: 1, start: 0, final: true, blob }));
  try {
    await waitFor(() => expect(liveStore.putChunk).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 1, final: true, uploaded: false }),
    ));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => { finishUpload({ ok: true } as Response); });
    unmount();
  }
});

it("automatically resends preserved audio when the connection returns", async () => {
  const slot = document.createElement("div");
  slot.id = "live-capture-slot";
  document.body.append(slot);
  const stored = new Map<string, import("@/lib/live-store").StoredChunk>();
  vi.mocked(liveStore.putChunk).mockImplementation(async (chunk) => { stored.set(chunk.id, chunk); return chunk.id; });
  vi.mocked(liveStore.chunks).mockImplementation(async () => [...stored.values()]);
  let chunkAttempts = 0;
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => {
    if (url.includes("/chunks/") && ++chunkAttempts === 1) throw new Error("offline");
    return { ok: true, json: async () => ({ id: "capture-retry" }) };
  }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { enumerateDevices: async () => [] } });
  const { unmount } = render(<LiveStudio />);
  fireEvent.click(await screen.findByRole("button", { name: "Iniciar captura" }));
  await screen.findByRole("button", { name: "Encerrar captura" });
  act(() => audio.onChunk!({ sequence: 0, revision: 0, start: 0, final: true, blob: new Blob([new Uint8Array(32044)]) }));
  await screen.findByText("offline");
  act(() => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect([...stored.values()][0]?.uploaded).toBe(true));
  expect(chunkAttempts).toBe(2);
  expect(screen.getByRole("button", { name: "Encerrar captura" })).toBeVisible();
  unmount();
});

it("finalizes saved audio when the selected source is disconnected", async () => {
  const slot = document.createElement("div");
  slot.id = "live-capture-slot";
  document.body.append(slot);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "capture-ended" }) });
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { enumerateDevices: async () => [] } });
  const { unmount } = render(<LiveStudio />);
  fireEvent.click(await screen.findByRole("button", { name: "Iniciar captura" }));
  await screen.findByRole("button", { name: "Encerrar captura" });
  act(() => audio.instance!.onEnded!());
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/live/capture-ended/stop", expect.objectContaining({ method: "POST" })));
  expect(screen.queryByRole("button", { name: "Encerrar captura" })).not.toBeInTheDocument();
  unmount();
});
