import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const directory = path.dirname(fileURLToPath(import.meta.url));
const speech = path.join(directory, "fixtures", "speech.wav");
const meeting = path.join(directory, "fixtures", "meeting.wav");
test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${speech}`],
  },
});

test("library search, clear and narrow layout stay usable", async ({
  page,
}) => {
  await page.goto("/library");
  const search = page.getByRole("searchbox", { name: "Buscar na biblioteca" });
  await search.fill("no-result-audiowhisper-2-test");
  await expect(page.getByText("Nenhuma gravação encontrada")).toBeVisible();
  await page.getByRole("button", { name: "Limpar busca" }).click();
  await expect(search).toHaveValue("");
  await page
    .getByRole("combobox", { name: "Filtrar por status" })
    .selectOption("completed");
  await expect(page).toHaveURL(/status=completed/);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
});

test("local AI document can be generated, reviewed, exported and revoked", async ({
  page,
  request,
}, testInfo) => {
  const provider = await (await request.get("/api/intelligence")).json();
  expect(
    provider.available,
    "Ollama local deve estar disponível para este fluxo completo",
  ).toBeTruthy();
  expect(provider.models.length).toBeGreaterThan(0);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(meeting);
  await page.getByRole("button", { name: "Transcrever", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Assistente de IA" }),
  ).toBeVisible({ timeout: 300000 });
  await page
    .getByRole("combobox", { name: "Documento", exact: true })
    .selectOption("summary");
  await page
    .getByRole("combobox", { name: "Modelo local", exact: true })
    .selectOption(provider.models[0]);
  await page
    .getByRole("button", { name: "Gerar documento", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirmar revisão" }),
  ).toBeVisible({ timeout: 300000 });
  const source = page.getByRole("button", { name: /^Ouvir fonte em/ }).first();
  await expect(source).toBeVisible();
  await source.click();
  await expect(page.locator("audio")).toHaveJSProperty("paused", false);
  await page.getByRole("button", { name: "Confirmar revisão" }).click();
  await expect(
    page.getByRole("heading", { name: "Compartilhar documento revisado" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Criar link privado" }).click();
  const share = page.getByRole("textbox", { name: "Novo link privado" });
  await expect(share).toBeVisible();
  const url = await share.inputValue();
  const publicPage = await page.context().newPage();
  await publicPage.goto(url);
  await expect(
    publicPage.getByRole("heading", { name: "Documento compartilhado" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Revogar", exact: true })
    .first()
    .click();
  await publicPage.reload();
  await expect(publicPage.getByText(/link expirou/)).toBeVisible();
  await publicPage.close();
  const workspace = page.getByRole("complementary", { name: "Assistente de IA" });
  await expect(workspace.getByText(/Fontes: \d{2}:\d{2}:\d{2}/)).toBeVisible();
  await expect(workspace).not.toContainText(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  await workspace.getByText("Exportar", { exact: true }).click();
  for (const format of ["PDF", "DOCX"]) {
    const downloaded = page.waitForEvent("download");
    await workspace.getByRole("link", { name: format, exact: true }).click();
    const download = await downloaded;
    expect(await download.failure()).toBeNull();
    const destination = testInfo.outputPath(`document.${format.toLowerCase()}`);
    await download.saveAs(destination);
    const data = await readFile(destination);
    expect(data.subarray(0, format === "PDF" ? 4 : 2).toString())
      .toBe(format === "PDF" ? "%PDF" : "PK");
  }
  await workspace.getByText("Exportar", { exact: true }).click();
  const pause = page.getByRole("button", { name: "Pausar", exact: true });
  if (await pause.isVisible()) await pause.click();
  await page.keyboard.press("Control+Home");
  await page.screenshot({ path: testInfo.outputPath("workspace.png"), fullPage: true });
});

test.describe("live capture with a synthetic microphone", () => {
  test("recovers saved audio after upload failure and page reload", async ({ page }) => {
    page.on("dialog", (dialog) => { void dialog.accept(); });
    await page.route("**/api/live/*/chunks/*", (route) => route.abort("internetdisconnected"));
    await page.goto("/");
    await page.getByRole("textbox", { name: "Título da captura" }).fill("QA Recuperação de captura");
    const failed = page.waitForEvent("requestfailed", {
      predicate: (request) => request.url().includes("/chunks/"),
    });
    await page.getByRole("button", { name: "Iniciar captura" }).click();
    await failed;
    await page.unroute("**/api/live/*/chunks/*");
    await page.reload();
    await page.getByRole("button", { name: "Recuperar captura" }).click();
    await expect(page.getByText("Gravação consolidada")).toBeVisible({ timeout: 300000 });
    await page.getByRole("link", { name: "Abrir transcrição" }).click();
    await expect(page.getByRole("textbox", { name: /^Texto em/ }).first()).not.toHaveValue("");
  });

  test("captures, persists and finalizes audio without leaving the Studio", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("textbox", { name: "Título da captura" })
      .fill("QA Live Studio");
    await page.getByRole("button", { name: "Iniciar captura" }).click();
    const stop = page.getByRole("button", { name: "Encerrar captura" });
    await expect(stop).toBeVisible();
    await page.waitForTimeout(6500); // Real audio samples must reach the AudioWorklet.
    await stop.click();
    await expect(page.getByText("Gravação consolidada")).toBeVisible({
      timeout: 300000,
    });
    await page.getByRole("link", { name: "Abrir transcrição" }).click();
    await expect(page.locator("textarea").first()).toBeVisible({
      timeout: 30000,
    });
  });
});
