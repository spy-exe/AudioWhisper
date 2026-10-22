import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const output = 'test-results/visual';
const browser = await chromium.launch();
const errors = [];
const checks = [];
const audits = [];
const states = [];
const expectedConsoleErrors = [];
let testingFailure = false;
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (testingFailure && /503/.test(message.text())) expectedConsoleErrors.push(message.text());
    else errors.push(message.text());
  });
  await mkdir(output, { recursive: true });
  const hash = createHash('sha256').update(await readFile(new URL('../tests/e2e/fixtures/meeting.wav', import.meta.url))).digest('hex');
  const response = await page.request.get(baseURL + '/api/library?q=meeting.wav&status=completed&limit=50');
  assert.ok(response.ok(), 'The local API must be available');
  const library = await response.json();
  const safeItems = [];
  let editor;
  for (const item of library.items) {
    const media = await (await page.request.get(baseURL + '/api/media/' + item.job.media_file_id)).json();
    if (media.sha256 !== hash) continue;
    safeItems.push(item);
    const documents = await (await page.request.get(baseURL + '/api/jobs/' + item.job.id + '/documents')).json();
    if (!editor && documents.some(document => ['generated', 'reviewed'].includes(document.status))) editor = item.job.id;
  }
  assert.ok(editor, 'Run the Studio E2E fixture first: a completed synthetic meeting with a document is required');
  // Only synthetic fixture records may appear in documentation screenshots.
  await page.route('**/api/library?**', route => route.fulfill({ json: { items: safeItems.slice(0, 5), total: safeItems.length, offset: 0, limit: 5 } }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1050 });
    for (const [name, url] of [['studio', '/'], ['library', '/library'], ['settings', '/settings'], ['workspace', '/jobs/' + editor]]) {
      await page.goto(baseURL + url);
      await page.getByRole('heading', { level: 1 }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      if (name === 'settings') await page.locator('select.select-field').first().waitFor();
      if (name === 'workspace') await page.locator('.document-preview').waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('main [style*="opacity"]')].every(el => Number(getComputedStyle(el).opacity) >= 0.99));
      const layout = await page.evaluate(() => {
        const visible = el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
        const fields = [...document.querySelectorAll('main input, main select, main textarea')].filter(visible);
        const controls = [...document.querySelectorAll('main button, main select, main input')].filter(visible);
        return {
          width: innerWidth, scroll: document.documentElement.scrollWidth,
          bodyFont: parseFloat(getComputedStyle(document.body).fontSize),
          smallestField: Math.min(...fields.map(el => parseFloat(getComputedStyle(el).fontSize))),
          smallestControl: Math.min(...controls.map(el => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height))),
          transcriptFont: document.querySelector('.transcript-editor textarea') ? parseFloat(getComputedStyle(document.querySelector('.transcript-editor textarea')).fontSize) : null,
          overflow: [...document.querySelectorAll('main *')].filter(visible).filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(el => ({ tag: el.tagName, class: el.className })),
        };
      });
      checks.push({ page: name, ...layout });
      assert.ok(layout.scroll <= width + 1, `${name} overflows at ${width}px: ${JSON.stringify(layout.overflow)}`);
      assert.ok(layout.bodyFont >= 17 && layout.smallestField >= 14, `${name} has undersized text at ${width}px`);
      assert.ok(layout.smallestControl >= 24, `${name} has undersized controls at ${width}px`);
      if (name === 'workspace') assert.ok(layout.transcriptFont >= 19, 'Transcript must remain comfortably readable');
      if (name === 'workspace' && [390, 1440].includes(width)) {
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        audits.push({ page: name, width, violations: result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })) });
      }
      await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true, animations: 'disabled' });
      console.log(`${name} ${width}px: body ${layout.bodyFont}px, fields ${layout.smallestField}px, overflow ${layout.scroll > width + 1}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  testingFailure = true;
  await page.route('**/api/library?**', route => route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Serviço indisponível', details: {} } } }));
  await page.goto(baseURL + '/library');
  await page.getByRole('alert').filter({ hasText: 'Não foi possível carregar a biblioteca' }).waitFor();
  await page.screenshot({ path: `${output}/library-error.png`, fullPage: true, animations: 'disabled' });
  states.push('library-error');
  testingFailure = false;
  await page.route('**/api/library?**', route => route.fulfill({ json: { items: [], total: 0, offset: 0, limit: 5 } }));
  await page.goto(baseURL + '/library?q=sem-correspondencia');
  await page.getByText('Nenhuma gravação encontrada').waitFor();
  await page.screenshot({ path: `${output}/library-empty.png`, fullPage: true, animations: 'disabled' });
  states.push('library-empty');
  let resume;
  const pending = new Promise(resolve => { resume = resolve; });
  await page.route('**/api/library?**', async route => {
    await pending;
    await route.fulfill({ json: { items: safeItems.slice(0, 5), total: safeItems.length, offset: 0, limit: 5 } });
  });
  await page.goto(baseURL + '/library');
  await page.getByRole('status', { name: 'Carregando biblioteca' }).waitFor();
  await page.screenshot({ path: `${output}/library-loading.png`, fullPage: true, animations: 'disabled' });
  states.push('library-loading');
  resume();
  await page.getByRole('status', { name: 'Carregando biblioteca' }).waitFor({ state: 'hidden' });
  // Measure real rendered frames with ambient motion enabled on this workstation.
  await page.route('**/api/settings', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), visual_effects_enabled: true } });
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(baseURL);
  await page.getByRole('button', { name: 'Iniciar captura' }).waitFor();
  const frames = await page.evaluate(() => new Promise(resolve => {
    const samples = []; let previous;
    function tick(now) { if (previous !== undefined) samples.push(now - previous); previous = now; if (samples.length < 120) requestAnimationFrame(tick); else resolve(samples); }
    requestAnimationFrame(tick);
  }));
  frames.sort((a, b) => a - b);
  const motion = { samples: frames.length, medianMs: frames[60], p95Ms: frames[114], framesOver50Ms: frames.filter(ms => ms > 50).length };
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(baseURL + '/jobs/' + editor);
  const preview = page.getByRole('region', { name: 'Prévia do documento', exact: true });
  await preview.waitFor(); await preview.focus();
  assert.ok(await preview.evaluate(el => document.activeElement === el), 'Document preview must be reachable by keyboard');
  const region = await preview.evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight }));
  if (region.content > region.height) {
    await preview.press('PageDown');
    await page.waitForFunction(() => document.querySelector('[aria-label="Prévia do documento"]').scrollTop > 0);
    states.push('document-preview-keyboard-scroll');
  }
  states.push('document-preview-keyboard-focus');
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, states, audits, motion, errors, expectedConsoleErrors }, null, 2));
  console.log(JSON.stringify({ motion, errors, audits }));
  assert.equal(errors.length, 0, `Browser errors: ${errors.join('; ')}`);
  assert.ok(audits.every(audit => audit.violations.length === 0), 'Workspace accessibility violations detected');
} finally { await browser.close(); }
