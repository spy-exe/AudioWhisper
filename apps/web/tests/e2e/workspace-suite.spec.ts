import path from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext } from "@playwright/test";

const meeting = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "meeting.wav",
);

async function fixtureJob(request: APIRequestContext) {
  const bytes = await readFile(meeting),
    digest = createHash("sha256").update(bytes).digest("hex");
  const page = await (
    await request.get("/api/library?q=meeting.wav&limit=50")
  ).json();
  let mediaId: string | undefined;
  for (const item of page.items) {
    const media = await (
      await request.get(`/api/media/${item.job.media_file_id}`)
    ).json();
    if (media.sha256 === digest) {
      mediaId = media.id;
      break;
    }
  }
  if (!mediaId) {
    const uploaded = await request.post("/api/media/upload", {
      multipart: {
        file: { name: "meeting.wav", mimeType: "audio/wav", buffer: bytes },
      },
    });
    expect(uploaded.ok()).toBeTruthy();
    mediaId = (await uploaded.json()).id;
  }
  const response = await request.post("/api/jobs", {
    data: {
      media_file_id: mediaId,
      settings: {
        model_name: "turbo",
        device: "cuda",
        compute_type: "float16",
        language: "pt",
        beam_size: 5,
        vad_enabled: true,
        word_timestamps: true,
        translate_to_english: false,
        temperature: 0,
      },
    },
  });
  expect(response.ok()).toBeTruthy();
  const job = await response.json();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/jobs/${job.id}`)).json()).status,
      { timeout: 300000, intervals: [1000, 3000] },
    )
    .toBe("completed");
  return job.id as string;
}

test("projects, evidence, notebook, tasks, local questions and recipes form a complete workflow", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(720000);
  page.setDefaultTimeout(15000);
  const project = `QA Workspace ${testInfo.project.name} ${Date.now()}`;
  const job = await fixtureJob(request);
  await page.goto("/projects");
  await page
    .locator("summary")
    .filter({ hasText: /^Novo projeto$/ })
    .click();
  await page.getByLabel("Nome do projeto", { exact: true }).fill(project);
  await page
    .getByLabel("Descrição", { exact: true })
    .fill(
      "Planejamento e confiabilidade da infraestrutura. Conteúdo sintético para QA.",
    );
  await page
    .getByRole("combobox", { name: "Cor", exact: true })
    .selectOption("violet");
  await page
    .getByRole("button", { name: "Criar projeto", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Projeto criado" }),
  ).toBeVisible();
  expect(
    (
      await request.put(`/api/library/${job}`, {
        data: {
          title: "Planejamento de infraestrutura, QA",
          project,
          speakers: {},
          tags: ["qa-workspace"],
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.getByRole("link", { name: new RegExp(project) }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: project }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Planejamento de infraestrutura/ }),
  ).toBeVisible();

  const segments = await (
    await request.get(`/api/jobs/${job}/segments`)
  ).json();
  expect(segments.length).toBeGreaterThan(0);
  const text = segments
    .map((segment: { text: string }) => segment.text)
    .join(" ");
  const term = /backup/i.test(text)
    ? "backup"
    : (text.match(/[\p{L}]{6,}/u)?.[0] ?? "reunião");
  await page.goto(
    `/search?project=${encodeURIComponent(project)}&q=${encodeURIComponent(term)}`,
  );
  const hit = page.getByRole("link", { name: /Ouvir trecho/ }).first();
  await expect(hit).toBeVisible();
  const target = new URL((await hit.getAttribute("href"))!, "http://localhost");
  await hit.click();
  await expect(
    page.getByRole("textbox", { name: /^Texto em/ }).first(),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeCloseTo(Number(target.searchParams.get("t")), 0);
  await page
    .locator("summary")
    .filter({ hasText: /^Adicionar registro$/ })
    .click();
  await page
    .getByLabel("Título do registro", { exact: true })
    .fill("Confiabilidade dos backups");
  await page
    .getByRole("combobox", { name: "Tipo de registro", exact: true })
    .selectOption("chapter");
  await page
    .getByLabel("Sua anotação", { exact: true })
    .fill("Revisar os encaminhamentos antes da próxima conversa.");
  await page
    .getByRole("button", { name: "Salvar no caderno", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Registro salvo" }),
  ).toBeVisible();
  await page.goto(`/notebook?project=${encodeURIComponent(project)}`);
  await expect(
    page.getByRole("heading", { name: "Confiabilidade dos backups" }),
  ).toBeVisible();

  await page.goto(`/tasks?project=${encodeURIComponent(project)}`);
  await page
    .locator("summary")
    .filter({ hasText: /^Nova tarefa$/ })
    .click();
  await page
    .getByLabel("Título da tarefa", { exact: true })
    .fill("Revisar indicadores de backup");
  await page.getByLabel("Prazo", { exact: true }).fill("2026-12-01");
  await page
    .getByRole("button", { name: "Adicionar tarefa", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Revisar indicadores de backup" }),
  ).toBeVisible();
  const state = page.getByRole("combobox", {
    name: "Estado de Revisar indicadores de backup",
  });
  await state.selectOption("doing");
  await expect(state).toHaveValue("doing");
  await page.reload();
  await expect(
    page.getByRole("combobox", {
      name: "Estado de Revisar indicadores de backup",
    }),
  ).toHaveValue("doing");

  const provider = await (await request.get("/api/intelligence")).json();
  expect(provider.available && provider.models.length > 0).toBeTruthy();
  await page.goto(`/knowledge?project=${encodeURIComponent(project)}`);
  await page
    .getByLabel("Sua pergunta", { exact: true })
    .fill(`O que foi discutido sobre ${term}?`);
  await page
    .getByRole("button", { name: "Consultar gravações", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Pergunta adicionada" }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(
              `/api/knowledge?project=${encodeURIComponent(project)}`,
            )
          ).json()
        ).items[0]?.status,
      { timeout: 300000, intervals: [1000, 3000] },
    )
    .toBe("completed");
  const answer = (
    await (
      await request.get(`/api/knowledge?project=${encodeURIComponent(project)}`)
    ).json()
  ).items[0];
  expect(answer.retrieval_count).toBeGreaterThan(0);
  expect(answer.items.length).toBeGreaterThan(0);
  for (const source of answer.sources)
    expect(
      segments.find(
        (segment: { id: string }) => segment.id === source.segment_id,
      )?.text,
    ).toBe(source.text);

  await page.goto(`/recipes?project=${encodeURIComponent(project)}`);
  await page
    .locator("summary")
    .filter({ hasText: /^Novo modelo de documento$/ })
    .click();
  await page
    .getByLabel("Nome do modelo", { exact: true })
    .fill("Plano de ação da infraestrutura");
  await page
    .getByRole("combobox", { name: "Documento", exact: true })
    .selectOption("actions");
  await page
    .getByRole("button", { name: "Salvar modelo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Plano de ação da infraestrutura" }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Escolher gravação para executar",
      exact: true,
    })
    .click();
  await page
    .getByRole("radio", { name: /Planejamento de infraestrutura/ })
    .check();
  await page
    .getByRole("button", { name: "Preparar documento", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(
              `/api/recipe-runs?project=${encodeURIComponent(project)}`,
            )
          ).json()
        ).items[0]?.status,
      { timeout: 300000, intervals: [1000, 3000] },
    )
    .toBe("completed");
  await page.getByRole("link", { name: /Revisar documento/ }).click();
  await page
    .getByRole("button", { name: "Confirmar revisão", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Adicionar ações ao plano", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Adicionar ações ao plano", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /tarefa\(s\) adicionada/ }),
  ).toBeVisible();
  const taskPage = await (
    await request.get(`/api/tasks?project=${encodeURIComponent(project)}`)
  ).json();
  expect(taskPage.total).toBeGreaterThan(1);
  expect(
    taskPage.items.some(
      (task: { sources: unknown[] }) => task.sources.length > 0,
    ),
  ).toBeTruthy();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Ir para" });
  await expect(palette).toBeVisible();
  await palette
    .getByRole("searchbox", { name: "Buscar comando" })
    .fill("central");
  await palette.getByRole("link", { name: /Central/ }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Mais", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Navegação" })
      .getByRole("link", { name: /Caderno/ })
      .click();
    await expect(page).toHaveURL(/\/notebook$/);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
});

test("unsaved forms, modal keyboard and failed queries recover without losing work", async ({
  page,
}) => {
  await page.goto("/projects");
  await page
    .locator("summary")
    .filter({ hasText: /^Novo projeto$/ })
    .click();
  await page
    .getByLabel("Nome do projeto", { exact: true })
    .fill("Rascunho não salvo");
  await page
    .getByRole("link", { name: "Biblioteca", exact: true })
    .filter({ visible: true })
    .click();
  const guard = page.getByRole("dialog", { name: "Continuar sem salvar?" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Continuar editando" }).click();
  await expect(page.getByLabel("Nome do projeto", { exact: true })).toHaveValue(
    "Rascunho não salvo",
  );
  await page.getByLabel("Nome do projeto", { exact: true }).fill("");
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("searchbox", { name: "Buscar comando" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByLabel("Nome do projeto", { exact: true }),
  ).toBeFocused();
  await page.route("**/api/search?**", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: "UNAVAILABLE",
          message: "Serviço temporariamente indisponível",
          details: {},
        },
      },
    }),
  );
  await page.goto("/search?q=backup");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "temporariamente indisponível",
  );
  await page.unroute("**/api/search?**");
  await page
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("project names preserve accents, percent signs and slashes through navigation", async ({
  page,
  request,
}) => {
  page.setDefaultTimeout(15000);
  const name = `QA URI ação 100% / equipes ${Date.now()}`;
  expect(
    (
      await request.post("/api/projects", {
        data: { name, description: "Teste de identidade", color: "amber" },
      })
    ).status(),
  ).toBe(201);
  await page.goto(`/projects/${encodeURIComponent(name)}`);
  await expect(
    page.getByRole("heading", { level: 1, name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("paragraph").filter({ hasText: /^Teste de identidade$/ }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});
