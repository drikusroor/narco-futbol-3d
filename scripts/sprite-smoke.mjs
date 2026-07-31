/**
 * Side-by-side of the same moment drawn three ways: models, sprites beyond the
 * halfway line, and sprites for everybody. Requires the server on :8080.
 *   npm run build && npm start &
 *   SHOT_DIR=/tmp node scripts/sprite-smoke.mjs
 */
import { chromium } from 'playwright';

const dir = process.env.SHOT_DIR ?? '.';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
await page.fill('#name-input', 'Sprites');
await page.fill('#room-input', 'sprite-test');
await page.click('#play-button');
await page.waitForTimeout(5000);

for (const mode of ['off', 'auto', 'all']) {
  await page.evaluate((m) => {
    localStorage.setItem('nf.art', m);
    document.querySelector(`#art-row .chip[data-art="${m}"]`)?.click();
  }, mode);
  // First switch pays for the bake.
  await page.waitForTimeout(mode === 'off' ? 1200 : 4000);
  await page.screenshot({ path: `${dir}/sprite-${mode}.png` });
  const on = await page.evaluate(
    () => document.querySelector('#art-row .chip.on')?.dataset.art ?? 'none',
  );
  console.log(`${mode} -> chip "${on}"`);
}

console.log('errors:', errors.slice(0, 10));
await browser.close();
