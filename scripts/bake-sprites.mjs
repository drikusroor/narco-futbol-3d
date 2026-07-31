/**
 * Bake the player model into sprite sheets and write them out as PNGs.
 *
 * This is the offline half of the workflow: the game bakes the same sheets into
 * a texture at run time, so nothing here ships. What it is for is looking at
 * the sheets, keeping a reference copy in docs/sprites, and seeing what changes
 * when the model does.
 *
 *   node scripts/bake-sprites.mjs [outDir]
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = process.argv[2] ?? `${root}docs/sprites`;
const port = 5179;

const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});
const stop = () => vite.kill('SIGTERM');
process.on('exit', stop);

async function waitForServer(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // still starting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite never came up on ${url}`);
}

await waitForServer(`http://localhost:${port}/bake.html`);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(`http://localhost:${port}/bake.html`);
await page.waitForFunction(() => '__bake' in window, null, { timeout: 120000 });
const payload = await page.evaluate(() => window.__bake);

await mkdir(outDir, { recursive: true });
for (const sheet of payload.sheets) {
  const bytes = Buffer.from(sheet.png.split(',')[1], 'base64');
  await writeFile(`${outDir}/${sheet.key}.png`, bytes);
  console.log(`${sheet.key}.png  ${sheet.width}x${sheet.height}  ${(bytes.length / 1024).toFixed(0)} KB`);
}
await writeFile(
  `${outDir}/manifest.json`,
  `${JSON.stringify({ manifest: payload.manifest, clips: payload.clips }, null, 2)}\n`,
);

const m = payload.manifest;
console.log(
  `\n${m.azimuths} facings x ${m.elevations.length} camera elevations x ${m.totalFrames} frames,` +
    ` mirrored down to ${m.columns * m.elevations.length * m.totalFrames} tiles of ${m.tile}px per kit`,
);
const real = errors.filter((e) => !e.includes('favicon') && !e.includes('404'));
if (real.length) console.log('errors:', real.slice(0, 8));

await browser.close();
stop();
