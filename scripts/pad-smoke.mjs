/**
 * Drive the whole game with a gamepad and nothing else: pick a name, walk the
 * menu, kick off, run about, open and close the settings. The pad is a fake
 * one injected in place of navigator.getGamepads, which is as close to holding
 * a real controller as a headless browser gets.
 *
 *   npm run build && npm start &
 *   SHOT_DIR=/tmp node scripts/pad-smoke.mjs
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

await page.addInitScript(() => {
  window.__pad = {
    index: 0,
    connected: true,
    id: 'Fake Pad (STANDARD GAMEPAD Vendor: 045e Product: 02fd)',
    mapping: 'standard',
    timestamp: 0,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })),
    axes: [0, 0, 0, 0],
  };
  navigator.getGamepads = () => [window.__pad];
});

const hold = (i) =>
  page.evaluate((n) => {
    window.__pad.buttons[n] = { pressed: true, value: 1, touched: true };
  }, i);
const release = (i) =>
  page.evaluate((n) => {
    window.__pad.buttons[n] = { pressed: false, value: 0, touched: false };
  }, i);
const stick = (x, y) =>
  page.evaluate(([sx, sy]) => {
    window.__pad.axes = [sx, sy, 0, 0];
  }, [x, y]);
/** A button, held long enough for a frame to notice and then let go. */
async function tap(i) {
  await hold(i);
  await page.waitForTimeout(120);
  await release(i);
  await page.waitForTimeout(120);
}
const focused = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el ? el.id || el.className || el.tagName : 'none';
  });

await page.goto('http://localhost:8080/', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// Typing a name has to keep working even though half those letters are bound
// to something on the pitch, spaces included.
await page.click('#name-input');
await page.keyboard.type('Wanda Sosa');
console.log('typed name:', JSON.stringify(await page.inputValue('#name-input')));

const first = await focused();
// D-pad down twice, then check the focus really walked the plate.
await tap(13);
const second = await focused();
await tap(13);
const third = await focused();
console.log('focus walk:', [first, second, third].join(' -> '));

// Left and right change a dropdown without ever touching the keyboard.
await page.evaluate(() => document.getElementById('size-select').focus());
const sizeBefore = await page.inputValue('#size-select');
await tap(15);
const sizeAfter = await page.inputValue('#size-select');
console.log(`squad size ${sizeBefore} -> ${sizeAfter}`);

// Start opens the settings, B backs out again.
await tap(9);
const settingsOpen = await page.evaluate(
  () => !document.getElementById('settings').classList.contains('hidden'),
);
const padLine = await page.textContent('#pad-status');
await page.screenshot({ path: `${dir}/pad-settings.png` });
await tap(1);
const settingsClosed = await page.evaluate(() =>
  document.getElementById('settings').classList.contains('hidden'),
);
console.log('settings open/closed by pad:', settingsOpen, settingsClosed);
console.log('pad line:', padLine);
await page.screenshot({ path: `${dir}/pad-menu.png` });

// Walk to PLAY and press A.
await page.evaluate(() => document.getElementById('play-button').focus());
await tap(0);
await page.waitForTimeout(5000);
const inGame = await page.evaluate(
  () => !document.getElementById('hud').classList.contains('hidden'),
);
console.log('kicked off with A:', inGame);

// Push the stick and hold sprint. Nothing burns the AIR meter except actually
// running, so the meter is proof the stick reached the simulation.
const air = () => page.evaluate(() => document.getElementById('stamina-bar').style.right);
const airBefore = await air();
await stick(0.2, -0.95);
await hold(5); // RB, sprint
await page.waitForTimeout(2500);
await stick(0, 0);
await release(5);
await page.waitForTimeout(400);
await page.screenshot({ path: `${dir}/pad-game.png` });
console.log(`playing as ${await page.textContent('#you-text')}`);
console.log(`AIR ${airBefore || '0%'} -> ${await air()} after a sprint on the stick`);

// Say something, and check the face turned up beside it.
await page.keyboard.press('t');
await page.keyboard.type('vamos');
await page.keyboard.press('Enter');
await page.waitForTimeout(900);
const chatFace = await page.evaluate(() => {
  const img = document.querySelector('#chatlog img');
  return img ? `${img.src.slice(0, 24)}… ${img.naturalWidth}px` : 'no face';
});
console.log('chat line:', (await page.textContent('#chatlog')) || '(empty)', '/', chatFace);
await page.screenshot({ path: `${dir}/pad-chat.png` });

console.log('errors:', errors.slice(0, 10));
await browser.close();
