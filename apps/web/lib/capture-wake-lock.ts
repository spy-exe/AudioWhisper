export type CaptureWakeState = "active" | "released" | "unavailable";

/** Screen wake locks are released by the browser when a tab is hidden. */
export class CaptureWakeLock {
  private active = false;
  private sentinel: WakeLockSentinel | null = null;
  private requesting = false;

  constructor(private onState: (state: CaptureWakeState) => void) {}

  private request = async () => {
    if (!this.active || this.sentinel || this.requesting || document.visibilityState !== "visible") return;
    if (!navigator.wakeLock) {
      this.onState("unavailable");
      return;
    }
    this.requesting = true;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (!this.active) {
        await sentinel.release();
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener("release", () => {
        if (this.sentinel === sentinel) {
          this.sentinel = null;
          if (this.active) this.onState("released");
        }
      }, { once: true });
      this.onState("active");
    } catch {
      if (this.active) this.onState("unavailable");
    } finally {
      this.requesting = false;
    }
  };

  async start() {
    this.active = true;
    document.addEventListener("visibilitychange", this.request);
    await this.request();
  }

  stop() {
    this.active = false;
    document.removeEventListener("visibilitychange", this.request);
    const sentinel = this.sentinel;
    this.sentinel = null;
    void sentinel?.release().catch(() => undefined);
  }
}
