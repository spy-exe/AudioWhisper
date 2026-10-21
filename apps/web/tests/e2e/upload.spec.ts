import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEECH_FIXTURE = path.join(__dirname, "fixtures", "speech.wav");
const FAKE_FIXTURE = path.join(__dirname, "fixtures", "fake.mp3");

test("uploads a valid audio file and shows it ready to transcribe", async ({ page }) => {
  await page.goto("/");
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(SPEECH_FIXTURE);

  await expect(page.getByLabel("Importar gravação").getByText("speech.wav", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Transcrever" })).toBeVisible({ timeout: 20_000 });
});

test("rejects a disguised non-audio file with an inline error", async ({ page }) => {
  await page.goto("/");
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(FAKE_FIXTURE);

  await expect(page.getByText(/erro/i)).toBeVisible({ timeout: 20_000 });
});

test("creating a job navigates to the job detail page", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(SPEECH_FIXTURE);
  await page.getByRole("button", { name: "Transcrever" }).click({ timeout: 20_000 });

  await expect(page).toHaveURL(/\/jobs\/[a-f0-9-]+/, { timeout: 20_000 });
});
