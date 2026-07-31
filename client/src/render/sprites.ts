import * as THREE from 'three';
import { PlayerAct, Role } from '@shared/types.js';
import { RUN_SPEED } from '@shared/constants.js';
import { BUILDS, applyPose, makePlayerRig, type PlayerRig } from './actors.js';

/**
 * Pre-rendered players, the way Age of Empires II and Diablo II did it: point a
 * camera at the 3D model, turn it a step at a time, and keep the pictures.
 *
 * The two games could get away with one camera angle because theirs never
 * moved. Ours cranes in and out and flips ends, so the sheet gains a second
 * axis - the angle the camera looks *down* at the player - and the billboard
 * picks a row from that. Three rows covers everything from a corner-flag long
 * shot to standing over someone, with the seam between rows visible only if you
 * go looking for it.
 *
 * What comes out is one texture per kit, laid out as
 *
 *     column = which way the player is facing, relative to the camera
 *     row    = animation frame, and within that, camera elevation
 *
 * so a draw is a UV offset and nothing else.
 */

/** One animation, and how many stills it is chopped into. */
export interface Clip {
  name: string;
  frames: number;
  /** The pose for frame `i` of `frames`. */
  pose(i: number, frames: number): { speed: number; act: PlayerAct; actTimer: number; phase: number; time: number };
}

const still = (act: PlayerAct, extra: Partial<ReturnType<Clip['pose']>> = {}) => ({
  speed: 0,
  act,
  actTimer: 0,
  phase: 0,
  time: 0,
  ...extra,
});

export const CLIPS: Clip[] = [
  { name: 'idle', frames: 1, pose: () => still(PlayerAct.Idle) },
  {
    name: 'run',
    frames: 8,
    pose: (i, n) => still(PlayerAct.Run, { speed: RUN_SPEED, phase: (i / n) * Math.PI * 2 }),
  },
  {
    name: 'kick',
    frames: 4,
    // The kick timer counts down, so frame 0 is the wind-up.
    pose: (i, n) => still(PlayerAct.Kick, { actTimer: 0.22 * (1 - i / (n - 1)) }),
  },
  { name: 'tackle', frames: 1, pose: () => still(PlayerAct.Tackle) },
  { name: 'slide', frames: 1, pose: () => still(PlayerAct.Slide, { speed: RUN_SPEED }) },
  { name: 'dive', frames: 1, pose: () => still(PlayerAct.Dive) },
  { name: 'stunned', frames: 1, pose: () => still(PlayerAct.Stunned) },
  {
    name: 'celebrate',
    frames: 2,
    pose: (i) => still(PlayerAct.Celebrate, { time: i === 0 ? 0.31 : 0 }),
  },
];

/** How the sheet was baked; everything the renderer needs to read it back. */
export interface AtlasManifest {
  tile: number;
  /** Facings the sheet stands for, all the way round. */
  azimuths: number;
  /** Facings actually baked: half a turn, the rest are mirrored at draw time. */
  columns: number;
  /** Camera pitch of each row block, in radians. */
  elevations: number[];
  /** Clip name to its first frame's index in the frame sequence. */
  clips: Record<string, { row: number; frames: number }>;
  totalFrames: number;
  width: number;
  height: number;
  /** Metres across the square the camera framed. */
  worldSize: number;
  /** Height the camera aimed at, which is where the quad's centre goes. */
  centreY: number;
}

export interface BakeOptions {
  tile?: number;
  azimuths?: number;
  elevations?: number[];
  worldSize?: number;
  centreY?: number;
  /**
   * Bake half a turn and mirror the rest, which halves the sheet. The cost is
   * that a pose which is not left-right symmetric comes out handed the wrong
   * way round for the mirrored facings - the kick swaps feet. Set it false to
   * bake every facing and pay double for the sheet.
   */
  mirrored?: boolean;
  /**
   * Last look at the rig before it is baked. The comparison harness uses it to
   * paint one arm and one leg a different colour, which is the only way to tell
   * by eye whether a sprite is facing the way it should - the model has no face.
   */
  decorate?: (rig: PlayerRig) => void;
}

/** A kit worth its own sheet: the shirt is baked in, so each one is a bake. */
export interface Kit {
  key: string;
  team: number;
  role: number;
}

export function kitOf(team: number, role: number): Kit {
  return role === Role.Keeper
    ? { key: 'keeper', team: 0, role: Role.Keeper }
    : { key: `team${team}`, team, role: Role.Midfielder };
}

export interface BakedAtlas {
  kit: string;
  texture: THREE.Texture;
  target: THREE.WebGLRenderTarget;
  manifest: AtlasManifest;
}

const DEFAULTS = {
  tile: 64,
  azimuths: 16,
  // Roughly the range the broadcast camera looks down at a player from: a long
  // shot across the pitch, the usual middle distance, and right underneath.
  elevations: [20, 34, 50],
  // A square box big enough for the widest pose, which is the goalkeeper's dive.
  worldSize: 2.6,
  centreY: 1.15,
};

/**
 * Render one kit's sheet into a render target. Nothing is read back: the target
 * *is* the texture the game draws with, which is what makes baking on load
 * cheap enough to do for whichever kits happen to be playing.
 */
export function bakeAtlas(
  renderer: THREE.WebGLRenderer,
  kit: Kit,
  opts: BakeOptions = {},
): BakedAtlas {
  const tile = opts.tile ?? DEFAULTS.tile;
  const azimuths = opts.azimuths ?? DEFAULTS.azimuths;
  const elevations = (opts.elevations ?? DEFAULTS.elevations).map((d) => (d * Math.PI) / 180);
  const worldSize = opts.worldSize ?? DEFAULTS.worldSize;
  const centreY = opts.centreY ?? DEFAULTS.centreY;

  const clips: AtlasManifest['clips'] = {};
  let totalFrames = 0;
  for (const clip of CLIPS) {
    clips[clip.name] = { row: totalFrames, frames: clip.frames };
    totalFrames += clip.frames;
  }

  // By default only half a turn is drawn. Facing away to the left is facing
  // away to the right held up to a mirror, which is how Age of Empires got
  // sixteen headings out of nine renders - and why the key light below sits
  // square in front of the camera rather than off to one side, so a mirrored
  // frame is not lit from the wrong side.
  const columns = (opts.mirrored ?? true) ? azimuths / 2 + 1 : azimuths;
  const width = tile * columns;
  const height = tile * totalFrames * elevations.length;

  const target = new THREE.WebGLRenderTarget(width, height, {
    magFilter: THREE.LinearFilter,
    // No mipmaps: a smaller level would blend one frame into the next.
    minFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: true,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  // The rig is baked at the regular build; every other build is the same sheet
  // drawn on a stretched quad.
  const rig = makePlayerRig(kit.team, kit.role, { build: BUILDS.regular });
  opts.decorate?.(rig);
  const pivot = new THREE.Group();
  pivot.add(rig.body);
  scene.add(pivot);

  // Lighting is fixed relative to the camera rather than to the world. It has
  // to be: the sheet is indexed by the angle between player and camera, so a
  // world-fixed sun would have to be baked into that index too. Straight over
  // the camera's shoulder, so the left and right halves of a figure are lit the
  // same and a mirrored column is indistinguishable from a rendered one.
  const key = new THREE.DirectionalLight(0xffe6bc, 2.4);
  key.position.set(0, 3, 3.2);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xffe3c0, 0x3c5a2a, 1.3));
  scene.add(new THREE.AmbientLight(0xffd9b8, 0.3));

  const camera = new THREE.OrthographicCamera(
    -worldSize / 2,
    worldSize / 2,
    worldSize / 2,
    -worldSize / 2,
    0.1,
    40,
  );

  const oldTarget = renderer.getRenderTarget();
  const oldScissor = renderer.getScissorTest();
  const oldClear = renderer.getClearColor(new THREE.Color());
  const oldAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(target);
  renderer.setScissorTest(true);
  renderer.setClearColor(0x000000, 0);

  let frame = 0;
  for (const clip of CLIPS) {
    for (let f = 0; f < clip.frames; f++) {
      applyPose(rig, clip.pose(f, clip.frames));
      for (let e = 0; e < elevations.length; e++) {
        const elev = elevations[e];
        const dist = 10;
        camera.position.set(0, centreY + Math.sin(elev) * dist, Math.cos(elev) * dist);
        camera.lookAt(0, centreY, 0);
        const row = frame * elevations.length + e;
        for (let a = 0; a < columns; a++) {
          pivot.rotation.y = (a / azimuths) * Math.PI * 2;
          // Texture rows run bottom-up; row 0 is the top of the sheet.
          const y = height - (row + 1) * tile;
          renderer.setViewport(a * tile, y, tile, tile);
          renderer.setScissor(a * tile, y, tile, tile);
          renderer.render(scene, camera);
        }
      }
      frame++;
    }
  }

  renderer.setScissorTest(oldScissor);
  renderer.setRenderTarget(oldTarget);
  renderer.setClearColor(oldClear, oldAlpha);
  renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
  renderer.setScissor(0, 0, renderer.domElement.width, renderer.domElement.height);
  // Materials only; the shadow blob's texture is shared with the live rigs.
  disposeRig(rig.body);
  disposeRig(rig.group);

  return {
    kit: kit.key,
    texture: target.texture,
    target,
    manifest: {
      tile,
      azimuths,
      columns,
      elevations,
      clips,
      totalFrames,
      width,
      height,
      worldSize,
      centreY,
    },
  };
}

function disposeRig(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) for (const m of mat) m.dispose();
    else mat?.dispose();
  });
}

/** Which still to show for a player's current state. */
export function frameFor(
  manifest: AtlasManifest,
  act: PlayerAct,
  actTimer: number,
  speed: number,
  phase: number,
): number {
  const pick = (name: string, i = 0): number => (manifest.clips[name]?.row ?? 0) + i;
  switch (act) {
    case PlayerAct.Kick: {
      const clip = manifest.clips.kick;
      const t = 1 - Math.max(0, Math.min(1, actTimer / 0.22));
      return pick('kick', Math.min(clip.frames - 1, Math.floor(t * clip.frames)));
    }
    case PlayerAct.Slide:
      return pick('slide');
    case PlayerAct.Dive:
      return pick('dive');
    case PlayerAct.Stunned:
      return pick('stunned');
    case PlayerAct.Tackle:
      return pick('tackle');
    case PlayerAct.Celebrate:
      return pick('celebrate', Math.floor(performance.now() / 200) % manifest.clips.celebrate.frames);
    default:
      break;
  }
  if (speed < 0.6) return pick('idle');
  const run = manifest.clips.run;
  const at = Math.floor((phase / (Math.PI * 2)) * run.frames) % run.frames;
  return pick('run', (at + run.frames) % run.frames);
}
