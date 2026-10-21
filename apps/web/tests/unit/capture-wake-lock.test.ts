import { afterEach, expect, it, vi } from "vitest";
import { CaptureWakeLock } from "@/lib/capture-wake-lock";

afterEach(() => { vi.restoreAllMocks(); });

function setup() {
  const sentinel = new EventTarget() as WakeLockSentinel;
  Object.defineProperty(sentinel, "release", { value: vi.fn().mockResolvedValue(undefined) });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  const request = vi.fn().mockResolvedValue(sentinel);
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
  return { sentinel, request };
}

it("holds the screen awake only for an active capture", async () => {
  const { sentinel, request } = setup();
  const state = vi.fn();
  const guard = new CaptureWakeLock(state);
  await guard.start();
  expect(request).toHaveBeenCalledWith("screen");
  expect(state).toHaveBeenLastCalledWith("active");
  guard.stop();
  expect(sentinel.release).toHaveBeenCalledOnce();
});

it("reacquires after returning from a hidden tab without duplicating active locks", async () => {
  const { sentinel, request } = setup();
  const guard = new CaptureWakeLock(vi.fn());
  await guard.start();
  document.dispatchEvent(new Event("visibilitychange"));
  expect(request).toHaveBeenCalledOnce();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  sentinel.dispatchEvent(new Event("release"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(request).toHaveBeenCalledOnce();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  guard.stop();
});

it("does not block recording when the system denies a screen lock", async () => {
  const { request } = setup();
  request.mockRejectedValue(new DOMException("Battery saver", "NotAllowedError"));
  const state = vi.fn();
  const guard = new CaptureWakeLock(state);
  await expect(guard.start()).resolves.toBeUndefined();
  expect(state).toHaveBeenLastCalledWith("unavailable");
  guard.stop();
});

it("releases a lock granted after the capture has already stopped", async () => {
  const { request, sentinel } = setup();
  let grant!: (value: WakeLockSentinel) => void;
  request.mockReturnValue(new Promise((resolve) => { grant = resolve; }));
  const guard = new CaptureWakeLock(vi.fn());
  const starting = guard.start();
  guard.stop();
  grant(sentinel);
  await starting;
  expect(sentinel.release).toHaveBeenCalledOnce();
});

it("reports when wake lock is unavailable in the browser", async () => {
  Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
  const state = vi.fn();
  const guard = new CaptureWakeLock(state);
  await guard.start();
  expect(state).toHaveBeenLastCalledWith("unavailable");
  guard.stop();
});
