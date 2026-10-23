import { expect, test } from "@playwright/test";

test("the isolated library opens without creating recordings", async ({ page, request }) => {
  const before = await (await request.get("/api/library?limit=1")).json();
  const health = await (await request.get("/api/health")).json();
  expect(health.environment).toBe("e2e");
  await page.goto("/library");
  await expect(page.getByRole("heading", { level: 1, name: "Biblioteca" })).toBeVisible();
  const after = await (await request.get("/api/library?limit=1")).json();
  expect(after.total).toBe(before.total);
});
