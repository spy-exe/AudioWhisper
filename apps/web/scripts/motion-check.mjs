import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { assertE2ETarget } from './e2e-target.mjs';

const base = await assertE2ETarget(process.env.E2E_BASE_URL);
const output = 'test-results/motion';
const browser = await chromium.launch();
const report = { interactions: [], errors: [] };

// Sample actual painted states during the interaction, including native pseudo-elements.
async function sample(page, target, trigger, pseudo = null) {
  return page.evaluate(({ target, trigger, pseudo }) => new Promise(resolve => {
    const node = document.querySelector(target);
    assertNode(node); assertNode(document.querySelector(trigger));
    const read = () => {
      const style = getComputedStyle(node, pseudo);
      const marker = node.querySelector('.side-tab-indicator')?.getBoundingClientRect();
      return { height: parseFloat(style.height), opacity: Number(style.opacity), transform: style.transform, markerX: marker?.x };
    };
    const states = [{ elapsed: 0, ...read() }];
    const started = performance.now();
    document.querySelector(trigger).click();
    function frame(now) {
      states.push({ elapsed: now - started, ...read() });
      if (now - started < 480) requestAnimationFrame(frame);
      else resolve(states);
    }
    function assertNode(value) { if (!value) throw new Error('Motion target is missing'); }
    requestAnimationFrame(frame);
  }), { target, trigger, pseudo });
}

function changingHeight(states, name) {
  const heights = states.map(state => state.height);
  const low = Math.min(...heights), high = Math.max(...heights);
  const intermediate = heights.filter(height => height > low + 2 && height < high - 2);
  assert.ok(high - low > 30 && new Set(intermediate.map(Math.round)).size >= 3, `${name} must interpolate its height`);
  return { name, samples: states.length, from: heights[0], to: heights.at(-1), intermediateFrames: intermediate.length };
}

try {
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  let effects = true;
  await page.route('**/api/settings', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), visual_effects_enabled: effects, vocabulary: '' } });
  });
  const projects = await (await page.request.get(base + '/api/projects?q=QA%20Workspace%20chromium&limit=100')).json();
  const hash = createHash('sha256').update(await readFile(new URL('../tests/e2e/fixtures/meeting.wav', import.meta.url))).digest('hex');
  let fixture;
  for (const project of projects.items.sort((a, b) => String(b.last_activity).localeCompare(String(a.last_activity)))) {
    const detail = await (await page.request.get(base + '/api/projects/' + encodeURIComponent(project.name))).json();
    if (!detail.recordings.items.length || detail.recordings.items.length !== detail.recording_count) continue;
    let safe = true;
    for (const item of detail.recordings.items) {
      const media = await (await page.request.get(base + '/api/media/' + item.job.media_file_id)).json();
      if (media.sha256 !== hash) safe = false;
    }
    if (safe) { fixture = detail; break; }
  }
  assert.ok(fixture, 'Run the workspace E2E first; synthetic media is required.');
  await page.route('**/api/projects?**', async route => {
    const url = new URL(route.request().url()); url.searchParams.set('q', fixture.name);
    const response = await route.fetch({ url: url.toString() }); await route.fulfill({ response });
  });
  await page.goto(base + '/projects');
  await page.waitForFunction(() => document.documentElement.dataset.reducedMotion === 'false');
  await page.getByRole('heading', { name: fixture.name, exact: true }).waitFor();
  const supported = await page.evaluate(() => CSS.supports('interpolate-size', 'allow-keywords') && CSS.supports('selector(details::details-content)'));
  assert.ok(supported, 'This visual check requires Chromium native details transitions');

  const opening = await sample(page, '.hub-create', '.hub-create > summary', '::details-content');
  report.interactions.push(changingHeight(opening, 'disclosure-open'));
  await page.getByLabel('Nome do projeto', { exact: true }).fill('Rascunho preservado');
  const closing = await sample(page, '.hub-create', '.hub-create > summary', '::details-content');
  report.interactions.push(changingHeight(closing, 'disclosure-close'));
  assert.equal(await page.getByLabel('Nome do projeto', { exact: true }).isVisible(), false);
  await page.locator('.hub-create > summary').click();
  assert.equal(await page.getByLabel('Nome do projeto', { exact: true }).inputValue(), 'Rascunho preservado');
  await page.getByLabel('Nome do projeto', { exact: true }).fill('');
  await page.locator('.hub-create > summary').click();

  await page.locator('.command-trigger').focus();
  const dialog = await sample(page, '.workspace-dialog', '.command-trigger');
  assert.ok(dialog.some(state => state.opacity > 0.02 && state.opacity < 0.98), 'Dialog should fade in through intermediate frames');
  assert.ok(dialog.some(state => state.transform !== 'none'), 'Dialog should approach smoothly');
  report.interactions.push({ name: 'dialog-open', samples: dialog.length, intermediateFrames: dialog.filter(state => state.opacity > 0.02 && state.opacity < 0.98).length });
  assert.ok(await page.getByLabel('Buscar comando').evaluate(el => el === document.activeElement));
  await page.screenshot({ path: `${output}/dialog-open.png`, fullPage: true, animations: 'disabled' });
  const dismissing = await sample(page, '.workspace-dialog', '.workspace-dialog button[aria-label="Fechar janela"]');
  assert.ok(dismissing.some(state => state.opacity > 0.02 && state.opacity < 0.98), 'Dialog should fade out');
  assert.equal(await page.getByRole('dialog', { name: 'Ir para' }).isVisible(), false);
  report.interactions.push({ name: 'dialog-close', samples: dismissing.length });
  assert.ok(await page.locator('.command-trigger').evaluate(el => el === document.activeElement), 'Focus must return to the trigger');

  // Record frame timing while repeatedly expanding/collapsing content, rather than while idle.
  const intervals = await page.evaluate(() => new Promise(resolve => {
    const frames = []; let previous; let count = 0;
    function tick(now) {
      if (previous !== undefined) frames.push(now - previous);
      previous = now;
      if (count++ % 24 === 0) document.querySelector('.hub-create > summary').click();
      if (frames.length < 120) requestAnimationFrame(tick); else resolve(frames);
    }
    requestAnimationFrame(tick);
  }));
  intervals.sort((a, b) => a - b);
  report.frameTiming = { samples: intervals.length, medianMs: intervals[60], p95Ms: intervals[114], framesOver50Ms: intervals.filter(ms => ms > 50).length };

  for (const mode of ['os-reduced', 'app-disabled']) {
    effects = mode !== 'app-disabled';
    await page.emulateMedia({ reducedMotion: mode === 'os-reduced' ? 'reduce' : 'no-preference' });
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.reducedMotion === 'true');
    const states = await sample(page, '.hub-create', '.hub-create > summary', '::details-content');
    const finalHeight = states.at(-1).height;
    assert.ok(finalHeight > 30);
    assert.ok(states.slice(1).every(state => Math.abs(state.height - finalHeight) < 1), `${mode} should reveal content immediately`);
    report.interactions.push({ name: mode, samples: states.length, immediate: true });
  }

  effects = true; await page.emulateMedia({ reducedMotion: 'no-preference' });
  const job = fixture.recordings.items.find(item => item.job.status === 'completed');
  assert.ok(job, 'A completed fixture is required');
  await page.goto(base + '/jobs/' + job.job.id);
  await page.getByRole('tab', { name: 'Documentos', exact: true }).waitFor();
  const tabFrames = await sample(page, '.side-tabs', '#tab-insights');
  assert.ok(new Set(tabFrames.map(frame => Math.round(frame.markerX))).size >= 3, 'The tab marker must move through intermediate positions');
  // The panel is mounted with an entrance animation; the shared marker settles over the active tab.
  const tab = page.getByRole('tab', { name: 'Revisão', exact: true });
  assert.equal(await tab.getAttribute('aria-selected'), 'true');
  const marker = await page.locator('.side-tab-indicator').boundingBox();
  const selected = await tab.boundingBox();
  assert.ok(Math.abs(marker.x - selected.x) < 2 && Math.abs(marker.width - selected.width) < 2, 'The sliding marker must align with the selected tab');
  await page.screenshot({ path: `${output}/editor-review.png`, fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 1050 });
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Review must fit a mobile screen');
  await page.screenshot({ path: `${output}/editor-review-mobile.png`, fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await tab.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: /Marcadores/ }).getAttribute('aria-selected'), 'true');
  report.interactions.push({ name: 'tabs-and-keyboard', samples: tabFrames.length, markerAligned: true });
  await page.screenshot({ path: `${output}/editor-markers.png`, fullPage: true, animations: 'disabled' });

  // Observe a real Next navigation, including the new template's painted entrance states.
  await page.evaluate(() => {
    const previous = document.querySelector('.page-transition');
    window.__routeMotion = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Route entrance was not observed')); }, 5000);
      const observer = new MutationObserver(() => {
        const node = document.querySelector('.page-transition');
        if (!node || node === previous) return;
        observer.disconnect(); clearTimeout(timeout);
        const states = []; const started = performance.now();
        function frame(now) {
          const style = getComputedStyle(node);
          states.push({ opacity: Number(style.opacity), transform: style.transform });
          if (now - started < 400) requestAnimationFrame(frame); else resolve(states);
        }
        requestAnimationFrame(frame);
      });
      observer.observe(document.querySelector('main'), { childList: true, subtree: true });
    });
  });
  await page.locator('.desktop-destinations a[href="/projects"]').click();
  const routeFrames = await page.evaluate(() => window.__routeMotion);
  assert.ok(routeFrames.some(frame => frame.opacity < 0.99 && frame.transform !== 'none'), 'Navigation should animate the new page into place');
  assert.ok(routeFrames.at(-1).opacity > 0.99 && routeFrames.at(-1).transform === 'none', 'Navigation must settle without a transformed containing block');
  report.interactions.push({ name: 'page-navigation', samples: routeFrames.length, settled: true });
  assert.equal(report.errors.length, 0, report.errors.join('; '));
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
