import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const output = 'test-results/workspace-visual';
const browser = await chromium.launch();
const report = { layouts: [], accessibility: [], states: [], errors: [] };
try {
  const context = await browser.newContext({ locale: 'pt-BR' });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  const projects = await (await page.request.get(base + '/api/projects?q=QA%20Workspace%20chromium&limit=100')).json();
  const fixtureHash = createHash('sha256').update(await readFile(new URL('../tests/e2e/fixtures/meeting.wav', import.meta.url))).digest('hex');
  let selected;
  for (const project of projects.items.sort((a, b) => String(b.last_activity).localeCompare(String(a.last_activity)))) {
    const runs = await (await page.request.get(base + '/api/recipe-runs?project=' + encodeURIComponent(project.name))).json();
    const tasks = await (await page.request.get(base + '/api/tasks?project=' + encodeURIComponent(project.name))).json();
    if (!runs.items.some(run => run.status === 'completed') || tasks.total <= 1) continue;
    const detail = await (await page.request.get(base + '/api/projects/' + encodeURIComponent(project.name))).json();
    const recordings = detail.recordings.items;
    let safe = recordings.length > 0 && recordings.length === detail.recording_count;
    for (const item of recordings) {
      const media = await (await page.request.get(base + '/api/media/' + item.job.media_file_id)).json();
      if (media.sha256 !== fixtureHash) safe = false;
    }
    if (safe) { selected = project.name; break; }
  }
  assert.ok(selected, 'Run the workspace E2E first; a completed synthetic project is required.');
  // Public screenshots only render the synthetic QA project, including global selectors and counters.
  for (const resource of ['library', 'tasks', 'notebook', 'knowledge', 'recipes', 'recipe-runs', 'workspace']) {
    await page.route(`**/api/${resource}?**`, async route => {
      const url = new URL(route.request().url()); url.searchParams.set('project', selected);
      const response = await route.fetch({ url: url.toString() }); await route.fulfill({ response });
    });
  }
  await page.route('**/api/projects?**', async route => {
    const url = new URL(route.request().url()); url.searchParams.set('q', selected);
    const response = await route.fetch({ url: url.toString() }); await route.fulfill({ response });
  });
  let effects = true;
  await page.route('**/api/settings', async route => { const response = await route.fetch(); await route.fulfill({ response, json: { ...await response.json(), visual_effects_enabled: effects } }); });
  const suffix = '?project=' + encodeURIComponent(selected);
  const detail = await (await page.request.get(base + '/api/projects/' + encodeURIComponent(selected))).json();
  const segments = await (await page.request.get(base + '/api/jobs/' + detail.recordings.items[0].job.id + '/segments')).json();
  const transcript = segments.map(segment => segment.text).join(' ');
  const searchTerm = /backup/i.test(transcript) ? 'backup' : (transcript.match(/[\p{L}]{6,}/u)?.[0] ?? 'reunião');
  const routes = [['central', '/workspace'], ['projects', '/projects'], ['project', '/projects/' + encodeURIComponent(selected)], ['search', '/search' + suffix + '&q=' + encodeURIComponent(searchTerm)], ['tasks', '/tasks' + suffix], ['notebook', '/notebook' + suffix], ['knowledge', '/knowledge' + suffix], ['recipes', '/recipes' + suffix]];
  await mkdir(output, { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1050 });
    for (const [name, route] of routes) {
      await page.goto(base + route);
      await page.getByRole('heading', { level: 1 }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => document.querySelectorAll('main [role=status][aria-label="Carregando workspace"]').length === 0);
      if (name === 'knowledge') await page.waitForFunction(() => [...document.querySelectorAll('main select option')].some(el => el.textContent === 'qwen3:4b'));
      const layout = await page.evaluate(() => {
        const visible = el => !!el.getBoundingClientRect().width && getComputedStyle(el).visibility !== 'hidden';
        const fields = [...document.querySelectorAll('main input:not([type="checkbox"], [type="radio"], [type="range"]),main select,main textarea')].filter(visible);
        const controls = [...document.querySelectorAll('main button,main select,main input')].filter(visible);
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyFont: parseFloat(getComputedStyle(document.body).fontSize), minField: fields.length ? Math.min(...fields.map(el => parseFloat(getComputedStyle(el).fontSize))) : null, minControl: controls.length ? Math.min(...controls.map(el => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height))) : null };
      });
      report.layouts.push({ page: name, ...layout });
      assert.ok(layout.scrollWidth <= width + 1, `${name} overflows at ${width}px`);
      assert.ok(layout.bodyFont >= 17 && (layout.minField === null || layout.minField >= 16), `${name} has small text`);
      assert.ok(layout.minControl === null || layout.minControl >= 24, `${name} has small controls`);
      if ([390, 1440].includes(width)) {
        const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        report.accessibility.push({ page: name, width, violations: audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(node => node.target) })) });
      }
      await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true, animations: 'disabled' });
    }
    console.log(`Workspace: 8 screens at ${width}px checked`);
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(base + '/workspace');
  await page.goto(base + '/projects');
  const disclosure = page.locator('.hub-create');
  const summary = disclosure.locator('summary').first();
  const signal = summary.locator('svg');
  const before = await signal.evaluate(el => getComputedStyle(el).transform);
  assert.equal(await disclosure.evaluate(el => el.open), false, 'Creation should start collapsed');
  await summary.focus(); await summary.press('Enter');
  await page.getByLabel('Nome do projeto', { exact: true }).waitFor();
  await page.waitForTimeout(250);
  assert.notEqual(await signal.evaluate(el => getComputedStyle(el).transform), before);
  await page.screenshot({ path: `${output}/project-create-expanded.png`, fullPage: true, animations: 'disabled' });
  const frames = await page.evaluate(() => new Promise(resolve => { const samples = []; let previous; function tick(now) { if (previous !== undefined) samples.push(now - previous); previous = now; if (samples.length < 120) requestAnimationFrame(tick); else resolve(samples); } requestAnimationFrame(tick); }));
  frames.sort((a, b) => a - b);
  report.motion = { samples: frames.length, medianMs: frames[60], p95Ms: frames[114], framesOver50Ms: frames.filter(ms => ms > 50).length };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.documentElement.dataset.reducedMotion === 'true');
  assert.equal(await signal.evaluate(el => el.getAnimations().filter(a => a.playState === 'running').length), 0);
  effects = false; await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.reload(); await summary.click();
  await page.waitForFunction(() => document.documentElement.dataset.reducedMotion === 'true');
  assert.equal(await signal.evaluate(el => el.getAnimations().filter(a => a.playState === 'running').length), 0);
  report.states.push('disclosure-keyboard', 'motion-normal', 'motion-os-reduced', 'motion-app-disabled');
  effects = true;
  await page.goto(base + '/projects');
  const card = page.locator('.project-card').first();
  await card.hover(); await page.waitForTimeout(250);
  assert.notEqual(await card.evaluate(el => getComputedStyle(el).transform), 'none');
  report.states.push('project-hover');
  await page.getByRole('button', { name: 'Abrir comandos rápidos' }).click();
  await page.getByRole('dialog', { name: 'Ir para' }).waitFor();
  await page.screenshot({ path: `${output}/commands-open.png`, fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Escape');
  const focused = await page.getByRole('button', { name: 'Abrir comandos rápidos' }).evaluate(el => document.activeElement === el);
  assert.ok(focused, 'Dialog should restore focus'); report.states.push('commands-focus-restored');
  await page.route('**/api/search?**', route => route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Serviço temporariamente indisponível. Tente novamente.', details: {} } } }));
  await page.goto(base + '/search?q=backup'); await page.getByRole('main').getByRole('alert').waitFor();
  await page.screenshot({ path: `${output}/search-error.png`, fullPage: true }); report.states.push('search-error');
  await page.route('**/api/search?**', route => route.fulfill({ json: { items: [], total: 0, offset: 0, limit: 20 } }));
  await page.reload(); await page.getByRole('heading', { name: 'Nenhum trecho encontrado' }).waitFor();
  await page.screenshot({ path: `${output}/search-empty.png`, fullPage: true }); report.states.push('search-empty');
  let release; const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/search?**', async route => { await pending; await route.fulfill({ json: { items: [], total: 0, offset: 0, limit: 20 } }); });
  await page.reload(); await page.getByRole('status', { name: 'Carregando workspace' }).waitFor();
  await page.screenshot({ path: `${output}/search-loading.png`, fullPage: true }); release(); report.states.push('search-loading');
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  assert.ok(report.accessibility.every(audit => audit.violations.length === 0), 'Accessibility violations: inspect report.json');
  assert.equal(report.errors.length, 0, 'Runtime errors: ' + report.errors.join('; '));
  console.log(JSON.stringify({ layouts: report.layouts.length, audits: report.accessibility.length, states: report.states, motion: report.motion }));
} finally { await browser.close(); }
