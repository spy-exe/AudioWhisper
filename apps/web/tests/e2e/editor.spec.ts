import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEECH_FIXTURE = path.join(__dirname, "fixtures", "speech.wav");

// First run pays for the model download (can be 1-2 GiB); subsequent runs are fast since the
// model is cached in the `model_cache` volume.
const TRANSCRIBE_TIMEOUT_MS = 5 * 60_000;

async function uploadAndWaitForCompletion(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(SPEECH_FIXTURE);
  await page.getByRole("button", { name: "Transcrever" }).click({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/jobs\/[a-f0-9-]+/, { timeout: 20_000 });
  await expect(page.getByText(/exportar/i)).toBeVisible({ timeout: TRANSCRIBE_TIMEOUT_MS });
}

test("transcription completes and the editor loads with segments", async ({ page }) => {
  await uploadAndWaitForCompletion(page);
  await expect(page.locator("textarea").first()).toBeVisible();
});

test("clicking a segment timestamp seeks and highlights it", async ({ page }) => {
  await uploadAndWaitForCompletion(page);
  const firstTimestamp = page.locator("button[aria-label^='Ir para']").first();
  await firstTimestamp.click();
  await expect(page.locator("audio")).toHaveJSProperty("paused", true);
});

test("editing a segment shows the saving/saved indicator", async ({ page }) => {
  await uploadAndWaitForCompletion(page);
  const textarea = page.locator("textarea").first();
  await textarea.fill("Texto editado pelo teste automatizado.");
  await textarea.blur();
  await expect(page.getByText(/salvando|salvo/i)).toBeVisible({ timeout: 5_000 });
});

test("Ctrl+F opens the search bar and finds a match", async ({ page }) => {
  await uploadAndWaitForCompletion(page);
  const textarea = page.locator("textarea").first();
  const text = await textarea.inputValue();
  const word = text.trim().split(/\s+/)[0]?.replace(/[^\w]/g, "") ?? "test";

  await page.keyboard.press("Control+f");
  await expect(page.getByPlaceholder("Pesquisar na transcrição…")).toBeVisible();
  await page.getByPlaceholder("Pesquisar na transcrição…").fill(word);
  await expect(page.getByText(/1\/\d+/)).toBeVisible();
});

test("space toggles playback only outside of text fields", async ({ page }) => {
  await uploadAndWaitForCompletion(page);
  const audio = page.locator("audio");

  await page.keyboard.press("Space");
  await expect(audio).toHaveJSProperty("paused", false);

  await page.locator("textarea").first().focus();
  await page.keyboard.press("Space");
  // still playing — space inside a text field must not toggle playback
  await expect(audio).toHaveJSProperty("paused", false);
});

test("exporting SRT triggers a download", async ({ page }) => {
  await uploadAndWaitForCompletion(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "SRT" }).click();
  const download = await downloadPromise;
  // Named after the recording (speech.wav), not a generic "transcript.srt".
  expect(download.suggestedFilename()).toBe("speech.srt");
});
