import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodeWav, LiveAudio, type CapturedChunk } from "@/lib/live-audio";

const track = { stop: vi.fn(), addEventListener: vi.fn() };
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
let port: { onmessage: ((message: { data: Float32Array | { flushed: true } }) => void) | null; postMessage: (message: string) => void };
let close: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: vi.fn().mockResolvedValue(stream),
    getDisplayMedia: vi.fn().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [] }),
  } });
  close = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("AudioContext", class {
    sampleRate = 16000;
    destination = {};
    audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
    createMediaStreamSource() { return { connect: vi.fn() }; }
    createGain() { return { gain: { value: 1 }, connect: vi.fn() }; }
    resume = vi.fn().mockResolvedValue(undefined);
    close = close;
  });
  vi.stubGlobal("AudioWorkletNode", class {
    port = { onmessage: null as typeof port.onmessage, postMessage: () => this.port.onmessage?.({ data: { flushed: true } }) };
    constructor() { port = this.port; }
    connect(target: unknown) { return target; }
    disconnect = vi.fn();
  });
  vi.stubGlobal("MediaStream", class {});
});

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function readBlob(blob: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

it("encodes a mono 16 kHz WAV and clamps samples to signed PCM", async () => {
  const buffer = await readBlob(encodeWav(new Float32Array([-2, 0, 2])));
  const view = new DataView(buffer);
  expect(String.fromCharCode(...new Uint8Array(buffer, 0, 4))).toBe("RIFF");
  expect(view.getUint32(24, true)).toBe(16000);
  expect(view.getUint16(22, true)).toBe(1);
  expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([-32768, 0, 32767]);
});

it("revises speech provisionally, then confirms it while preserving the capture offset", async () => {
  const chunks: CapturedChunk[] = [];
  const level = vi.fn();
  const audio = new LiveAudio(chunk => chunks.push(chunk), level);
  await audio.start("microphone", "");
  for (let frame = 0; frame < 20; frame++) port.onmessage!({ data: new Float32Array(1600) });
  for (let frame = 0; frame < 40; frame++) port.onmessage!({ data: new Float32Array(1600).fill(0.1) });
  for (let frame = 0; frame < 10; frame++) port.onmessage!({ data: new Float32Array(1600) });
  const result = await audio.stop();
  expect(chunks.map(chunk => chunk.final)).toEqual([false, true]);
  expect(chunks.map(chunk => chunk.sequence)).toEqual([0, 0]);
  expect(chunks[1]!.revision).toBeGreaterThan(chunks[0]!.revision);
  expect(chunks[1]!.start).toBeCloseTo(1.8);
  expect(result).toEqual({ expected_chunks: 1, duration: 7 });
  expect(level).toHaveBeenCalledWith(1, expect.any(Number));
  expect(track.stop).toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
});

it("requires a secure context before asking for audio access", async () => {
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
  await expect(new LiveAudio(vi.fn(), vi.fn()).start("microphone", "")).rejects.toThrow(/HTTPS/);
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

it("releases a shared stream when screen sharing contains no audio", async () => {
  await expect(new LiveAudio(vi.fn(), vi.fn()).start("system", "")).rejects.toThrow(/Compartilhar áudio/);
  expect(track.stop).toHaveBeenCalledOnce();
});

it("uses the chosen OBS input without microphone speech filters", async () => {
  const audio = new LiveAudio(vi.fn(), vi.fn());
  await audio.start("obs", "virtual-cable");
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: {
    deviceId: { exact: "virtual-cable" }, echoCancellation: false, noiseSuppression: false, channelCount: 1,
  } });
  audio.release();
});
