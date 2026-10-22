import { expect, test } from "@playwright/test";

test("secondary forms preserve drafts when closed and reopened", async ({
  page,
}) => {
  for (const [route, label, field] of [
    ["/projects", "Novo projeto", "Nome do projeto"],
    ["/tasks", "Nova tarefa", "Título da tarefa"],
    ["/recipes", "Novo modelo de documento", "Nome do modelo"],
  ]) {
    await page.goto(route);
    const input = page.getByLabel(field, { exact: true });
    const summary = page
      .locator("summary")
      .filter({ hasText: new RegExp(`^${label}$`) });
    await expect(input).not.toBeVisible();
    await summary.focus();
    await summary.press("Enter");
    await input.fill("Rascunho de trabalho");
    await summary.click();
    await expect(input).not.toBeVisible();
    await summary.click();
    await expect(input).toHaveValue("Rascunho de trabalho");
    await input.fill("");
  }
});

test("collapsed filters show their count and preserve applied URL values", async ({
  page,
}) => {
  const project = "QA filtros de tarefas";
  await page.goto(`/tasks?project=${encodeURIComponent(project)}&status=doing`);
  const summary = page
    .locator("summary")
    .filter({ hasText: /^Filtros \(2\)$/ });
  const projectField = page.getByRole("combobox", {
    name: "Filtrar projeto",
    exact: true,
  });
  await expect(summary).toBeVisible();
  await expect(projectField).not.toBeVisible();
  await summary.focus();
  await summary.press("Enter");
  await expect(projectField).toHaveValue(project);
  await expect(
    page.getByRole("combobox", { name: "Filtrar estado", exact: true }),
  ).toHaveValue("doing");
  await summary.click();
  await expect(projectField).not.toBeVisible();
  await page.reload();
  await expect(summary).toBeVisible();
  await summary.click();
  await expect(projectField).toHaveValue(project);
  await expect(page).toHaveURL(/status=doing/);
});
