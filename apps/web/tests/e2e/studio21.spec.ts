import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SPEECH = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "speech.wav");
const TRANSCRIBE_TIMEOUT_MS = 5 * 60_000;

async function transcribe(page: Page): Promise<string> {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(SPEECH);
  await page.getByRole("button", { name: "Transcrever", exact: true }).click({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/jobs\/[a-f0-9-]+/, { timeout: 20_000 });
  await expect(page.getByRole("textbox", { name: /^Texto em/ }).first()).toBeVisible({ timeout: TRANSCRIBE_TIMEOUT_MS });
  return new URL(page.url()).pathname.split("/").pop()!;
}

async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('main [style*="opacity"]')].every((el) => Number(getComputedStyle(el).opacity) >= 0.99));
}

async function expectAccessible(page: Page) {
  await settled(page);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(audit.violations, JSON.stringify(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), null, 2)).toEqual([]);
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
}

test("insights, keyboard bookmarks and a Markdown export that carries them", async ({ page }, testInfo) => {
  await transcribe(page);
  await page.getByRole("tab", { name: "Insights" }).click();
  const insights = page.getByRole("region", { name: "Insights da conversa" });
  await expect(insights).toBeVisible();
  await expect(insights.locator(".insight-tile dt", { hasText: "Palavras" })).toBeVisible();
  await expect(insights.getByRole("button", { name: /com fala$/ }).first()).toBeVisible();

  await page.keyboard.press("m");
  await expect(page.getByRole("tab", { name: "Marcadores 1" })).toBeVisible();
  await page.getByRole("tab", { name: "Marcadores 1" }).click();
  await expect(page.getByRole("button", { name: /Ir para Momento em 00:00/ })).toBeVisible();

  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("speech.md");
  const destination = testInfo.outputPath("speech.md");
  await download.saveAs(destination);
  const markdown = await readFile(destination, "utf-8");
  expect(markdown).toContain("## Marcadores");
  expect(markdown).toContain("Momento em 00:00");
});

test("split a segment at the cursor and join it back", async ({ page }) => {
  await transcribe(page);
  const texts = page.getByRole("textbox", { name: /^Texto em/ });
  const before = await texts.count();
  const first = texts.first();
  const original = await first.inputValue();
  const cut = original.indexOf(" ", 4);
  await first.click();
  // Control+Home: plain Home only reaches the start of the wrapped visual line.
  await first.press("Control+Home");
  for (let i = 0; i < cut; i += 1) await first.press("ArrowRight");
  await page.getByRole("button", { name: "Dividir no cursor" }).first().click();
  await expect(page.getByText("Trecho dividido.")).toBeVisible();
  await expect(texts).toHaveCount(before + 1);
  await expect(texts.first()).toHaveValue(original.slice(0, cut).trim());

  await page.getByRole("button", { name: /^Ir para/ }).nth(0).click();
  await page.getByRole("button", { name: /^Ir para/ }).nth(1).click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Juntar 2 trechos" }).click();
  await expect(page.getByText("2 trechos unidos.")).toBeVisible();
  await expect(texts).toHaveCount(before);
  await expect(texts.first()).toHaveValue(original.trim());
});

test("find a spoken moment from search and the library, landing on that moment", async ({ page }) => {
  const jobId = await transcribe(page);
  await page.goto("/search?q=TRANSCRIPTION");
  const hit = page.locator(`a[href^="/jobs/${jobId}?t="]`).first();
  await expect(hit).toBeVisible();
  await expect(hit.locator("mark")).toHaveText(/transcription/i);
  await hit.click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${jobId}\\?t=\\d+`));
  await expect(page.getByRole("button", { name: /^Ir para .* \(selecionado\)$/ })).toBeVisible({ timeout: 30_000 });

  await page.goto("/library?q=transcriptión");
  const snippet = page.locator(`a[href^="/jobs/${jobId}?t="]`).first();
  await expect(snippet.locator("mark")).toHaveText(/transcription/i);
});

test("download every format as a ZIP, start a new run and delete the recording", async ({ page, request }) => {
  const jobId = await transcribe(page);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar todos (ZIP)" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("speech.zip");
  const zip = await readFile((await download.path())!);
  expect(zip.subarray(0, 2).toString()).toBe("PK");

  await page.getByRole("button", { name: "Transcrever novamente" }).click();
  const dialog = page.getByRole("dialog", { name: "Transcrever novamente" });
  await dialog.getByRole("combobox", { name: "Modelo" }).selectOption("small");
  await dialog.getByRole("button", { name: "Transcrever novamente" }).click();
  await expect(page).not.toHaveURL(new RegExp(jobId));
  await expect(page.getByRole("textbox", { name: /^Texto em/ }).first()).toBeVisible({ timeout: TRANSCRIBE_TIMEOUT_MS });
  const rerunId = new URL(page.url()).pathname.split("/").pop()!;

  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Excluir esta gravação?" });
  await expect(confirm.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await confirm.getByRole("button", { name: "Excluir gravação" }).click();
  await expect(page).toHaveURL(/\/library/);
  expect((await request.get(`/api/jobs/${rerunId}`)).status()).toBe(404);
  expect((await request.get(`/api/jobs/${jobId}`)).status()).toBe(200);
  await request.delete(`/api/jobs/${jobId}`);
});

test("shortcuts dialog, insights and search pages are accessible and fit a 320px screen", async ({ page }) => {
  await transcribe(page);
  await page.keyboard.press("Shift+?");
  const shortcuts = page.getByRole("dialog", { name: "Atalhos do editor" });
  await expect(shortcuts).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(shortcuts).toBeHidden();

  await page.getByRole("tab", { name: "Insights" }).click();
  await expect(page.getByRole("region", { name: "Insights da conversa" })).toBeVisible();
  await expectAccessible(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await noHorizontalOverflow(page);

  await page.goto("/search?q=test");
  await expect(page.getByRole("heading", { name: "Buscar momentos" })).toBeVisible();
  await expect(page.getByText(/momentos? encontrados?/)).toBeVisible();
  await noHorizontalOverflow(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expectAccessible(page);
});

test("vocabulary and storage settings persist and validate", async ({ page, request }) => {
  // Global settings: start from a known state and always restore it, even if an assertion fails.
  const reset = () => request.put("/api/settings", { data: { values: { vocabulary: "", default_beam_size: 5 } } });
  await reset();
  try {
    await page.goto("/settings");
    const vocabulary = page.getByRole("textbox", { name: /Contexto e grafias/ });
    await vocabulary.fill("AudioWhisper, Opikode e Trofi");
    await page.getByRole("button", { name: "Salvar vocabulário" }).click();
    await expect(page.locator(".settings-feedback")).toContainText("Vocabulário salvo");
    await page.reload();
    await expect(page.getByRole("textbox", { name: /Contexto e grafias/ })).toHaveValue("AudioWhisper, Opikode e Trofi");
    await expect(page.getByRole("meter", { name: "Uso do disco" })).toBeVisible();

    await page.getByRole("spinbutton", { name: "Beam size" }).fill("0");
    await expect(page.locator(".settings-feedback")).toContainText("Use um número inteiro entre 1 e 10");
    expect((await (await request.get("/api/settings")).json()).default_beam_size).toBe(5);
  } finally {
    await reset();
  }
});
