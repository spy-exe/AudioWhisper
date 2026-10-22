import { afterEach, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import type { TranscriptSegment } from "@/lib/types";

afterEach(() => vi.unstubAllGlobals());

const segment = { id: "s1", text: "Olá" } as TranscriptSegment;

/** Every client method against the backend routes it targets: a renamed route fails here. */
const CONTRACT: [string, () => Promise<unknown>, string, string, unknown?][] = [
  ["intelligence", () => api.intelligence(), "GET", "/api/intelligence"],
  ["integrations", () => api.integrations(), "GET", "/api/integrations"],
  ["documents", () => api.documents("j"), "GET", "/api/jobs/j/documents"],
  ["generateDocument", () => api.generateDocument("j", "minutes", "m", "i"), "POST", "/api/jobs/j/documents", { kind: "minutes", model: "m", instruction: "i" }],
  ["reviewDocument", () => api.reviewDocument("d", "# A", true), "PUT", "/api/documents/d", { markdown: "# A", reviewed: true }],
  ["deleteDocument", () => api.deleteDocument("d"), "DELETE", "/api/documents/d"],
  ["shares", () => api.shares("d"), "GET", "/api/documents/d/shares"],
  ["createShare", () => api.createShare("d", 24), "POST", "/api/documents/d/shares", { expires_hours: 24 }],
  ["revokeShare", () => api.revokeShare("s"), "DELETE", "/api/shares/s"],
  ["emailDocument", () => api.emailDocument("d", "a@b.c", "Assunto", "r"), "POST", "/api/documents/d/email", { recipient: "a@b.c", subject: "Assunto", request_id: "r" }],
  ["diarize", () => api.diarize("j"), "POST", "/api/jobs/j/diarize"],
  ["assignSpeaker", () => api.assignSpeaker("j", segment, "S1"), "PATCH", "/api/jobs/j/segments/s1", { text: "Olá", speaker_id: "S1" }],
  ["organization", () => api.organization("j"), "GET", "/api/library/j"],
  ["organize", () => api.organize("j", { title: "t" } as never), "PUT", "/api/library/j", { title: "t" }],
  ["library", () => api.library(new URLSearchParams("q=a")), "GET", "/api/library?q=a"],
  ["libraryFacets", () => api.libraryFacets(), "GET", "/api/library/facets"],
  ["libraryStats", () => api.libraryStats(), "GET", "/api/library/stats"],
  ["search", () => api.search(new URLSearchParams("q=ab")), "GET", "/api/search?q=ab"],
  ["health", () => api.health(), "GET", "/api/health"],
  ["healthGpu", () => api.healthGpu(), "GET", "/api/health/gpu"],
  ["getSettings", () => api.getSettings(), "GET", "/api/settings"],
  ["updateSettings", () => api.updateSettings({ default_beam_size: 3 }), "PUT", "/api/settings", { values: { default_beam_size: 3 } }],
  ["listMedia", () => api.listMedia(), "GET", "/api/media"],
  ["getMedia", () => api.getMedia("m"), "GET", "/api/media/m"],
  ["deleteMedia", () => api.deleteMedia("m"), "DELETE", "/api/media/m"],
  ["createJob", () => api.createJob("m", { model_name: "turbo" } as never), "POST", "/api/jobs", { media_file_id: "m", settings: { model_name: "turbo" } }],
  ["listJobs", () => api.listJobs(), "GET", "/api/jobs"],
  ["getJob", () => api.getJob("j"), "GET", "/api/jobs/j"],
  ["cancelJob", () => api.cancelJob("j"), "POST", "/api/jobs/j/cancel"],
  ["retryJob", () => api.retryJob("j"), "POST", "/api/jobs/j/retry"],
  ["deleteJob", () => api.deleteJob("j"), "DELETE", "/api/jobs/j"],
  ["retranscribe", () => api.retranscribe("j", { model_name: "small" } as never), "POST", "/api/jobs/j/retranscribe", { model_name: "small" }],
  ["stats", () => api.stats("j"), "GET", "/api/jobs/j/stats"],
  ["getSegments", () => api.getSegments("j"), "GET", "/api/jobs/j/segments"],
  ["updateSegment", () => api.updateSegment("j", "s", "t", 1, 2), "PATCH", "/api/jobs/j/segments/s", { text: "t", start: 1, end: 2 }],
  ["replaceTranscript", () => api.replaceTranscript("j", [{ text: "t" }]), "PUT", "/api/jobs/j/transcript", { segments: [{ text: "t" }] }],
  ["createExports", () => api.createExports("j", ["srt"]), "POST", "/api/jobs/j/exports", { formats: ["srt"], include_timestamps: true, include_speakers: true }],
  ["listExports", () => api.listExports("j"), "GET", "/api/jobs/j/exports"],
  ["bookmarks", () => api.bookmarks("j"), "GET", "/api/jobs/j/bookmarks"],
  ["createBookmark", () => api.createBookmark("j", { start: 1, label: "x" }), "POST", "/api/jobs/j/bookmarks", { start: 1, label: "x" }],
  ["updateBookmark", () => api.updateBookmark("b", { note: "n" }), "PATCH", "/api/bookmarks/b", { note: "n" }],
  ["deleteBookmark", () => api.deleteBookmark("b"), "DELETE", "/api/bookmarks/b"],
  ["addSpeaker", () => api.addSpeaker("j", "Ana"), "POST", "/api/jobs/j/speakers", { name: "Ana" }],
  ["mergeSpeakers", () => api.mergeSpeakers("j", "a", "b"), "POST", "/api/jobs/j/speakers/merge", { source: "a", target: "b" }],
  ["storage", () => api.storage(), "GET", "/api/system/storage"],
  ["queue", () => api.queue(), "GET", "/api/system/queue"],
];

it.each(CONTRACT)("%s", async (_name, call, method, url, body) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  await call();
  const [calledUrl, init] = fetchMock.mock.calls[0]!;
  expect(calledUrl).toBe(url);
  expect(init?.method ?? "GET").toBe(method);
  if (body !== undefined) {
    expect(JSON.parse(init.body)).toEqual(body);
    expect(init.headers["Content-Type"]).toBe("application/json");
  }
});

it("builds download URLs", () => {
  expect(api.documentDownloadUrl("d", "pdf")).toBe("/api/documents/d/download?format=pdf");
  expect(api.downloadExportUrl("e")).toBe("/api/exports/e/download");
  expect(api.mediaFileUrl("m")).toBe("/api/media/m/stream");
  expect(api.exportBundleUrl("j", { includeTimestamps: false })).toBe("/api/jobs/j/exports/bundle?include_timestamps=false&include_speakers=true");
});

it("treats 204 as an empty success and non-JSON errors as readable ApiErrors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502, statusText: "Bad Gateway" })));
  await expect(api.deleteJob("j")).resolves.toBeUndefined();
  await expect(api.getJob("j")).rejects.toMatchObject({ status: 502, code: "UNKNOWN", message: "Bad Gateway" });
});

it("signals an expired session to the auth gate", async () => {
  const listener = vi.fn();
  window.addEventListener("audiowhisper:unauthorized", listener);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "HTTP_401", message: "Token", details: {}, request_id: null } }), { status: 401 })));
  await expect(api.getJob("j")).rejects.toMatchObject({ status: 401 });
  expect(listener).toHaveBeenCalledOnce();
  window.removeEventListener("audiowhisper:unauthorized", listener);
});

class FakeXhr {
  static last: FakeXhr;
  status = 0;
  responseText = "";
  listeners: Record<string, () => void> = {};
  upload = { addEventListener: (_: string, fn: (e: { lengthComputable: boolean; loaded: number; total: number }) => void) => { this.progress = fn; } };
  progress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void;
  open = vi.fn();
  abort = vi.fn(() => this.listeners.abort?.());
  send = vi.fn();
  constructor() { FakeXhr.last = this; }
  addEventListener(event: string, fn: () => void) { this.listeners[event] = fn; }
}

it("uploads with progress and maps every failure to a readable error", async () => {
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  const file = new File(["x"], "a.wav");
  const onProgress = vi.fn();
  const ok = api.uploadMedia(file, onProgress);
  FakeXhr.last.progress?.({ lengthComputable: true, loaded: 1, total: 4 });
  Object.assign(FakeXhr.last, { status: 200, responseText: JSON.stringify({ id: "m1" }) });
  FakeXhr.last.listeners.load!();
  await expect(ok).resolves.toEqual({ id: "m1" });
  expect(onProgress).toHaveBeenCalledWith(25);

  const tooLarge = api.uploadMedia(file);
  Object.assign(FakeXhr.last, { status: 413, responseText: "<html>Request Entity Too Large</html>" });
  FakeXhr.last.listeners.load!();
  await expect(tooLarge).rejects.toMatchObject({ status: 413, message: expect.stringContaining("limite de envio") });

  const gateway = api.uploadMedia(file);
  Object.assign(FakeXhr.last, { status: 502, responseText: "" });
  FakeXhr.last.listeners.load!();
  await expect(gateway).rejects.toMatchObject({ message: expect.stringContaining("(502)") });

  const structured = api.uploadMedia(file);
  Object.assign(FakeXhr.last, { status: 415, responseText: JSON.stringify({ error: { code: "UNSUPPORTED_FORMAT", message: "Formato", details: {}, request_id: null } }) });
  FakeXhr.last.listeners.load!();
  await expect(structured).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });

  const offline = api.uploadMedia(file);
  FakeXhr.last.listeners.error!();
  await expect(offline).rejects.toMatchObject({ code: "NETWORK_ERROR" });

  const controller = new AbortController();
  const cancelled = api.uploadMedia(file, undefined, controller.signal);
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
});
