/**
 * Shoot the rig-versus-sprite comparison page. Back row is the 3D model, front
 * row the pre-rendered sheet, both turning through a full circle.
 *   node scripts/compare-sprites.mjs [outFile]
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.argv[2] ?? `${root}docs/sprites/compare.png`;
const port = 5178;

const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});
process.on('exit', () => vite.kill('SIGTERM'));

for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(`http://localhost:${port}/compare.html`)).ok) break;
  } catch {
    // still starting
  }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 460 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
// The two rows stand in the same places, so these are two frames of a flicker
// test: anything that moves between them is the sheet disagreeing with the model.
for (const show of ['rig', 'sprite']) {
  await page.goto(`http://localhost:${port}/compare.html?show=${show}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => '__ready' in window, null, { timeout: 120000 });
  const file = out.replace(/\.png$/, `-${show}.png`);
  await page.screenshot({ path: file });
  console.log('wrote', file);
}
await browser.close();
vite.kill('SIGTERM');
