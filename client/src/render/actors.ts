import * as THREE from 'three';
import { BALL_RADIUS, PLAYER_HEIGHT, PLAYER_RADIUS, TEAM_INFO } from '@shared/constants.js';
import { PlayerAct, POWERUP_INFO, PowerupType, Role } from '@shared/types.js';
import { ballTexture, blobTexture } from './textures.js';

/**
 * Players are built from primitives on purpose: legible from the broadcast
 * camera, cheap to draw, and easy to swap for pre-rendered sprites later.
 */
export interface PlayerRig {
  group: THREE.Group;
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
}

const shadowMat = () =>
  new THREE.MeshBasicMaterial({
    map: blobTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.85,
  });

export function makePlayerRig(team: number, role: number, keeperColour = 0xf2c744): PlayerRig {
  const info = TEAM_INFO[team] ?? TEAM_INFO[0];
  const shirt = role === Role.Keeper ? keeperColour : info.primary;
  const shorts = role === Role.Keeper ? 0x22201c : info.secondary;

  const group = new THREE.Group();

  const skinMat = new THREE.MeshLambertMaterial({ color: 0xc98d5f });
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const shortsMat = new THREE.MeshLambertMaterial({ color: shorts });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(PLAYER_RADIUS * 0.62, 0.62, 4, 10), shirtMat);
  torso.position.y = 1.15;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skinMat);
  head.position.y = PLAYER_HEIGHT - 0.16;
  head.castShadow = true;
  group.add(head);

  // A shock of dark hair so heads are not featureless balls.
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshLambertMaterial({ color: 0x241a14 }),
  );
  hair.position.y = PLAYER_HEIGHT - 0.11;
  group.add(hair);

  const legGeo = new THREE.CapsuleGeometry(0.14, 0.5, 3, 8);
  const legL = new THREE.Mesh(legGeo, shortsMat);
  legL.position.set(-0.17, 0.5, 0);
  legL.castShadow = true;
  group.add(legL);
  const legR = new THREE.Mesh(legGeo, shortsMat);
  legR.position.set(0.17, 0.5, 0);
  legR.castShadow = true;
  group.add(legR);

  const armGeo = new THREE.CapsuleGeometry(0.1, 0.44, 3, 8);
  const armL = new THREE.Mesh(armGeo, skinMat);
  armL.position.set(-0.46, 1.2, 0);
  group.add(armL);
  const armR = new THREE.Mesh(armGeo, skinMat);
  armR.position.set(0.46, 1.2, 0);
  group.add(armR);

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

  return { group, torso, head, legL, legR, armL, armR, ring, shadow, aura, stride: 0, team, role };
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
  const swing = Math.sin(rig.stride) * Math.min(0.85, 0.18 + speed * 0.07);
  const lift = Math.max(0, Math.sin(rig.stride)) * Math.min(0.16, speed * 0.014);

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
      const t = performance.now() / 200;
      g.position.y = Math.abs(Math.sin(t)) * 0.42;
      rig.armL.rotation.x = -2.5;
      rig.armR.rotation.x = -2.5;
      rig.armL.rotation.z = 0.5;
      rig.armR.rotation.z = -0.5;
      break;
    }
    default:
      break;
  }

  rig.shadow.position.set(0, 0.02 - g.position.y, 0);
  rig.shadow.scale.setScalar(1 - Math.min(0.4, g.position.y * 0.35));
  rig.ring.visible = controlled;
  rig.ring.position.y = 0.03 - g.position.y;

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
  const rig = makePlayerRig(0, Role.Midfielder, 0x14120f);
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
