export interface CapturedChunk {
  sequence: number;
  revision: number;
  start: number;
  final: boolean;
  blob: Blob;
}

export function encodeWav(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(
      44 + i * 2,
      sample < 0 ? sample * 32768 : sample * 32767,
      true,
    );
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export class LiveAudio {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private streams: MediaStream[] = [];
  private frames: Float32Array[] = [];
  private preRoll: Float32Array[] = [];
  private size = 0;
  private total = 0;
  private utteranceStart = 0;
  private lastVoice = 0;
  private lastUpdate = 0;
  private sequence = 0;
  private revision = 0;
  private flushed: (() => void) | null = null;
  onEnded?: () => void;
  onInterrupted?: (interrupted: boolean) => void;
  constructor(
    private onChunk: (chunk: CapturedChunk) => void,
    private onLevel: (level: number, seconds: number) => void,
  ) {}
  // Ask from the click handler, before persistence/network awaits consume user activation.
  async prepare(source: string, deviceId: string) {
    if (this.streams.length) return;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices)
        throw new Error("A captura requer localhost ou uma conexão HTTPS.");
      if (source === "system" || source === "mixed") {
        if (!navigator.mediaDevices.getDisplayMedia)
          throw new Error("Áudio do desktop requer Chrome ou Edge no computador. Use OBS / entrada virtual como alternativa.");
        const displayOptions: DisplayMediaStreamOptions & { systemAudio: string; surfaceSwitching: string; selfBrowserSurface: string } = {
          video: { displaySurface: "monitor" },
          audio: true,
          systemAudio: "include",
          surfaceSwitching: "exclude",
          selfBrowserSurface: "exclude",
        };
        const screen = await navigator.mediaDevices.getDisplayMedia(displayOptions);
        this.streams.push(screen);
        if (!screen.getAudioTracks().length)
          throw new Error(
            "Selecione uma tela/aba com áudio e habilite Compartilhar áudio.",
          );
        if (source === "mixed")
          this.streams.push(
            await navigator.mediaDevices.getUserMedia({
              audio: {
                deviceId: deviceId ? { exact: deviceId } : undefined,
                echoCancellation: true, noiseSuppression: true, channelCount: 1,
              },
            }),
          );
      } else {
        this.streams.push(
          await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: deviceId ? { exact: deviceId } : undefined,
              echoCancellation: source !== "obs",
              noiseSuppression: source !== "obs",
              channelCount: 1,
            },
          }),
        );
      }
    } catch (error) {
      this.release();
      throw error;
    }
  }
  async start(source: string, deviceId: string) {
    try {
      await this.prepare(source, deviceId);
      if (this.streams.some((stream) => stream.getTracks().some((track) => track.readyState === "ended")))
        throw new Error("A fonte foi encerrada antes da captura começar. Selecione-a novamente.");
      this.context = new AudioContext({ sampleRate: 16000 });
      if (this.context.sampleRate !== 16000)
        throw new Error(
          "Este navegador não oferece captura em 16 kHz. Use Chrome ou Edge atualizados.",
        );
      await this.context.audioWorklet.addModule("/audio-capture.js");
      this.node = new AudioWorkletNode(this.context, "audiowhisper-capture");
      for (const stream of this.streams)
        this.context
          .createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
          .connect(this.node);
      const gain = this.context.createGain();
      gain.gain.value = 0;
      this.node.connect(gain).connect(this.context.destination);
      this.node.port.onmessage = ({
        data,
      }: MessageEvent<Float32Array | { flushed: true }>) => {
        if (data instanceof Float32Array) this.receive(data);
        else this.flushed?.();
      };
      this.streams
        .flatMap((stream) => stream.getTracks())
        .forEach((track) =>
          track.addEventListener("ended", () => this.onEnded?.()),
        );
      await this.context.resume();
      this.context.onstatechange = () => {
        if (this.context?.state === "closed") this.onEnded?.();
        else this.onInterrupted?.(this.context?.state !== "running");
      };
      document.addEventListener("visibilitychange", this.restore);
      window.addEventListener("focus", this.restore);
    } catch (error) {
      this.release();
      throw error;
    }
  }
  async resume() {
    if (!this.context) return;
    if (this.context.state !== "running") await this.context.resume();
    this.onInterrupted?.(this.context.state !== "running");
  }
  private restore = () => {
    if (document.visibilityState === "visible")
      void this.resume().catch(() => this.onInterrupted?.(true));
  };
  private receive(frame: Float32Array) {
    this.total += frame.length;
    const rms = Math.sqrt(
      frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length,
    );
    this.onLevel(Math.min(1, rms * 12), this.total / 16000);
    if (!this.size && rms < 0.008) {
      this.preRoll.push(frame);
      if (this.preRoll.length > 2) this.preRoll.shift();
      return;
    }
    if (!this.size) {
      this.utteranceStart =
        (this.total -
          frame.length -
          this.preRoll.reduce((sum, part) => sum + part.length, 0)) /
        16000;
      this.frames = this.preRoll;
      this.preRoll = [];
      this.size = this.frames.reduce((sum, part) => sum + part.length, 0);
      this.lastUpdate = 0;
    }
    this.frames.push(frame);
    this.size += frame.length;
    if (rms >= 0.008) this.lastVoice = this.total;
    const seconds = this.size / 16000;
    if (
      seconds >= 20 ||
      (seconds >= 1 && (this.total - this.lastVoice) / 16000 >= 0.8)
    )
      this.flush(true);
    else if (seconds - this.lastUpdate >= 4) {
      this.flush(false);
      this.lastUpdate = seconds;
    }
  }
  private flush(final: boolean) {
    if (!this.size) return;
    const data = new Float32Array(this.size);
    let offset = 0;
    for (const frame of this.frames) {
      data.set(frame, offset);
      offset += frame.length;
    }
    this.onChunk({
      sequence: this.sequence,
      revision: this.revision++,
      start: this.utteranceStart,
      final,
      blob: encodeWav(data),
    });
    if (final) {
      this.frames = [];
      this.size = 0;
      this.sequence++;
      this.revision = 0;
    }
  }
  async stop() {
    if (this.node)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 500);
        this.flushed = () => {
          clearTimeout(timer);
          resolve();
        };
        this.node!.port.postMessage("flush");
      });
    this.flush(true);
    const result = {
      expected_chunks: this.sequence,
      duration: this.total / 16000,
    };
    this.release();
    return result;
  }
  release() {
    document.removeEventListener("visibilitychange", this.restore);
    window.removeEventListener("focus", this.restore);
    this.node?.disconnect();
    this.node = null;
    for (const stream of this.streams)
      stream.getTracks().forEach((track) => track.stop());
    this.streams = [];
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close();
    }
    this.context = null;
  }
}
