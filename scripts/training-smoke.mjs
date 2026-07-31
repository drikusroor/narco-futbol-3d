/**
 * Headless walk through the new front-end screens: settings (language, volume,
 * a rebind), the drill picker, two drills, the in-game controls panel and the
 * tutorial. Requires the built game to be running on :8080.
 *   npm run build && npm start &
 *   SHOT_DIR=/tmp node scripts/training-smoke.mjs
 */
import { chromium } from 'playwright';

const dir = process.env.SHOT_DIR ?? '.';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const out = {};
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });

// --- settings: language switch and a rebind ---------------------------------
await page.click('#settings-button');
await page.waitForTimeout(300);
await page.screenshot({ path: dir + '/10-settings-en.png' });
await page.click('#lang-row .chip:nth-child(2)');
await page.waitForTimeout(200);
await page.screenshot({ path: dir + '/11-settings-es.png' });
out.menuPlay = await page.textContent('#play-button');

// Rebind sprint (5th row) to Ctrl, check it stuck, then restore the defaults.
await page.click('#bind-table .bind-row:nth-child(5) .bind-key:nth-child(2)');
await page.waitForTimeout(150);
await page.keyboard.press('Control');
await page.waitForTimeout(200);
out.rebound = await page.textContent('#bind-table .bind-row:nth-child(5) .bind-key:nth-child(2)');
out.storedBinds = JSON.parse(await page.evaluate(() => localStorage.getItem('nf.binds'))).sprint;
await page.click('#settings-reset');
out.afterReset = await page.textContent('#bind-table .bind-row:nth-child(5) .bind-key:nth-child(2)');
await page.click('#settings-close');
await page.waitForTimeout(200);

// --- a drill ----------------------------------------------------------------
await page.fill('#name-input', 'Tester');
await page.click('#training-button');
await page.waitForTimeout(300);
await page.screenshot({ path: dir + '/12-drills.png' });
await page.click('#drill-list .drill-card:nth-child(3)'); // dribbling
await page.waitForTimeout(5000);
await page.screenshot({ path: dir + '/13-dribble.png' });
out.drillTitle = await page.textContent('#drill-title');
out.drillStats = (await page.textContent('#drill-stats'))?.trim();

// Run at the first gate with the ball.
await page.keyboard.down('d');
await page.waitForTimeout(2600);
await page.keyboard.up('d');
await page.waitForTimeout(400);
await page.screenshot({ path: dir + '/14-dribble-run.png' });
out.statsAfter = (await page.textContent('#drill-stats'))?.trim();

// The controls panel, then out through the settings screen.
await page.keyboard.press('h');
await page.waitForTimeout(300);
await page.screenshot({ path: dir + '/15-help.png' });
out.helpRows = await page.evaluate(() => document.querySelectorAll('#help-list .bind-row').length);
await page.keyboard.press('h');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
out.leaveVisible = await page.isVisible('#settings-leave');
await page.click('#settings-leave');
await page.waitForTimeout(500);
out.backAtMenu = await page.isVisible('#menu-main');

// --- tutorial ---------------------------------------------------------------
await page.click('#tutorial-button');
await page.waitForTimeout(4500);
await page.screenshot({ path: dir + '/16-tutorial.png' });
out.firstTask = await page.textContent('#tutorial-task');
await page.keyboard.down('d');
await page.waitForTimeout(2200);
await page.keyboard.up('d');
await page.waitForTimeout(400);
out.secondTask = await page.textContent('#tutorial-task');
await page.keyboard.down('d');
await page.keyboard.down('Shift');
await page.waitForTimeout(1800);
await page.keyboard.up('Shift');
await page.keyboard.up('d');
await page.waitForTimeout(400);
out.thirdTask = await page.textContent('#tutorial-task');
await page.screenshot({ path: dir + '/17-tutorial-3.png' });

out.errors = errors.slice(0, 12);
console.log(JSON.stringify(out, null, 2));
await browser.close();
