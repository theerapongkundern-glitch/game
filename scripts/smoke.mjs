#!/usr/bin/env node
/**
 * End-to-end smoke test: builds nothing itself — run `npm run build` first.
 * Serves ./dist with `vite preview`, drives the game in headless Chromium and checks:
 *  - the main menu loads without console errors
 *  - every mode completes via the autotest hook (AI drives the player, fast-forwarded)
 *  - touch controls appear on a phone-sized touch viewport
 *  - draw-call / triangle budgets on High quality
 *
 * Usage: npm run build && npm run smoke            (set CHROME_PATH to use a specific Chromium)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.SMOKE_PORT || 4179);
const BASE = `http://localhost:${PORT}/`;
const OUT = process.env.SHOT_DIR || 'screenshots';
mkdirSync(OUT, { recursive: true });

const candidates = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('vite preview did not start')), 30000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('Local')) {
      clearTimeout(t);
      resolve();
    }
  });
});

const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

let failures = 0;
const log = (ok, name, info = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘'} ${name}${info ? ' — ' + info : ''}`);
};

async function withPage(opts, fn) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  try {
    return await fn(page, errors);
  } finally {
    await ctx.close();
  }
}

async function waitAutotest(page, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => window.__autotest);
    if (r && r.done) return r;
  }
  return null;
}

try {
  // 1. Main menu.
  await withPage({ viewport: { width: 1280, height: 720 } }, async (page, errors) => {
    await page.goto(BASE + '?quality=low&mute');
    await page.waitForSelector('.main-menu', { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/menu.png` });
    const buttons = await page.$$eval('.menu-btn', (b) => b.length);
    log(buttons === 6 && errors.length === 0, 'main menu', `${buttons} modes, ${errors.length} errors ${errors.join(' | ')}`);
  });

  // 2. Every mode, driven by the AI.
  const runs = [
    ['quick', 'coconut-coast'],
    ['quick', 'pinecrest-ridge'],
    ['quick', 'neon-nightway'],
    ['quick', 'sunstone-canyon'],
    ['timetrial', 'pinecrest-ridge'],
    ['elimination', 'coconut-coast'],
    ['rush', 'sunstone-canyon'],
    ['split', 'neon-nightway'],
    ['grandprix', 'coconut-coast'],
  ];
  for (const [mode, track] of runs) {
    await withPage({ viewport: { width: 480, height: 270 } }, async (page, errors) => {
      await page.goto(`${BASE}?autotest=${mode}&track=${track}&laps=1&difficulty=normal&fast=10&quality=low&mute`);
      const r = await waitAutotest(page, mode === 'grandprix' ? 900000 : 400000);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/${mode}-${track}.png` });
      const title = await page.evaluate(() => document.querySelector('.screen h1')?.textContent ?? '');
      const ok = !!r && errors.length === 0 && title.length > 0 && (mode !== 'grandprix' || r.races === 4);
      log(ok, `${mode} @ ${track}`, `${title}${r ? `; races ${r.races}` : '; timed out'}${errors.length ? '; errors: ' + errors.join(' | ') : ''}`);
    });
  }

  // 3. Touch controls on a phone-sized touch screen.
  await withPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }, async (page, errors) => {
    await page.goto(`${BASE}?autotest=quick&laps=1&quality=low&mute`);
    await page.waitForTimeout(8000);
    const visible = await page.evaluate(() => {
      const t = document.querySelector('.touch-controls');
      return !!t && !t.classList.contains('hidden');
    });
    await page.screenshot({ path: `${OUT}/mobile.png` });
    log(visible && errors.length === 0, 'touch controls on mobile');
  });

  // 4. Rendering budget on High.
  await withPage({ viewport: { width: 1280, height: 720 } }, async (page, errors) => {
    await page.goto(`${BASE}?autotest=quick&track=coconut-coast&laps=3&quality=high&mute`);
    await page.waitForTimeout(12000);
    const info = await page.evaluate(() => {
      const g = window.__game;
      const i = g.renderer.gl.info.render;
      return { calls: i.calls, tris: i.triangles };
    });
    await page.screenshot({ path: `${OUT}/high.png` });
    log(info.calls < 260 && info.tris < 700000 && errors.length === 0, 'render budget (High)', `${info.calls} draw calls, ${(info.tris / 1000).toFixed(0)}k triangles`);
  });
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
