import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LiveStudio } from "@/components/live/LiveStudio";
import { liveStore } from "@/lib/live-store";
import type { CapturedChunk } from "@/lib/live-audio";

const audio = vi.hoisted(() => ({
  onChunk: null as ((chunk: CapturedChunk) => void) | null,
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
    }
    async start() {}
    release() {}
  },
}));

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
