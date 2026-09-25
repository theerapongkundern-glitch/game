import { chromium } from 'playwright-core';
// Usage: node scripts/autotest.mjs <baseUrl> <track> <difficulty> <laps> <fast>
const [base, track, diff, laps, fast] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${base}?autotest=quick&track=${track}&difficulty=${diff}&laps=${laps}&fast=${fast}&quality=low`);
const t0 = Date.now();
let res = null;
while (Date.now() - t0 < 300000) {
  await page.waitForTimeout(2000);
  res = await page.evaluate(() => window.__autotest);
  if (res && res.done) break;
}
console.log(JSON.stringify({ track, done: res?.done ?? false, secs: ((Date.now() - t0) / 1000).toFixed(0), results: res?.results?.map((r) => `${r.place}:${r.name}(${r.car}) ${r.time.toFixed(1)}${r.finished ? '' : '*'}`) }));
const screen = await page.evaluate(() => document.querySelector('.screen h1')?.textContent ?? null);
console.log('screen:', screen, 'errors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
