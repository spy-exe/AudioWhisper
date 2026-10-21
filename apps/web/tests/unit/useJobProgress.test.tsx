import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { TranscriptSegment, TranscriptionJob } from "@/lib/types";
import { useJobProgress } from "@/hooks/useJobProgress";

const job = {
  id: "j1",
  status: "transcribing",
  started_at: "2026-10-19T12:00:00Z",
} as TranscriptionJob;
const segment = (id: string, index: number, text = id): TranscriptSegment => ({
  id,
  job_id: "j1",
  segment_index: index,
  text,
  start: index,
  end: index + 1,
  confidence: null,
  words: null,
  edited: false,
  updated_at: "2026-10-19T12:00:01Z",
});
class Socket {
  static all: Socket[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror = null;
  constructor() {
    Socket.all.push(this);
  }
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  close() {
    this.onclose?.();
  }
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Socket.all = [];
});

it("recovers snapshots, deduplicates confirmed segments and keeps provisional text separate", async () => {
  vi.stubGlobal("WebSocket", Socket);
  vi.spyOn(api, "getJob").mockResolvedValue(job);
  vi.spyOn(api, "getSegments").mockResolvedValue([segment("s1", 0)]);
  const { result, unmount } = renderHook(() => useJobProgress("j1"));
  await waitFor(() => expect(result.current.newSegments).toHaveLength(1));
  act(() =>
    Socket.all[0]!.emit({
      type: "snapshot",
      job,
      segments: [segment("s1", 0)],
      provisional_segments: [segment("draft", 2)],
    }),
  );
  act(() =>
    Socket.all[0]!.emit({
      type: "progress",
      job_id: "j1",
      new_segments: [segment("s1", 0), segment("s2", 1)],
    }),
  );
  expect(result.current.newSegments.map((s) => s.id)).toEqual(["s1", "s2"]);
  expect(result.current.provisionalSegments[0]?.id).toBe("draft");
  act(() => Socket.all[0]!.close());
  await waitFor(() => expect(Socket.all).toHaveLength(2), { timeout: 2000 });
  act(() =>
    Socket.all[1]!.emit({
      type: "snapshot",
      job,
      segments: [segment("s1", 0), segment("s2", 1), segment("s3", 2)],
      provisional_segments: [],
    }),
  );
  expect(result.current.newSegments).toHaveLength(3);
  expect(result.current.connectionError).toBeNull();
  expect(result.current.provisionalSegments).toHaveLength(0);
  unmount();
});
