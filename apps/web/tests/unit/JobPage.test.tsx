import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { JobPageClient } from "@/app/jobs/[id]/JobPageClient";
import { api } from "@/lib/api";
import type { TranscriptionJob } from "@/lib/types";

const progress = vi.hoisted(() => ({ calls: [] as [string | null, number][], job: null as TranscriptionJob | null }));
vi.mock("@/hooks/useJobProgress", async (original) => ({
  ...(await original<typeof import("@/hooks/useJobProgress")>()),
  useJobProgress: (jobId: string | null, attempt: number) => {
    progress.calls.push([jobId, attempt]);
    return { job: progress.job, newSegments: [], provisionalSegments: [], connectionError: null, eta: 125 };
  },
}));
vi.mock("@/contexts/SettingsContext", () => ({ useSettings: () => ({ settings: { notifications_enabled: false } }) }));
vi.mock("@/components/editor/TranscriptEditor", () => ({ TranscriptEditor: ({ modelName }: { modelName: string }) => <p>editor {modelName}</p> }));

const base = { id: "j1", media_file_id: "m1", progress: 0.4, model_name: "turbo", device: "cpu", cancel_requested: false, current_stage: "Transcrevendo" } as TranscriptionJob;

beforeEach(() => {
  vi.restoreAllMocks();
  progress.calls = [];
  progress.job = null;
  vi.spyOn(api, "getMedia").mockResolvedValue({ id: "m1", original_name: "reuniao.wav", metadata: {} } as never);
});

it("retries a failed job in place and resubscribes to its progress", async () => {
  vi.spyOn(api, "getJob").mockResolvedValue({ ...base, status: "failed", error_message: "ffmpeg falhou" });
  vi.spyOn(api, "retryJob").mockResolvedValue({ ...base, status: "queued" });
  render(<JobPageClient jobId="j1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Tentar novamente" }));
  expect(await screen.findByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  expect(progress.calls.at(-1)).toEqual(["j1", 1]);
  expect(screen.getByText("≈ 2 min restantes")).toBeInTheDocument();
});

it("shows the editor for a completed job and progress in the tab title while processing", async () => {
  progress.job = { ...base, status: "transcribing" };
  vi.spyOn(api, "getJob").mockResolvedValue(progress.job);
  const view = render(<JobPageClient jobId="j1" />);
  await waitFor(() => expect(document.title).toBe("(40%) reuniao.wav — AudioWhisper"));
  progress.job = { ...base, status: "completed", progress: 1 };
  view.rerender(<JobPageClient jobId="j1" />);
  expect(await screen.findByText("editor turbo")).toBeInTheDocument();
  expect(document.title).toBe("reuniao.wav — AudioWhisper");
  view.unmount();
  expect(document.title).toBe("AudioWhisper 2.0 — Studio");
});

it("reports a missing job", async () => {
  vi.spyOn(api, "getJob").mockRejectedValue(new Error("404"));
  render(<JobPageClient jobId="nada" />);
  expect(await screen.findByText("Trabalho não encontrado.")).toBeInTheDocument();
});
