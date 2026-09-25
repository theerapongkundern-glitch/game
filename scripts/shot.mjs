import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || 'shot';
const wait = Number(process.argv[4] || 5000);
const keys = process.argv[5] || '';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.VW || 1280), height: Number(process.env.VH || 720) } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url);
await page.waitForTimeout(wait);
const dir = process.env.SHOT_DIR || 'screenshots';
mkdirSync(dir, { recursive: true });
await page.screenshot({ path: `${dir}/${out}-0.png` });
if (keys) {
  // keys format: "KeyW:3000,KeyA+KeyW:1500"
  let i = 1;
  for (const step of keys.split(',')) {
    const [k, ms] = step.split(':');
    const list = k.split('+');
    for (const key of list) await page.keyboard.down(key);
    await page.waitForTimeout(Number(ms));
    for (const key of list) await page.keyboard.up(key);
    await page.screenshot({ path: `${dir}/${out}-${i++}.png` });
  }
}
const dbg = await page.evaluate(() => document.querySelector('.debug-overlay')?.textContent ?? '');
console.log('DEBUG:', dbg);
console.log('FPS:', await page.evaluate(() => document.querySelector('.fps-counter')?.textContent));
console.log(errors.join('\n') || 'no console errors');
await browser.close();
