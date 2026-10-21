import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Studio, library and settings pass automated accessibility checks", async ({ page }) => {
  for (const route of ["/", "/library", "/settings"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    if (route === "/settings") await expect(page.locator("select.select-field").first()).toBeVisible();
    await page.waitForFunction(() => [...document.querySelectorAll('main [style*="opacity"]')].every(el => Number(getComputedStyle(el).opacity) >= 0.99));
    const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(audit.violations, JSON.stringify(audit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), null, 2)).toEqual([]);
  }
});

test("ambient motion moves normally and stops for OS and application preferences", async ({ page }) => {
  let enabled = true;
  await page.route("**/api/settings", async route => {
    if (route.request().method() === "PUT") {
      enabled = route.request().postDataJSON().values.visual_effects_enabled;
      await route.fulfill({ json: { visual_effects_enabled: enabled } });
    } else {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), visual_effects_enabled: enabled } });
    }
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "false");
  const ribbon = page.locator(".signal-motion");
  const before = await ribbon.evaluate(el => getComputedStyle(el).transform);
  await page.waitForTimeout(350); // Observe actual animation frames, not a declared CSS class.
  expect(await ribbon.evaluate(el => getComputedStyle(el).transform)).not.toBe(before);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
  await expect.poll(() => ribbon.evaluate(el => el.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: /Efeitos visuais/ });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
  await page.getByRole("link", { name: "Studio", exact: true }).click();
  await expect.poll(() => ribbon.evaluate(el => el.getAnimations().filter(a => a.playState === "running").length)).toBe(0);
  expect(await page.getByRole("button", { name: "Iniciar captura" }).evaluate(el => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(0.001);
});

test("keyboard focus, native selects and readable controls remain usable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Ir para o conteúdo" })).toBeFocused();
  await page.keyboard.press("Enter");
  const input = page.getByRole("textbox", { name: "Título da captura" });
  await input.focus();
  expect(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await page.getByRole("link", { name: "Configurações", exact: true }).click();
  const select = page.locator("select.select-field").first();
  await select.focus();
  await select.press("Alt+ArrowDown");
  await select.press("Escape");
  await expect(select).toBeFocused();
  expect(await select.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
  for (const toggle of await page.getByRole("switch").all()) {
    const bounds = await toggle.evaluate(el => {
      const track = el.getBoundingClientRect();
      const thumb = el.lastElementChild!.getBoundingClientRect();
      return { left: thumb.left - track.left, right: thumb.right - track.right };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(0);
  }
});
