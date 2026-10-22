import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // Several tests trigger a real GPU transcription. Each Playwright worker is a real Chromium
  // instance rendering the app's own WebGL content (PixiJS pulse, the Three.js hero scene,
  // WaveSurfer) — with high parallelism those compete on the *host* GPU with the containerized
  // worker's CUDA compute for the same physical card, which starved it enough during
  // development to cause real OOM/fallback churn. 2 keeps meaningful parallelism without that;
  // override with `--workers=N` if your GPU has more headroom (or is a different one).
  workers: 2,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  // Several tests wait for a real GPU transcription to complete (see editor.spec.ts); the
  // per-test default (30s) is far too short for that, even with a warm model.
  timeout: 6 * 60_000,
  use: {
    actionTimeout: 20000,
    navigationTimeout: 30000,
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8080",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Chromium-based mobile emulation (not iPhone/WebKit) — keeps the suite to a single
    // browser engine so `npx playwright install chromium` alone is enough to run it.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
