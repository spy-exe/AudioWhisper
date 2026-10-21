import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { MediaFile, TranscriptionJob } from "@/lib/types";
import { ProcessingView } from "@/components/jobs/ProcessingView";

afterEach(() => vi.restoreAllMocks());

it("keeps cancellation acknowledged while the current model operation finishes", async () => {
  const job = { id: "job-1", media_file_id: "media-1", status: "loading_model", device: "cpu", progress: 0.05 } as TranscriptionJob;
  vi.spyOn(api, "getMedia").mockResolvedValue({ original_name: "meeting.wav" } as MediaFile);
  const cancel = vi.spyOn(api, "cancelJob").mockResolvedValue({ ...job, cancel_requested: true });
  render(<ProcessingView job={job} newSegments={[]} connectionError={null} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Aguardando cancelamento…" })).toBeDisabled());
  expect(screen.getByText(/Cancelamento solicitado/)).toBeVisible();
  expect(cancel).toHaveBeenCalledTimes(1);
});
