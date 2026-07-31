/**
 * Renders the pitch line texture on its own and blows up one penalty area, so
 * the markings can be checked without squinting at a 3D screenshot. Needs the
 * Vite dev server (npm run dev:client) on :5173.
 *   SHOT_DIR=/tmp node scripts/pitch-lines.mjs
 */
import { chromium } from 'playwright';

const dir = process.env.SHOT_DIR ?? '.';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

await page.evaluate(async () => {
  const mod = await import('/src/render/textures.ts');
  const src = mod.pitchTexture().image;
  document.body.innerHTML = '';
  document.body.style.background = '#111';

  const view = document.createElement('canvas');
  view.width = 1180;
  view.height = 740;
  const ctx = view.getContext('2d');
  // Right-hand penalty area, magnified.
  const w = src.width;
  const h = src.height;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, w - 560, h / 2 - 460, 560, 920, 0, 0, 450, 740);
  // Whole pitch underneath for context.
  ctx.drawImage(src, 0, 0, w, h, 470, 140, 700, 455);
  document.body.appendChild(view);
});
await page.screenshot({ path: dir + '/20-pitch-lines.png' });
await browser.close();
