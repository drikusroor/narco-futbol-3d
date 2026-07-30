import {
  BALL_RADIUS,
  CONTROL_HEIGHT,
  CONTROL_RADIUS,
  DRIBBLE_GAIN,
  DRIBBLE_LEAD,
  DRIBBLE_SPRINT_LEAD,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SPRINT_SPEED,
  SHIELD_ANGLE,
} from '../constants.js';
import { Rng, clamp, dirFromHeading, dist2, len2 } from '../math.js';
import { MatchPhase, PlayerAct, Role, type PlayerState, type World } from '../types.js';
import { controlMul, strengthMul } from './stats.js';

const MAX_DRIBBLE_ACCEL = 55;

function canControl(p: PlayerState): boolean {
  return (
    p.touchCooldown <= 0 &&
    p.act !== PlayerAct.Stunned &&
    p.act !== PlayerAct.Slide &&
    p.kickCooldown <= 0
  );
}

/** How far from the feet the ball can be taken under control. */
function reachOf(p: PlayerState): number {
  if (p.role === Role.Keeper) return CONTROL_RADIUS * (p.act === PlayerAct.Dive ? 1.6 : 1.0);
  return CONTROL_RADIUS;
}

/**
 * Decide who, if anyone, has the ball at their feet. Ownership is sticky - you
 * keep it until you are dispossessed, you kick it, or it gets away from you -
 * which is what makes shielding and 50/50s mean something.
 */
export function updateOwnership(world: World, dt: number): void {
  const b = world.ball;
  const rng = new Rng(world.rngState);

  if (world.match.phase !== MatchPhase.Play && world.match.phase !== MatchPhase.Kickoff && world.match.phase !== MatchPhase.FreeKick) {
    b.owner = -1;
    world.rngState = rng.state;
    return;
  }

  let owner = b.owner >= 0 ? world.players.find((p) => p.id === b.owner) : undefined;
  if (owner) {
    const lost =
      !canControl(owner) ||
      dist2(owner.pos, b.pos) > CONTROL_RADIUS * 1.5 ||
      b.pos.y > CONTROL_HEIGHT * 1.4;
    if (lost) {
      b.owner = -1;
      owner = undefined;
    }
  }

  // Gather everyone who could take a touch this tick.
  let challenger: PlayerState | null = null;
  let challengerDist = Infinity;
  let claimant: PlayerState | null = null;
  let claimantDist = Infinity;

  for (const p of world.players) {
    if (!canControl(p)) continue;
    const d = dist2(p.pos, b.pos);
    if (d > reachOf(p)) continue;
    if (b.pos.y > (p.role === Role.Keeper ? 2.4 : CONTROL_HEIGHT)) continue;
    if (owner && p.id === owner.id) continue;
    if (owner && p.team !== owner.team) {
      if (d < challengerDist) {
        challenger = p;
        challengerDist = d;
      }
    }
    if (d < claimantDist) {
      claimant = p;
      claimantDist = d;
    }
  }

  if (owner) {
    if (challenger) {
      // Shielding: with your body between the ball and the challenger you are
      // much harder to knock off it.
      const toChal = Math.atan2(challenger.pos.x - owner.pos.x, challenger.pos.z - owner.pos.z);
      const facingAway = Math.abs(((toChal - owner.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const shielding = facingAway > SHIELD_ANGLE ? 0.45 : 1;
      const ratio = strengthMul(challenger) / strengthMul(owner);
      const closeness = clamp(1 - challengerDist / (CONTROL_RADIUS * 1.2), 0, 1);
      const chance = 1.15 * dt * ratio * closeness * shielding;
      if (rng.next() < chance) {
        b.owner = challenger.id;
        b.lastTouch = challenger.id;
        b.lastTouchTeam = challenger.team;
        owner.touchCooldown = 0.35;
        owner = challenger;
      }
    }
  } else if (claimant) {
    // First touch. A ball arriving fast cannot be killed dead from a stretch -
    // if it is flying past you it takes an actual body block to stop it, which
    // resolveBallBodies handles. Only a controllable ball is claimed here.
    const relX = b.vel.x - claimant.vel.x;
    const relZ = b.vel.z - claimant.vel.z;
    const rel = Math.hypot(relX, relZ, b.vel.y);
    const threshold = 15 * controlMul(claimant);
    if (rel <= threshold) {
      b.owner = claimant.id;
      b.lastTouch = claimant.id;
      b.lastTouchTeam = claimant.team;
      owner = claimant;
    } else if (rel <= threshold * 1.6 && claimantDist < PLAYER_RADIUS + BALL_RADIUS + 0.35) {
      // Right on top of it but too quick to control: a scruffy touch that
      // takes the sting off and spins away.
      const damp = clamp(threshold / rel, 0.35, 0.85);
      b.vel.x = claimant.vel.x + relX * damp;
      b.vel.z = claimant.vel.z + relZ * damp;
      b.vel.y *= 0.5;
      b.lastTouch = claimant.id;
      b.lastTouchTeam = claimant.team;
      claimant.touchCooldown = 0.18;
    }
  }

  world.rngState = rng.state;
}

/** Steer an owned ball to sit just ahead of the dribbler's feet. */
export function applyDribble(world: World, dt: number): void {
  const b = world.ball;
  if (b.owner < 0) return;
  const p = world.players.find((x) => x.id === b.owner);
  if (!p) {
    b.owner = -1;
    return;
  }
  const speed = len2(p.vel.x, p.vel.z);
  const t = clamp(speed / SPRINT_SPEED, 0, 1);
  const lead = DRIBBLE_LEAD + (DRIBBLE_SPRINT_LEAD - DRIBBLE_LEAD) * t * t;
  const dir = dirFromHeading(p.facing);
  const targetX = p.pos.x + dir.x * lead;
  const targetZ = p.pos.z + dir.z * lead;

  const desiredVx = (targetX - b.pos.x) * DRIBBLE_GAIN + p.vel.x * 0.35;
  const desiredVz = (targetZ - b.pos.z) * DRIBBLE_GAIN + p.vel.z * 0.35;
  const dvx = desiredVx - b.vel.x;
  const dvz = desiredVz - b.vel.z;
  const dv = len2(dvx, dvz);
  const maxStep = MAX_DRIBBLE_ACCEL * dt;
  if (dv > 1e-5) {
    const k = Math.min(1, maxStep / dv);
    b.vel.x += dvx * k;
    b.vel.z += dvz * k;
  }
  if (b.pos.y <= BALL_RADIUS + 0.02) b.vel.y = 0;
  b.lastTouch = p.id;
  b.lastTouchTeam = p.team;
  // Rolling ball spins - purely cosmetic, but it sells the dribble.
  b.spin.y *= 0.9;
}

/** Bodies get in the way: bounce the ball off anyone not currently on it. */
export function resolveBallBodies(world: World): void {
  const b = world.ball;
  // Bodies block at chest height; anything above that flies over them.
  if (b.pos.y > PLAYER_HEIGHT * 0.72) return;
  const minD = PLAYER_RADIUS + BALL_RADIUS;
  for (const p of world.players) {
    if (p.id === b.owner) continue;
    const dx = b.pos.x - p.pos.x;
    const dz = b.pos.z - p.pos.z;
    const dSq = dx * dx + dz * dz;
    if (dSq > minD * minD || dSq < 1e-9) continue;
    const d = Math.sqrt(dSq);
    const nx = dx / d;
    const nz = dz / d;
    b.pos.x = p.pos.x + nx * minD;
    b.pos.z = p.pos.z + nz * minD;
    const rvn = (b.vel.x - p.vel.x) * nx + (b.vel.z - p.vel.z) * nz;
    if (rvn < 0) {
      const e = p.act === PlayerAct.Slide ? 0.9 : 0.55;
      b.vel.x -= (1 + e) * rvn * nx;
      b.vel.z -= (1 + e) * rvn * nz;
      b.vel.x += p.vel.x * 0.25;
      b.vel.z += p.vel.z * 0.25;
      if (b.lastTouch !== p.id) {
        b.lastTouch = p.id;
        b.lastTouchTeam = p.team;
      }
    }
  }
}
