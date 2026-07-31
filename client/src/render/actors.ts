import * as THREE from 'three';
import { BALL_RADIUS, PLAYER_HEIGHT, PLAYER_RADIUS, TEAM_INFO } from '@shared/constants.js';
import { PlayerAct, POWERUP_INFO, PowerupType, Role } from '@shared/types.js';
import { ballTexture, blobTexture } from './textures.js';

/**
 * Players are built from primitives on purpose: legible from the broadcast
 * camera, cheap to draw, and cheap to pre-render into sprite sheets.
 *
 * The rig is two layers. `group` is where the player stands and which way they
 * face; `body` is everything made of flesh, and takes all the tilting, diving
 * and sliding. Keeping them apart means the shadow and the selection ring never
 * have to be un-tilted afterwards, and it means the sprite baker can point a
 * camera at `body` on its own.
 */
export interface PlayerRig {
  group: THREE.Group;
  body: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Mesh;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  ring: THREE.Mesh;
  shadow: THREE.Mesh;
  aura: THREE.Mesh;
  /** Accumulated stride phase, so legs move with distance travelled. */
  stride: number;
  team: number;
  role: number;
  build: Build;
}

/**
 * A body shape, as a scale on the width and the height of the whole figure.
 *
 * Deliberately only a scale: a non-uniform scale of a Y-rotated model projects
 * to exactly the same non-uniform scale on screen at every angle, so one baked
 * sprite sheet covers every build simply by stretching the quad it is drawn on.
 * A variant that changed the geometry - a bigger head, a different haircut -
 * would need a sheet of its own.
 */
export interface Build {
  xz: number;
  y: number;
}

export const BUILDS: Record<string, Build> = {
  regular: { xz: 1, y: 1 },
  tall: { xz: 0.94, y: 1.1 },
  short: { xz: 1.05, y: 0.9 },
  chunky: { xz: 1.2, y: 0.97 },
  skinny: { xz: 0.85, y: 1.04 },
};

const BUILD_LIST = Object.values(BUILDS);

/** The same shirt always gets the same body, on every screen in the room. */
export function buildFor(id: number): Build {
  const h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return BUILD_LIST[h % BUILD_LIST.length];
}

const shadowMat = () =>
  new THREE.MeshBasicMaterial({
    map: blobTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.85,
  });

export function makePlayerRig(
  team: number,
  role: number,
  opts: { keeperColour?: number; build?: Build } = {},
): PlayerRig {
  const info = TEAM_INFO[team] ?? TEAM_INFO[0];
  const keeperColour = opts.keeperColour ?? 0xf2c744;
  const build = opts.build ?? BUILDS.regular;
  const shirt = role === Role.Keeper ? keeperColour : info.primary;
  const shorts = role === Role.Keeper ? 0x22201c : info.secondary;

  const group = new THREE.Group();
  const body = new THREE.Group();
  body.scale.set(build.xz, build.y, build.xz);
  group.add(body);

  const skinMat = new THREE.MeshLambertMaterial({ color: 0xc98d5f });
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const shortsMat = new THREE.MeshLambertMaterial({ color: shorts });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER_RADIUS * 0.62, 0.62, 4, 10), shirtMat);
  torso.position.y = 1.15;
  torso.castShadow = true;
  body.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skinMat);
  head.position.y = PLAYER_HEIGHT - 0.16;
  head.castShadow = true;
  body.add(head);

  // A shock of dark hair so heads are not featureless balls.
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshLambertMaterial({ color: 0x241a14 }),
  );
  hair.position.y = PLAYER_HEIGHT - 0.11;
  body.add(hair);

  const legGeo = new THREE.CapsuleGeometry(0.14, 0.5, 3, 8);
  const legL = new THREE.Mesh(legGeo, shortsMat);
  legL.position.set(-0.17, 0.5, 0);
  legL.castShadow = true;
  body.add(legL);
  const legR = new THREE.Mesh(legGeo, shortsMat);
  legR.position.set(0.17, 0.5, 0);
  legR.castShadow = true;
  body.add(legR);

  const armGeo = new THREE.CapsuleGeometry(0.1, 0.44, 3, 8);
  const armL = new THREE.Mesh(armGeo, skinMat);
  armL.position.set(-0.46, 1.2, 0);
  body.add(armL);
  const armR = new THREE.Mesh(armGeo, skinMat);
  armR.position.set(0.46, 1.2, 0);
  body.add(armR);

  // Selection ring under whoever you are controlling.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(PLAYER_RADIUS + 0.16, PLAYER_RADIUS + 0.34, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  group.add(ring);

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), shadowMat());
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  // Power-up glow, recoloured when one is picked up.
  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 14, 10),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  );
  aura.position.y = 1.0;
  aura.visible = false;
  group.add(aura);

  return {
    group,
    body,
    torso,
    head,
    legL,
    legR,
    armL,
    armR,
    ring,
    shadow,
    aura,
    stride: 0,
    team,
    role,
    build,
  };
}

/** Everything a pose needs, with no clock of its own so it can be baked. */
export interface Pose {
  speed: number;
  act: PlayerAct;
  actTimer: number;
  /** Stride phase in radians; the leg swing is a sine of this. */
  phase: number;
  /** Seconds, only used by the celebration bounce. */
  time: number;
}

/** Pose a player from its simulation state. */
export function poseRig(
  rig: PlayerRig,
  x: number,
  z: number,
  facing: number,
  speed: number,
  act: PlayerAct,
  actTimer: number,
  dt: number,
  powerup: PowerupType,
  controlled: boolean,
): void {
  const g = rig.group;
  g.position.x = x;
  g.position.z = z;
  g.rotation.y = facing;

  rig.stride += speed * dt * 1.9;
  applyPose(rig, { speed, act, actTimer, phase: rig.stride, time: performance.now() / 1000 });

  rig.ring.visible = controlled;

  if (powerup) {
    const info = POWERUP_INFO[powerup];
    rig.aura.visible = true;
    (rig.aura.material as THREE.MeshBasicMaterial).color.setHex(info?.color ?? 0xffffff);
    const pulse = 0.14 + Math.sin(performance.now() / 140) * 0.06;
    (rig.aura.material as THREE.MeshBasicMaterial).opacity = pulse;
  } else {
    rig.aura.visible = false;
  }
}

/**
 * The pose itself, on the body alone. Split out from `poseRig` so the sprite
 * baker can ask for frame 3 of the run cycle without inventing a clock - which
 * is what keeps a baked sheet showing exactly the poses the 3D rig shows.
 */
export function applyPose(rig: PlayerRig, p: Pose): void {
  const { speed, act, actTimer } = p;
  const g = rig.body;
  const swing = Math.sin(p.phase) * Math.min(0.85, 0.18 + speed * 0.07);
  const lift = Math.max(0, Math.sin(p.phase)) * Math.min(0.16, speed * 0.014);

  // Default upright stance.
  g.position.y = 0;
  g.rotation.x = 0;
  g.rotation.z = 0;
  rig.torso.rotation.x = Math.min(0.32, speed * 0.03);
  rig.legL.rotation.x = swing;
  rig.legR.rotation.x = -swing;
  rig.legL.position.y = 0.5 + (swing > 0 ? lift : 0);
  rig.legR.position.y = 0.5 + (swing < 0 ? lift : 0);
  rig.armL.rotation.x = -swing * 0.7;
  rig.armR.rotation.x = swing * 0.7;
  rig.armL.rotation.z = 0.12;
  rig.armR.rotation.z = -0.12;
  rig.torso.position.y = 1.15;
  rig.head.position.y = PLAYER_HEIGHT - 0.16;

  switch (act) {
    case PlayerAct.Kick: {
      // Plant and swing through.
      const t = 1 - Math.max(0, Math.min(1, actTimer / 0.22));
      const kick = Math.sin(t * Math.PI) * 1.5;
      rig.legR.rotation.x = -kick;
      rig.legL.rotation.x = kick * 0.25;
      rig.armL.rotation.x = kick * 0.5;
      rig.torso.rotation.x = -0.12 + kick * 0.12;
      break;
    }
    case PlayerAct.Slide: {
      g.rotation.x = -1.15;
      g.position.y = 0.15;
      rig.legR.rotation.x = -0.9;
      rig.legL.rotation.x = 0.5;
      rig.armL.rotation.z = 0.9;
      rig.armR.rotation.z = -0.9;
      break;
    }
    case PlayerAct.Dive: {
      g.rotation.z = 1.25;
      g.position.y = 0.55;
      rig.armL.rotation.x = -1.4;
      rig.armR.rotation.x = -1.4;
      break;
    }
    case PlayerAct.Stunned: {
      g.rotation.x = -1.35;
      g.position.y = 0.12;
      break;
    }
    case PlayerAct.Tackle: {
      rig.torso.rotation.x = 0.42;
      rig.armR.rotation.x = -0.9;
      break;
    }
    case PlayerAct.Celebrate: {
      g.position.y = Math.abs(Math.sin(p.time * 5)) * 0.42;
      rig.armL.rotation.x = -2.5;
      rig.armR.rotation.x = -2.5;
      rig.armL.rotation.z = 0.5;
      rig.armR.rotation.z = -0.5;
      break;
    }
    default:
      break;
  }

  rig.shadow.scale.setScalar(1 - Math.min(0.4, g.position.y * 0.35));
}

/** The ball, its shadow, and a trail that shows up when it is really moving. */
export function makeBall(): { group: THREE.Group; mesh: THREE.Mesh; shadow: THREE.Mesh } {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 20, 14),
    new THREE.MeshLambertMaterial({ map: ballTexture() }),
  );
  mesh.castShadow = true;
  group.add(mesh);

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), shadowMat());
  shadow.rotation.x = -Math.PI / 2;
  group.add(shadow);
  return { group, mesh, shadow };
}

/** The man in black, complete with whistle flash. */
export function makeReferee(): { group: THREE.Group; rig: PlayerRig } {
  const rig = makePlayerRig(0, Role.Midfielder, { keeperColour: 0x14120f });
  (rig.torso.material as THREE.MeshLambertMaterial).color.setHex(0x18181a);
  (rig.legL.material as THREE.MeshLambertMaterial).color.setHex(0x18181a);
  rig.ring.visible = false;
  const group = new THREE.Group();
  group.add(rig.group);
  return { group, rig };
}

/** Floating crate of contraband. */
export function makePowerup(): THREE.Group {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.62),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.6,
      roughness: 0.3,
      metalness: 0.2,
    }),
  );
  core.castShadow = true;
  group.add(core);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.07, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
  );
  halo.rotation.x = Math.PI / 2;
  group.add(halo);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.9, 3, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  beam.position.y = -1;
  group.add(beam);

  group.userData.core = core;
  group.userData.halo = halo;
  group.userData.beam = beam;
  return group;
}

export function tintPowerup(group: THREE.Group, type: PowerupType): void {
  const info = POWERUP_INFO[type];
  const colour = info?.color ?? 0xffffff;
  const core = group.userData.core as THREE.Mesh;
  const halo = group.userData.halo as THREE.Mesh;
  const beam = group.userData.beam as THREE.Mesh;
  (core.material as THREE.MeshStandardMaterial).color.setHex(colour);
  (core.material as THREE.MeshStandardMaterial).emissive.setHex(colour);
  (halo.material as THREE.MeshBasicMaterial).color.setHex(colour);
  (beam.material as THREE.MeshBasicMaterial).color.setHex(colour);
}
