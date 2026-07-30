/**
 * Headless smoke test: boots the built game in Chromium, joins a match and
 * screenshots it. Requires the server to be running on :8080.
 *   npm run build && npm start &
 *   SHOT_DIR=/tmp node scripts/smoke.mjs
 */
import { chromium } from 'playwright';
const dir = process.env.SHOT_DIR ?? '.';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });

async function player(name, team, keys) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  const errors = [];
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
  await page.fill('#name-input', name);
  await page.fill('#room-input', 'duo');
  await page.selectOption('#team-select', team);
  await page.click('#play-button');
  return { page, errors, name };
}

const a = await player('Rulo', '0');
await a.page.waitForTimeout(1500);
const b = await player('Zurdo', '1');
await b.page.waitForTimeout(3000);

// Both press keys: A chases with sprint, B passes.
await a.page.keyboard.down('d'); await a.page.keyboard.down('Shift');
await b.page.keyboard.down('a');
await a.page.waitForTimeout(2500);
await a.page.keyboard.press('j');
await b.page.keyboard.press('k');
await a.page.waitForTimeout(2500);
await a.page.screenshot({ path: dir + '/m1-rulo.png' });
await b.page.screenshot({ path: dir + '/m2-zurdo.png' });

// Do both clients agree on where everyone is? Compare radar-independent state.
const readState = (p) => p.evaluate(() => ({
  ping: document.getElementById('ping').textContent,
  you: document.getElementById('you').textContent,
  score: document.getElementById('home-score').textContent + '-' + document.getElementById('away-score').textContent,
  clock: document.getElementById('clock').textContent,
}));
console.log('rulo :', await readState(a.page));
console.log('zurdo:', await readState(b.page));
console.log('errors:', [...a.errors, ...b.errors].slice(0, 10));

// Disconnect one and make sure the other keeps running (bot takes the shirt).
await a.page.close();
await b.page.waitForTimeout(2500);
await b.page.screenshot({ path: dir + '/m3-after-leave.png' });
console.log('zurdo after leave:', await readState(b.page));
await browser.close();
