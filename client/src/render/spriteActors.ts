import * as THREE from 'three';
import type { Build } from './actors.js';
import {
  bakeAtlas,
  kitOf,
  type AtlasManifest,
  type BakedAtlas,
  type BakeOptions,
  type Kit,
} from './sprites.js';

/**
 * Drawing players from the baked sheets: one camera-facing quad each, all the
 * players in a kit in a single instanced draw.
 *
 * Two numbers do all the work per player. The column is the angle between the
 * way they are facing and the way the camera is looking - turn on the spot and
 * you flick through the sixteen views. The row is the frame of the animation,
 * paired with whichever baked elevation is closest to how steeply the camera is
 * looking down at them.
 *
 * The quad's height is the part worth explaining. A sheet baked looking down at
 * angle E squashes a standing figure to cos(E) of its height, so a quad of that
 * height would draw a squashed player. Undo it by making the quad taller by the
 * same factor - `worldSize / cos(E)` - and the figure comes out the right size
 * on screen from any angle the camera actually takes.
 */

const MAX_PLAYERS = 32;

const VERT = /* glsl */ `
attribute vec2 aTile;
uniform vec2 uTileScale;
varying vec2 vUv;
void main() {
  vUv = uv * uTileScale + aTile;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

// The sheet was tone-mapped when it was baked, so this must not tone-map again
// - but the texture is sRGB and comes back decoded to linear, so it does have
// to be encoded on the way out, which is what the colorspace include does.
const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  // Rendered against nothing, so the edge pixels arrive premultiplied.
  if (c.a < 0.35) discard;
  gl_FragColor = vec4(c.rgb / c.a, 1.0);
  #include <colorspace_fragment>
}
`;

interface KitDraw {
  atlas: BakedAtlas;
  mesh: THREE.InstancedMesh;
  tiles: THREE.InstancedBufferAttribute;
  used: number;
}

export class SpriteActors {
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private kits = new Map<string, KitDraw>();
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private pos = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  private bakeOptions: BakeOptions;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, bakeOptions: BakeOptions = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.bakeOptions = bakeOptions;
  }

  /** Bake every kit that is on the pitch. Costs about a frame, once. */
  prepare(entries: { team: number; role: number }[]): void {
    for (const e of entries) this.kitDraw(kitOf(e.team, e.role));
  }

  get manifest(): AtlasManifest | null {
    return this.kits.values().next().value?.atlas.manifest ?? null;
  }

  private kitDraw(kit: Kit): KitDraw {
    const found = this.kits.get(kit.key);
    if (found) return found;

    const atlas = bakeAtlas(this.renderer, kit, this.bakeOptions);
    // A unit quad centred on its own middle; the instance matrix does the rest.
    const geometry = new THREE.PlaneGeometry(1, 1);
    const tiles = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PLAYERS * 2), 2);
    tiles.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aTile', tiles);

    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uMap: { value: atlas.texture },
        uTileScale: {
          value: new THREE.Vector2(
            1 / atlas.manifest.columns,
            1 / (atlas.manifest.totalFrames * atlas.manifest.elevations.length),
          ),
        },
      },
      // Half the facings are drawn on a quad turned inside out.
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, MAX_PLAYERS);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.scene.add(mesh);

    const draw: KitDraw = { atlas, mesh, tiles, used: 0 };
    this.kits.set(kit.key, draw);
    return draw;
  }

  /** Start a frame; every player who wants a sprite must be added again. */
  begin(): void {
    for (const draw of this.kits.values()) draw.used = 0;
  }

  /**
   * Place one player. `frame` comes from `frameFor`, `camera` is where the shot
   * is being taken from - both of those decide which tile gets drawn.
   */
  add(
    team: number,
    role: number,
    x: number,
    z: number,
    facing: number,
    frame: number,
    build: Build,
    camera: THREE.Camera,
  ): void {
    const draw = this.kitDraw(kitOf(team, role));
    if (draw.used >= MAX_PLAYERS) return;
    const m = draw.atlas.manifest;

    const dx = camera.position.x - x;
    const dz = camera.position.z - z;
    const camYaw = Math.atan2(dx, dz);
    const flat = Math.hypot(dx, dz);
    const pitch = Math.atan2(camera.position.y - m.centreY, Math.max(0.001, flat));

    // Nearest baked row for how steeply we are looking down at them.
    let elev = 0;
    for (let i = 1; i < m.elevations.length; i++) {
      if (Math.abs(m.elevations[i] - pitch) < Math.abs(m.elevations[elev] - pitch)) elev = i;
    }

    const step = (Math.PI * 2) / m.azimuths;
    const rel = facing - camYaw;
    const heading = ((Math.round(rel / step) % m.azimuths) + m.azimuths) % m.azimuths;
    // Past half a turn we run out of baked columns and flip the quad instead.
    const mirror = heading >= m.columns;
    const col = mirror ? m.azimuths - heading : heading;
    const row = frame * m.elevations.length + elev;

    const i = draw.used++;
    draw.tiles.setXY(i, col / m.columns, 1 - (row + 1) / (m.totalFrames * m.elevations.length));

    this.pos.set(x, m.centreY * build.y, z);
    this.quat.setFromAxisAngle(this.up, camYaw);
    this.scale.set(
      m.worldSize * build.xz * (mirror ? -1 : 1),
      (m.worldSize / Math.cos(m.elevations[elev])) * build.y,
      1,
    );
    this.matrix.compose(this.pos, this.quat, this.scale);
    draw.mesh.setMatrixAt(i, this.matrix);
  }

  /** Bytes of texture the baked sheets are holding, for anyone counting. */
  get bytes(): number {
    let total = 0;
    for (const draw of this.kits.values()) {
      total += draw.atlas.manifest.width * draw.atlas.manifest.height * 4;
    }
    return total;
  }

  /** Hand the frame's placements to the GPU. */
  end(): void {
    for (const draw of this.kits.values()) {
      draw.mesh.count = draw.used;
      draw.mesh.instanceMatrix.needsUpdate = true;
      draw.tiles.needsUpdate = true;
    }
  }
}
