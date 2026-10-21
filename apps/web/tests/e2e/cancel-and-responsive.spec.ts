import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// A long clip on purpose: once the model is warm in the worker process, a short clip finishes
// in ~1-2s — too fast to reliably land a cancel click before the job completes on its own.
const LONG_SPEECH_FIXTURE = path.join(__dirname, "fixtures", "long_speech.wav");

test("cancelling a job shows the cancelled state", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(LONG_SPEECH_FIXTURE);
  await page.getByRole("button", { name: "Transcrever" }).click({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/jobs\/[a-f0-9-]+/, { timeout: 20_000 });

  const cancelButton = page.getByRole("button", { name: "Cancelar" });
  await cancelButton.click({ timeout: 60_000 });

  // Model loading is synchronous; cancellation is acknowledged immediately, then
  // completed cooperatively when the current operation releases the worker.
  await expect(page.getByRole("heading", { name: /cancelado/i })).toBeVisible({ timeout: 300_000 });
});

test("home page renders without horizontal overflow at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1);
});

test("home page renders without horizontal overflow at desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1);
});

test("settings page toggles visual effects", async ({ page }) => {
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: /efeitos visuais/i });
  const before = await toggle.getAttribute("aria-checked");
  await toggle.click();
  await expect(toggle).not.toHaveAttribute("aria-checked", before ?? "");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", before ?? "");
});
