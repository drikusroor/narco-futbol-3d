/**
 * Headless smoke test: boots the built game in Chromium, joins a match and
 * screenshots it. Requires the server to be running on :8080.
 *   npm run build && npm start &
 *   SHOT_DIR=/tmp node scripts/smoke.mjs
 */
import { chromium } from 'playwright';
const dir = process.env.SHOT_DIR ?? '.';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
await page.screenshot({ path: dir + '/01-menu.png' });
await page.fill('#name-input', 'Tester');
await page.fill('#room-input', 'test');
await page.click('#play-button');
await page.waitForTimeout(4000);
await page.screenshot({ path: dir + '/02-game.png' });
// hold a sprint + move to check controls
await page.keyboard.down('w');
await page.keyboard.down('Shift');
await page.waitForTimeout(1500);
await page.keyboard.up('w');
await page.keyboard.up('Shift');
await page.screenshot({ path: dir + '/03-moving.png' });
await page.waitForTimeout(6000);
await page.screenshot({ path: dir + '/04-later.png' });
console.log('errors:', errors.slice(0, 12));
await browser.close();
