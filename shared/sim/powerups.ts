import {
  HALF_LENGTH,
  HALF_WIDTH,
  POWERUP_DURATION,
  POWERUP_MAX_ACTIVE,
  POWERUP_RADIUS,
  POWERUP_RESPAWN_DELAY,
  POWERUP_SPAWN_INTERVAL,
} from '../constants.js';
import { Rng, dist2 } from '../math.js';
import { MatchPhase, PlayerAct, POWERUP_TYPES, Role, type World } from '../types.js';

/**
 * Power-ups drop onto the pitch every few seconds and are collected by running
 * over them. They are the arcade half of the game's personality.
 */
export function updatePowerups(world: World, dt: number): void {
  if (!world.config.powerupsEnabled) {
    if (world.pickups.length) world.pickups.length = 0;
    return;
  }
  const rng = new Rng(world.rngState);

  // A fixed set of crates lives on the pitch; each one goes away when it is
  // taken and pops back somewhere else a while later.
  while (world.pickups.length < POWERUP_MAX_ACTIVE) {
    world.pickups.push({
      id: world.nextPickupId++,
      type: POWERUP_TYPES[rng.int(0, POWERUP_TYPES.length - 1)],
      pos: { x: 0, y: 1.1, z: 0 },
      respawn: POWERUP_SPAWN_INTERVAL * (world.pickups.length + 1) * 0.5,
      bob: rng.range(0, 6),
    });
    relocate(world.pickups[world.pickups.length - 1], rng);
  }

  for (const pu of world.pickups) {
    pu.bob += dt;
    if (pu.respawn > 0) {
      const was = pu.respawn;
      pu.respawn = Math.max(0, pu.respawn - dt);
      if (was > 0 && pu.respawn === 0) {
        pu.type = POWERUP_TYPES[rng.int(0, POWERUP_TYPES.length - 1)];
        relocate(pu, rng);
      }
    }
  }

  if (world.match.phase !== MatchPhase.Play) {
    world.rngState = rng.state;
    return;
  }

  for (const pu of world.pickups) {
    if (pu.respawn > 0) continue;
    for (const p of world.players) {
      if (p.role === Role.Keeper || p.act === PlayerAct.Stunned) continue;
      if (dist2(p.pos, pu.pos) > POWERUP_RADIUS) continue;
      p.powerup = pu.type;
      p.powerupTimer = POWERUP_DURATION;
      pu.respawn = POWERUP_RESPAWN_DELAY + rng.range(0, 4);
      world.events.push({ t: 'pickup', player: p.id, type: pu.type });
      break;
    }
  }

  world.rngState = rng.state;
}

/** Drop a crate somewhere useful: midfield-ish, never in the six yard box. */
function relocate(pu: { pos: { x: number; z: number } }, rng: Rng): void {
  pu.pos.x = rng.range(-HALF_LENGTH + 14, HALF_LENGTH - 14);
  pu.pos.z = rng.range(-HALF_WIDTH + 4, HALF_WIDTH - 4);
}
