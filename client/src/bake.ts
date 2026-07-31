import * as THREE from 'three';
import { Role } from '@shared/types.js';
import { BUILDS, applyPose, makePlayerRig } from './render/actors.js';
import { CLIPS, bakeAtlas, type Kit } from './render/sprites.js';
import { PlayerAct } from '@shared/types.js';

/**
 * The offline half of the sprite workflow: bake every kit to a sheet, read the
 * pixels back and hand them to whoever asked (see scripts/bake-sprites.mjs).
 *
 * The game does not need this - it bakes into a render target on the fly and
 * never touches the CPU with it. This page exists so the sheets can be looked
 * at, checked into the repo as reference, and diffed when the model changes.
 */

const KITS: Kit[] = [
  { key: 'team0', team: 0, role: Role.Midfielder },
  { key: 'team1', team: 1, role: Role.Midfielder },
  { key: 'keeper', team: 0, role: Role.Keeper },
];

const canvas = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

/** Pull a render target back to the CPU, the right way up. */
function toCanvas(
  target: THREE.WebGLRenderTarget,
  width: number,
  height: number,
): HTMLCanvasElement {
  const buffer = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d')!;
  const image = ctx.createImageData(width, height);
  const stride = width * 4;
  // GL hands rows back bottom-up.
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * stride;
    image.data.set(buffer.subarray(from, from + stride), y * stride);
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

function toDataUrl(target: THREE.WebGLRenderTarget, width: number, height: number): string {
  return toCanvas(target, width, height).toDataURL('image/png');
}

interface Sheet {
  key: string;
  png: string;
  width: number;
  height: number;
}

/**
 * A line-up of the body variants, straight off the 3D rig. They are only ever
 * a scale of the same model, which is why they all read from one sheet - but
 * this is the picture to compare against when a variant stops being a scale.
 */
function buildsSheet(): Sheet {
  const names = Object.keys(BUILDS);
  const size = 176;
  const width = size * names.length;
  const target = new THREE.WebGLRenderTarget(width, size);
  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xffe6bc, 2.4);
  key.position.set(0, 3, 3.2);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xffe3c0, 0x3c5a2a, 1.3));
  scene.add(new THREE.AmbientLight(0xffd9b8, 0.3));

  const half = 1.35;
  const centreY = 1.05;
  const elev = 0.5;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 40);
  camera.position.set(0, centreY + Math.sin(elev) * 10, Math.cos(elev) * 10);
  camera.lookAt(0, centreY, 0);

  renderer.setRenderTarget(target);
  renderer.setScissorTest(true);
  renderer.setClearColor(0x6b6b6b, 1);
  names.forEach((name, i) => {
    const rig = makePlayerRig(i % 2, Role.Midfielder, { build: BUILDS[name] });
    applyPose(rig, { speed: 0, act: PlayerAct.Idle, actTimer: 0, phase: 0, time: 0 });
    scene.add(rig.body);
    renderer.setViewport(i * size, 0, size, size);
    renderer.setScissor(i * size, 0, size, size);
    renderer.render(scene, camera);
    scene.remove(rig.body);
  });
  renderer.setScissorTest(false);
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 0);

  const canvas = toCanvas(target, width, size);
  const ctx = canvas.getContext('2d')!;
  ctx.font = '13px monospace';
  ctx.fillStyle = '#ffd34d';
  ctx.textAlign = 'center';
  names.forEach((name, i) => {
    const b = BUILDS[name];
    ctx.fillText(name, i * size + size / 2, size - 20);
    ctx.fillText(`${b.xz} x ${b.y}`, i * size + size / 2, size - 6);
  });

  return { key: 'builds', png: canvas.toDataURL('image/png'), width, height: size };
}

/** Baking blocks the main thread, so let the page finish loading first. */
async function run(): Promise<void> {
  const status = document.getElementById('status')!;
  const sheets: Sheet[] = [];
  let manifest: unknown = null;

  for (const kit of KITS) {
    status.textContent = `baking ${kit.key}…`;
    await new Promise((r) => requestAnimationFrame(r));
    const atlas = bakeAtlas(renderer, kit);
    manifest ??= atlas.manifest;
    sheets.push({
      key: kit.key,
      png: toDataUrl(atlas.target, atlas.manifest.width, atlas.manifest.height),
      width: atlas.manifest.width,
      height: atlas.manifest.height,
    });
  }
  sheets.push(buildsSheet());

  (window as unknown as { __bake: unknown }).__bake = {
    manifest,
    clips: CLIPS.map((c) => ({ name: c.name, frames: c.frames })),
    sheets,
  };

  status.textContent = `baked ${sheets.length} sheets: ${sheets
    .map((s) => `${s.key} ${s.width}x${s.height}`)
    .join(', ')}`;
  for (const sheet of sheets) {
    const img = new Image();
    img.src = sheet.png;
    img.title = sheet.key;
    document.getElementById('sheets')!.appendChild(img);
  }
}

window.addEventListener('load', () => void run());
