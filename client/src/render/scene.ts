import * as THREE from 'three';
import { HALF_LENGTH, HALF_WIDTH } from '@shared/constants.js';
import { clamp, damp } from '@shared/math.js';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize(): void;
}

/** A warm dusk gradient, painted once into a cube-friendly backdrop. */
function sunsetSky(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#1d2a52');
  g.addColorStop(0.42, '#7a4a6a');
  g.addColorStop(0.68, '#d97a3c');
  g.addColorStop(0.86, '#f2b45a');
  g.addColorStop(1, '#5a3320');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

/** Renderer, sunset lighting and haze. */
export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = sunsetSky();
  // Haze sits far enough back that it colours the hills, not the pitch.
  scene.fog = new THREE.Fog(0x8a5a3a, 150, 330);

  // Late afternoon: low warm key light, cool bounce from the sky.
  const sun = new THREE.DirectionalLight(0xffe6bc, 2.5);
  sun.position.set(-52, 62, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -HALF_LENGTH - 12;
  sun.shadow.camera.right = HALF_LENGTH + 12;
  sun.shadow.camera.top = HALF_WIDTH + 12;
  sun.shadow.camera.bottom = -HALF_WIDTH - 12;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0012;
  scene.add(sun);
  scene.add(sun.target);

  scene.add(new THREE.HemisphereLight(0xffe3c0, 0x3c5a2a, 1.35));
  scene.add(new THREE.AmbientLight(0xffd9b8, 0.28));

  // A hint of floodlight from each corner, unshadowed and cheap.
  for (const [x, z] of [
    [-HALF_LENGTH - 10, -HALF_WIDTH - 10],
    [HALF_LENGTH + 10, HALF_WIDTH + 10],
  ] as const) {
    const spill = new THREE.PointLight(0xfff0cc, 280, 170, 2);
    spill.position.set(x, 26, z);
    scene.add(spill);
  }

  const camera = new THREE.PerspectiveCamera(46, 1, 0.5, 600);
  camera.position.set(0, 24, 34);

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, resize };
}

/**
 * Broadcast camera: sits on one touchline, tracks the play, and pulls back when
 * the ball is flying. The whole view flips for the away side so you are always
 * attacking to the right of the screen.
 */
export class BroadcastCamera {
  private lookAt = new THREE.Vector3();
  private pos = new THREE.Vector3(0, 34, 46);
  /** +1 for the home side, -1 when playing as the away side. */
  flip = 1;
  height = 26;
  distance = 35;

  constructor(private camera: THREE.PerspectiveCamera) {}

  update(
    ballX: number,
    ballZ: number,
    ballY: number,
    focusX: number,
    focusZ: number,
    speed: number,
    dt: number,
    shake: number,
  ): void {
    // Follow a point between the ball and the player you are controlling.
    const targetX = clamp(ballX * 0.72 + focusX * 0.28, -HALF_LENGTH + 6, HALF_LENGTH - 6);
    const targetZ = clamp(ballZ * 0.5 + focusZ * 0.5, -HALF_WIDTH + 4, HALF_WIDTH - 4);

    // Pull back and up when the ball is moving fast or is in the air.
    const zoom = clamp(speed / 30, 0, 1);
    const dist = this.distance + zoom * 7 + clamp(ballY * 0.8, 0, 7);
    const height = this.height + zoom * 4 + clamp(ballY * 0.55, 0, 5);

    const wantX = targetX * 0.85;
    const wantZ = targetZ * 0.35 + this.flip * dist;
    const k = damp(3.4, dt);
    this.pos.x += (wantX - this.pos.x) * k;
    this.pos.y += (height - this.pos.y) * damp(2.2, dt);
    this.pos.z += (wantZ - this.pos.z) * k;

    this.lookAt.x += (targetX - this.lookAt.x) * k;
    this.lookAt.y += (clamp(ballY * 0.4, 0, 4) - this.lookAt.y) * k;
    this.lookAt.z += (targetZ * 0.8 - this.lookAt.z) * k;

    const jolt = shake * 0.9;
    this.camera.position.set(
      this.pos.x + (Math.random() - 0.5) * jolt,
      this.pos.y + (Math.random() - 0.5) * jolt,
      this.pos.z + (Math.random() - 0.5) * jolt,
    );
    this.camera.lookAt(this.lookAt);
    // Keep the horizon level but let the flip roll the view around.
    this.camera.up.set(0, 1, 0);
  }

  /** Snap straight to the target - used when the match restarts. */
  reset(x: number, z: number): void {
    this.pos.set(x * 0.85, this.height, z * 0.35 + this.flip * this.distance);
    this.lookAt.set(x, 0, z * 0.8);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.lookAt);
  }
}
