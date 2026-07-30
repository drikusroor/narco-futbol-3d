import * as THREE from 'three';
import {
  BOX_HALF_WIDTH,
  BOX_LENGTH,
  CENTER_CIRCLE_RADIUS,
  GOAL_HALF_WIDTH,
  HALF_LENGTH,
  HALF_WIDTH,
  PITCH_LENGTH,
  PITCH_WIDTH,
} from '@shared/constants.js';

/**
 * Everything the game draws is generated at runtime - no image files, no
 * loading screens, and the whole build stays a couple of hundred kilobytes.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, alpha: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    d[i + 3] = Math.min(255, d[i + 3] * alpha + 255 * (1 - alpha));
  }
  ctx.putImageData(img, 0, 0);
}

/** The pitch: mown stripes, worn patches and every line the referee cares about. */
export function pitchTexture(): THREE.Texture {
  const PX = 24; // pixels per metre
  const w = Math.round(PITCH_LENGTH * PX);
  const h = Math.round(PITCH_WIDTH * PX);
  const [c, ctx] = canvas(w, h);

  // Base grass with vertical mow stripes.
  const stripes = 14;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? '#3f7a34' : '#376d2d';
    ctx.fillRect((i * w) / stripes, 0, w / stripes + 1, h);
  }

  // Worn areas in front of the goals and down the middle.
  const worn = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, h * 0.55);
  worn.addColorStop(0, 'rgba(120, 96, 52, 0.16)');
  worn.addColorStop(1, 'rgba(120, 96, 52, 0)');
  ctx.fillStyle = worn;
  ctx.fillRect(0, 0, w, h);
  for (const gx of [0.06, 0.94]) {
    const g = ctx.createRadialGradient(w * gx, h / 2, 0, w * gx, h / 2, h * 0.3);
    g.addColorStop(0, 'rgba(126, 98, 48, 0.35)');
    g.addColorStop(1, 'rgba(126, 98, 48, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // Markings. World (x, z) -> texture (px, py).
  const toX = (x: number) => (x + HALF_LENGTH) * PX;
  const toY = (z: number) => (z + HALF_WIDTH) * PX;
  ctx.strokeStyle = 'rgba(240, 245, 235, 0.82)';
  ctx.lineWidth = 0.22 * PX;
  ctx.lineCap = 'butt';

  const inset = 0.35;
  ctx.strokeRect(
    toX(-HALF_LENGTH + inset),
    toY(-HALF_WIDTH + inset),
    (PITCH_LENGTH - inset * 2) * PX,
    (PITCH_WIDTH - inset * 2) * PX,
  );

  ctx.beginPath();
  ctx.moveTo(toX(0), toY(-HALF_WIDTH + inset));
  ctx.lineTo(toX(0), toY(HALF_WIDTH - inset));
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(toX(0), toY(0), CENTER_CIRCLE_RADIUS * PX, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(240, 245, 235, 0.9)';
  ctx.beginPath();
  ctx.arc(toX(0), toY(0), 0.22 * PX, 0, Math.PI * 2);
  ctx.fill();

  for (const sign of [-1, 1]) {
    // Penalty area.
    const bx = sign > 0 ? toX(HALF_LENGTH - BOX_LENGTH) : toX(-HALF_LENGTH);
    ctx.strokeRect(bx, toY(-BOX_HALF_WIDTH), BOX_LENGTH * PX, BOX_HALF_WIDTH * 2 * PX);
    // Six yard box.
    const sx = sign > 0 ? toX(HALF_LENGTH - BOX_LENGTH * 0.38) : toX(-HALF_LENGTH);
    ctx.strokeRect(
      sx,
      toY(-GOAL_HALF_WIDTH - 2.5),
      BOX_LENGTH * 0.38 * PX,
      (GOAL_HALF_WIDTH + 2.5) * 2 * PX,
    );
    // Penalty spot and D.
    const spot = sign * (HALF_LENGTH - BOX_LENGTH * 0.62);
    ctx.beginPath();
    ctx.arc(toX(spot), toY(0), 0.2 * PX, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(
      toX(spot),
      toY(0),
      7 * PX,
      sign > 0 ? Math.PI * 0.62 : -Math.PI * 0.38,
      sign > 0 ? Math.PI * 1.38 : Math.PI * 0.38,
    );
    ctx.stroke();
    // Corner arcs.
    for (const zs of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(toX(sign * (HALF_LENGTH - inset)), toY(zs * (HALF_WIDTH - inset)), 1 * PX, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  noise(ctx, w, h, 26, 1);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A scuffed old ball: white panels, dark pentagons, a bit of pitch on it. */
export function ballTexture(): THREE.Texture {
  const [c, ctx] = canvas(256, 128);
  ctx.fillStyle = '#f2efe4';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#1d1a17';
  const spots: [number, number, number][] = [
    [32, 30, 15],
    [96, 22, 13],
    [160, 34, 15],
    [224, 26, 12],
    [64, 78, 16],
    [128, 92, 14],
    [196, 80, 15],
    [12, 96, 11],
  ];
  for (const [x, y, r] of spots) {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r * 0.9;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(110, 90, 40, 0.25)';
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 128, Math.random() * 5 + 1, 0, Math.PI * 2);
    ctx.fill();
  }
  noise(ctx, 256, 128, 18, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Perimeter hoardings. Every sponsor is invented; any resemblance is a joke. */
export function adBoardTexture(): THREE.Texture {
  const [c, ctx] = canvas(2048, 128);
  const ads: [string, string, string][] = [
    ['RON EL CÓNDOR', '#2a1410', '#ffd34d'],
    ['CAFÉ LA PERLA', '#f2e4c8', '#8a2318'],
    ['AEROTAXI SANTA MARÍA', '#12324a', '#79d0ff'],
    ['CASINO TROPICAL', '#3c0f2a', '#ff7ac0'],
    ['TV MUNDIAL 88', '#0f2a17', '#8ef0a0'],
    ['MOTOS BRAVO', '#e8543a', '#fff3d0'],
    ['DISCOTECA LA CUMBIA', '#1b1442', '#ffd34d'],
    ['SEGUROS DEL VALLE', '#f4f0e6', '#1d4a2a'],
  ];
  const each = 2048 / ads.length;
  ads.forEach(([text, bg, fg], i) => {
    ctx.fillStyle = bg;
    ctx.fillRect(i * each, 0, each, 128);
    ctx.fillStyle = fg;
    ctx.font = 'italic 900 46px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, i * each + each / 2, 68, each - 24);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(i * each, 118, each, 10);
  });
  noise(ctx, 2048, 128, 22, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** Soft round shadow blob used under everyone. */
export function blobTexture(): THREE.Texture {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Goal netting: a fine grid with an alpha channel. */
export function netTexture(): THREE.Texture {
  const [c, ctx] = canvas(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= 128; i += 10) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 128);
    ctx.moveTo(0, i);
    ctx.lineTo(128, i);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** A banner for the stands - hand painted ultra flags. */
export function bannerTexture(text: string, bg: string, fg: string): THREE.Texture {
  const [c, ctx] = canvas(512, 128);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 496, 112);
  ctx.fillStyle = fg;
  ctx.font = 'italic 900 58px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68, 460);
  noise(ctx, 512, 128, 30, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
