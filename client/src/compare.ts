import * as THREE from 'three';
import { PlayerAct, Role } from '@shared/types.js';
import { buildFor, makePlayerRig, poseRig, type PlayerRig } from './render/actors.js';
import { SpriteActors } from './render/spriteActors.js';
import { frameFor } from './render/sprites.js';

/**
 * A ruler for the sprite sheets: the same players drawn twice, models on the
 * back row and sprites on the front, turning through a full circle. If the two
 * rows disagree - wrong facing, mirrored the wrong way, standing at the wrong
 * height - it shows up immediately.
 *
 * Not part of the game. `node scripts/compare-sprites.mjs` shoots it.
 */

const COUNT = 8;
const SPACING = 2.4;

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(1280, 460, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2f4030);
const sun = new THREE.DirectionalLight(0xffe6bc, 2.4);
sun.position.set(-52, 62, 40);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xffe3c0, 0x3c5a2a, 1.35));
scene.add(new THREE.AmbientLight(0xffd9b8, 0.28));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshLambertMaterial({ color: 0x3f7a3a }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(46, 1280 / 460, 0.5, 400);
const centre = ((COUNT - 1) * SPACING) / 2;
camera.position.set(centre, 6.5, 14);
camera.lookAt(centre, 1.1, 0);

/** Paint the right limbs so a mirrored or misfacing sprite is obvious. */
function mark(rig: PlayerRig): void {
  rig.armR.material = new THREE.MeshLambertMaterial({ color: 0x2f6fff });
  rig.legR.material = new THREE.MeshLambertMaterial({ color: 0xffffff });
}

const sprites = new SpriteActors(scene, renderer, { decorate: mark });
const rigs: PlayerRig[] = [];
for (let i = 0; i < COUNT; i++) {
  const rig = makePlayerRig(0, Role.Midfielder, { build: buildFor(i) });
  rig.shadow.visible = false;
  mark(rig);
  scene.add(rig.group);
  rigs.push(rig);
}

// The model has no face, so an upright idle pose cannot tell you whether a
// sprite is facing the right way. The kick can: it is a right-footed swing.
const query = new URLSearchParams(location.search);
const show = query.get('show') ?? 'both';
const wanted = query.get('act') ?? 'kick';
const act =
  wanted === 'run' ? PlayerAct.Run : wanted === 'idle' ? PlayerAct.Idle : PlayerAct.Kick;
const actTimer = act === PlayerAct.Kick ? 0.11 : 0;

function draw(): void {
  sprites.begin();
  const m = sprites.manifest;
  for (let i = 0; i < COUNT; i++) {
    const facing = (i / COUNT) * Math.PI * 2;
    const speed = act === PlayerAct.Idle ? 0 : 7.4;
    // Model and sprite shoulder to shoulder at the same facing, so any
    // disagreement is between neighbours rather than across the picture.
    // Both rows stand in exactly the same places, so shooting the page twice -
    // once as models, once as sprites - gives two images to flick between.
    const x = i * SPACING;
    poseRig(rigs[i], x, 0, facing, speed, act, actTimer, 1 / 60, 0, false);
    rigs[i].body.visible = show !== 'sprite';
    if (m && show !== 'rig') {
      const frame = frameFor(m, act, actTimer, speed, rigs[i].stride);
      sprites.add(0, Role.Midfielder, x, 0, facing, frame, rigs[i].build, camera);
    }
  }
  sprites.end();
  renderer.render(scene, camera);
}

window.addEventListener('load', () => {
  sprites.prepare([{ team: 0, role: Role.Midfielder }]);
  draw();
  draw();
  (window as unknown as { __ready: boolean }).__ready = true;
});
