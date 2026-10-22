import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, describeError, isAbort, NETWORK_ERROR_MESSAGE } from "@/lib/api";
import { formatCompactNumber, formatEta, formatLongDuration, formatPercent } from "@/lib/format";
import { notifyJobFinished, progressTitle, requestNotificationPermission } from "@/lib/notifications";
import { transcriptionSettingsFrom } from "@/lib/transcription-settings";
import type { AppSettings } from "@/lib/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("api errors", () => {
  it("turns network failures into a readable ApiError but keeps aborts recognizable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.health()).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0, message: NETWORK_ERROR_MESSAGE });
    const abort = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(api.health()).rejects.toBe(abort);
    expect(isAbort(abort)).toBe(true);
    expect(isAbort(new Error("x"))).toBe(false);
  });

  it("describes field validation errors and falls back for unknown failures", () => {
    const validation = new ApiError(422, { error: { code: "VALIDATION_ERROR", message: "Revise os valores.", details: { fields: { default_beam_size: "Use um número inteiro entre 1 e 10" } }, request_id: null } });
    expect(describeError(validation, "x")).toBe("Revise os valores. Use um número inteiro entre 1 e 10");
    expect(describeError(new ApiError(500, { error: { code: "X", message: "", details: {}, request_id: null } }), "padrão")).toBe("padrão");
    expect(describeError(new Error("interno"), "padrão")).toBe("padrão");
  });

  it("sends the new endpoints with the right methods and payloads", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await api.splitSegment("j1", "s1", 7);
    await api.mergeSegments("j1", ["a", "b"]);
    await api.assignSpeakers("j1", ["a"], null);
    await api.removeSpeaker("j1", "SPEAKER 00");
    await api.stats("j1", 0.7);
    await api.cleanup("tmp");
    await api.bulk({ action: "delete", job_ids: ["j1"] });
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? "GET", init?.body ?? null]);
    expect(calls).toEqual([
      ["/api/jobs/j1/segments/s1/split", "POST", JSON.stringify({ offset: 7 })],
      ["/api/jobs/j1/segments/merge", "POST", JSON.stringify({ segment_ids: ["a", "b"] })],
      ["/api/jobs/j1/segments/speaker", "PUT", JSON.stringify({ segment_ids: ["a"], speaker_id: null })],
      ["/api/jobs/j1/speakers/SPEAKER%2000", "DELETE", null],
      ["/api/jobs/j1/stats?threshold=0.7", "GET", null],
      ["/api/system/cleanup", "POST", JSON.stringify({ target: "tmp" })],
      ["/api/library/bulk", "POST", JSON.stringify({ action: "delete", job_ids: ["j1"] })],
    ]);
    expect(api.exportBundleUrl("j1")).toBe("/api/jobs/j1/exports/bundle?include_timestamps=true&include_speakers=true");
  });
});

describe("formatting", () => {
  it.each([[null, null], [-1, null], [Number.NaN, null], [20, "menos de 1 min restante"], [60, "≈ 1 min restante"],
    [600, "≈ 10 min restantes"], [3600, "≈ 1 h restantes"], [5400, "≈ 1 h 30 min restantes"]])("eta %s", (value, expected) => {
    expect(formatEta(value as number | null)).toBe(expected);
  });

  it("formats long durations, compact numbers and percentages", () => {
    expect([formatLongDuration(0), formatLongDuration(42), formatLongDuration(600), formatLongDuration(7500)]).toEqual(["0 s", "42 s", "10 min", "2 h 05 min"]);
    expect(formatCompactNumber(1840)).toBe("1.840");
    expect(formatCompactNumber(48_200)).toMatch(/48,2\s?mil/);
    expect([formatPercent(0.6667), formatPercent(0.055)]).toEqual(["67%", "5,5%"]);
  });
});

describe("transcription settings", () => {
  it("builds every field from saved defaults, vocabulary included", () => {
    const settings = { default_model: "large-v3", default_language: "pt", transcription_device: "cpu", transcription_compute_type: "int8",
      default_beam_size: 3, default_vad_enabled: false, default_word_timestamps: true, default_translate_to_english: false,
      visual_effects_enabled: true, vocabulary: "  Opikode, Trofi ", hotwords: "" } as AppSettings;
    expect(transcriptionSettingsFrom(settings, { model_name: "small" })).toEqual({
      model_name: "small", language: "pt", device: "cpu", compute_type: "int8", beam_size: 3, vad_enabled: false,
      word_timestamps: true, translate_to_english: false, temperature: 0, initial_prompt: "Opikode, Trofi", hotwords: null,
    });
    expect(transcriptionSettingsFrom(null)).toMatchObject({ model_name: "turbo", language: null, device: "cuda", initial_prompt: null });
  });
});

describe("notifications", () => {
  it("shows progress in the tab title", () => {
    expect(progressTitle("Reunião", 0.456)).toBe("(46%) Reunião");
    expect(progressTitle("Reunião", 2)).toBe("(100%) Reunião");
    expect(progressTitle("Reunião", null)).toBe("Reunião");
  });

  it("notifies only with permission and only when the tab is hidden", async () => {
    const created: { title: string; options: NotificationOptions }[] = [];
    class FakeNotification {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn().mockResolvedValue("granted");
      onclick: (() => void) | null = null;
      close = vi.fn();
      constructor(title: string, options: NotificationOptions) {
        created.push({ title, options });
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    vi.spyOn(window, "focus").mockImplementation(() => undefined);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    expect(notifyJobFinished("Reunião", "completed")).toBeNull();
    visibility.mockReturnValue("hidden");
    expect(notifyJobFinished("Reunião", "transcribing")).toBeNull();
    const onOpen = vi.fn();
    const notification = notifyJobFinished("Reunião", "completed", onOpen) as unknown as FakeNotification;
    expect(created[0]).toMatchObject({ title: "Reunião", options: { body: "Transcrição concluída. Pronta para revisão." } });
    notification.onclick?.();
    expect(onOpen).toHaveBeenCalled();
    expect(notification.close).toHaveBeenCalled();
    FakeNotification.permission = "denied";
    expect(notifyJobFinished("Reunião", "failed")).toBeNull();
    expect(await requestNotificationPermission()).toBe("denied");
    FakeNotification.permission = "default";
    expect(await requestNotificationPermission()).toBe("granted");
  });

  it("reports unsupported browsers", async () => {
    expect("Notification" in window).toBe(false); // jsdom has no Notification API
    expect(await requestNotificationPermission()).toBe("unsupported");
    expect(notifyJobFinished("x", "completed")).toBeNull();
  });
});
