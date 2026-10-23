import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { getE2ETarget } from "../../scripts/e2e-target.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../../..");

async function connectFixture(page: Page) {
  // Documentation captures must never include the user's recent recordings.
  await page.route("**/api/library?**", (route) => route.fulfill({ json: { items: [], total: 0, offset: 0, limit: 5 } }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("http://127.0.0.1:8765/**", async (route) => {
    const response = await route.fetch({ url: route.request().url().replace(":8765", ":8766") });
    await route.fulfill({ response });
  });
}

test("Windows capture survives closing the entire browser and reconnects to the same recording", async ({ request }, testInfo) => {
  test.skip(process.platform !== "win32" || testInfo.project.name !== "chromium", "Capturador de desktop Windows; executado uma vez com um processo próprio.");
  const baseURL = getE2ETarget(testInfo.project.use.baseURL);
  const headers = { Origin: baseURL, "X-AudioWhisper-Capture": "1" };
  const log = openSync(testInfo.outputPath("capture-agent.log"), "w");
  const helper = spawn(process.env.CAPTURE_TEST_PYTHON ?? path.join(repository, ".venv-dev/Scripts/python.exe"), [
    path.join(repository, "apps/capture/tests/serve_fixture.py"), "--directory", testInfo.outputPath("spool"),
    "--audio", path.join(directory, "fixtures/speech.wav"),
    "--api-url", baseURL,
  ], { cwd: repository, windowsHide: true, stdio: ["ignore", log, log] });
  let browser = await chromium.launch();
  try {
    await expect.poll(async () => {
      try { return (await request.get("http://127.0.0.1:8766/health")).ok(); } catch { return false; }
    }).toBe(true);
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await connectFixture(page);
    await page.goto("/?capture=windows");
    const start = page.getByRole("button", { name: "Iniciar no Windows" });
    await expect(start).toBeEnabled();
    await page.getByRole("textbox", { name: "Título da gravação no Windows" }).fill("QA Capturador Windows");
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`windows-ready-${width}.png`), fullPage: true });
      if ([390, 1440].includes(width))
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    }
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await start.click();
    await expect(page.getByRole("button", { name: "Encerrar no Windows" })).toBeVisible();
    const first = await (await request.get("http://127.0.0.1:8766/status", { headers })).json();
    await browser.close(); // No browser process remains to own or deliver the capture.
    await expect.poll(async () => {
      const current = await (await request.get("http://127.0.0.1:8766/status", { headers })).json();
      expect(current.recording).toBe(true);
      expect(current.job_id).toBe(first.job_id);
      return current.duration;
    }, { timeout: 20000 }).toBeGreaterThan((first.duration ?? 0) + 7);
    browser = await chromium.launch();
    const resumedContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    const resumed = await resumedContext.newPage();
    await connectFixture(resumed);
    await resumed.goto("/?capture=windows");
    const stop = resumed.getByRole("button", { name: "Encerrar no Windows" });
    await expect(stop).toBeEnabled();
    await resumed.screenshot({ path: testInfo.outputPath("windows-recording-desktop.png"), fullPage: true });
    await resumed.setViewportSize({ width: 390, height: 844 });
    await resumed.screenshot({ path: testInfo.outputPath("windows-recording-mobile.png"), fullPage: true });
    await stop.click();
    await expect(resumed.getByRole("button", { name: "Iniciar no Windows" })).toBeVisible();
    await expect.poll(async () => (await (await request.get(`/api/jobs/${first.job_id}`)).json()).status, { timeout: 300000 }).toBe("completed");
    const segments = await (await request.get(`/api/jobs/${first.job_id}/segments`)).json();
    expect(segments.length).toBeGreaterThan(0);
  } finally {
    await request.post("http://127.0.0.1:8766/stop", { headers, data: {} }).catch(() => undefined);
    await browser.close();
    helper.kill();
    closeSync(log);
  }
});
