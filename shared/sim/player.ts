import {
  HALF_LENGTH,
  HALF_WIDTH,
  LOB_CHARGE_TIME,
  PASS_CHARGE_TIME,
  PLAYER_ACCEL,
  PLAYER_DECEL,
  PLAYER_RADIUS,
  PLAYER_TURN_RATE,
  RUN_SPEED,
  SHOT_CHARGE_TIME,
  SLIDE_DURATION,
  SLIDE_SPEED,
  SPRINT_SPEED,
  SPRINT_SPEED as _SPRINT,
  STAMINA_MAX,
  STAMINA_RECOVER,
  STAMINA_SPRINT_DRAIN,
  DRIBBLE_SPEED_PENALTY,
  TACKLE_COOLDOWN,
  GOAL_DEPTH,
} from '../constants.js';
import { clamp, damp, headingOf, len2, approachAngle } from '../math.js';
import {
  BTN,
  MatchPhase,
  PlayerAct,
  Role,
  hasBtn,
  type PlayerInput,
  type PlayerState,
  type World,
} from '../types.js';
import { kickLoose, startSlide, tryShoulder, doPass, doShot, doLob, canReachBall } from './actions.js';
import { speedMul } from './stats.js';

void _SPRINT;

/** Can this player act at all right now? */
export function isFrozen(world: World, p: PlayerState): boolean {
  const phase = world.match.phase;
  if (phase === MatchPhase.Play) return false;
  if (phase === MatchPhase.Kickoff || phase === MatchPhase.FreeKick) {
    // The restarting side may move; everyone else waits for the whistle.
    return world.match.phaseTimer > 0;
  }
  return true;
}

export function stepPlayer(world: World, p: PlayerState, input: PlayerInput, dt: number): void {
  p.kickCooldown = Math.max(0, p.kickCooldown - dt);
  p.tackleCooldown = Math.max(0, p.tackleCooldown - dt);
  p.touchCooldown = Math.max(0, p.touchCooldown - dt);
  p.kickFx = 0;
  if (p.powerupTimer > 0) {
    p.powerupTimer -= dt;
    if (p.powerupTimer <= 0) {
      p.powerupTimer = 0;
      p.powerup = 0;
    }
  }

  if (p.actTimer > 0) {
    p.actTimer -= dt;
    if (p.actTimer <= 0) {
      p.actTimer = 0;
      if (p.act !== PlayerAct.Idle) p.act = PlayerAct.Idle;
    }
  }

  const frozen = isFrozen(world, p);
  if (frozen) {
    p.vel.x *= 1 - damp(10, dt);
    p.vel.z *= 1 - damp(10, dt);
    p.passCharge = -1;
    p.shootCharge = -1;
    p.lobCharge = -1;
    p.lastButtons = input.buttons;
    integrate(p, dt);
    return;
  }

  switch (p.act) {
    case PlayerAct.Slide:
      stepSlide(world, p, dt);
      p.lastButtons = input.buttons;
      return;
    case PlayerAct.Stunned:
      p.vel.x *= 1 - damp(6, dt);
      p.vel.z *= 1 - damp(6, dt);
      integrate(p, dt);
      p.lastButtons = input.buttons;
      return;
    case PlayerAct.Dive:
      // Keepers commit: they fly along the dive vector and cannot steer.
      p.vel.x *= 1 - damp(2.4, dt);
      p.vel.z *= 1 - damp(2.4, dt);
      integrate(p, dt);
      p.lastButtons = input.buttons;
      return;
    default:
      break;
  }

  move(world, p, input, dt);
  handleActions(world, p, input, dt);
  integrate(p, dt);
  p.lastButtons = input.buttons;
  p.lastSeq = input.seq;
}

function move(world: World, p: PlayerState, input: PlayerInput, dt: number): void {
  let mx = input.moveX;
  let mz = input.moveZ;
  const mag = len2(mx, mz);
  if (mag > 1) {
    mx /= mag;
    mz /= mag;
  }
  const moving = mag > 0.08;

  const wantsSprint = hasBtn(input, BTN.SPRINT) && p.stamina > 0.02 && moving;
  if (wantsSprint) {
    p.stamina = Math.max(0, p.stamina - STAMINA_SPRINT_DRAIN * dt);
  } else {
    p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_RECOVER * dt * (moving ? 0.6 : 1));
  }

  const hasBall = world.ball.owner === p.id;
  let maxSpeed = (wantsSprint ? SPRINT_SPEED : RUN_SPEED) * speedMul(p);
  if (hasBall) maxSpeed *= wantsSprint ? DRIBBLE_SPEED_PENALTY : 0.96;
  // Charging a big shot roots you a little, like planting for the strike.
  if (p.shootCharge > 0.25) maxSpeed *= 0.68;

  const targetVx = mx * maxSpeed * Math.min(1, mag);
  const targetVz = mz * maxSpeed * Math.min(1, mag);
  const rate = moving ? PLAYER_ACCEL : PLAYER_DECEL;
  const dvx = targetVx - p.vel.x;
  const dvz = targetVz - p.vel.z;
  const dv = len2(dvx, dvz);
  const step = rate * dt;
  if (dv > 1e-5) {
    const k = Math.min(1, step / dv);
    p.vel.x += dvx * k;
    p.vel.z += dvz * k;
  }

  const heading = moving ? headingOf(mx, mz) : input.aim;
  const turnRate = PLAYER_TURN_RATE * (hasBall ? 0.8 : 1);
  p.facing = approachAngle(p.facing, heading, turnRate * dt);

  if (p.act === PlayerAct.Idle || p.act === PlayerAct.Run) {
    p.act = len2(p.vel.x, p.vel.z) > 0.6 ? PlayerAct.Run : PlayerAct.Idle;
  }
}

function handleActions(world: World, p: PlayerState, input: PlayerInput, dt: number): void {
  const pass = hasBtn(input, BTN.PASS);
  const shoot = hasBtn(input, BTN.SHOOT);
  const lob = hasBtn(input, BTN.LOB);
  const tackle = hasBtn(input, BTN.TACKLE);
  const tacklePressed = tackle && (p.lastButtons & BTN.TACKLE) === 0;

  // --- charge / release: pass -------------------------------------------
  if (pass) {
    p.passCharge = p.passCharge < 0 ? 0 : Math.min(PASS_CHARGE_TIME, p.passCharge + dt);
  } else if (p.passCharge >= 0) {
    const charge = clamp(p.passCharge / PASS_CHARGE_TIME, 0.12, 1);
    p.passCharge = -1;
    if (canKick(world, p)) {
      if (world.ball.owner === p.id || nearBall(world, p)) doPass(world, p, charge);
    }
  }

  if (shoot) {
    p.shootCharge = p.shootCharge < 0 ? 0 : Math.min(SHOT_CHARGE_TIME, p.shootCharge + dt);
  } else if (p.shootCharge >= 0) {
    const charge = clamp(p.shootCharge / SHOT_CHARGE_TIME, 0.15, 1);
    p.shootCharge = -1;
    if (canKick(world, p) && (world.ball.owner === p.id || nearBall(world, p))) {
      doShot(world, p, charge);
    }
  }

  if (lob) {
    p.lobCharge = p.lobCharge < 0 ? 0 : Math.min(LOB_CHARGE_TIME, p.lobCharge + dt);
  } else if (p.lobCharge >= 0) {
    const charge = clamp(p.lobCharge / LOB_CHARGE_TIME, 0.2, 1);
    p.lobCharge = -1;
    if (canKick(world, p) && (world.ball.owner === p.id || nearBall(world, p))) {
      doLob(world, p, charge);
    }
  }

  // --- tackling ----------------------------------------------------------
  if (tacklePressed && p.tackleCooldown <= 0 && p.act !== PlayerAct.Kick) {
    const speed = len2(p.vel.x, p.vel.z);
    const sprinting = hasBtn(input, BTN.SPRINT) && speed > RUN_SPEED * 0.75;
    if (sprinting) {
      startSlide(world, p);
    } else if (world.ball.owner === p.id) {
      // With the ball, the tackle button is a shield/hold-up move: dig in.
      p.vel.x *= 0.55;
      p.vel.z *= 0.55;
      p.act = PlayerAct.Tackle;
      p.actTimer = 0.2;
      p.tackleCooldown = 0.3;
    } else {
      tryShoulder(world, p);
    }
  }

  // A free ball at your feet with nothing pressed still gets swept clear by
  // keepers - handled by the keeper AI, which calls kickLoose directly.
  void kickLoose;
  void dt;
}

function canKick(world: World, p: PlayerState): boolean {
  return p.kickCooldown <= 0 && p.act !== PlayerAct.Slide && p.act !== PlayerAct.Stunned && !isFrozen(world, p);
}

function nearBall(world: World, p: PlayerState): boolean {
  return canReachBall(world, p);
}

function stepSlide(world: World, p: PlayerState, dt: number): void {
  p.actTimer -= dt;
  const t = clamp(p.actTimer / SLIDE_DURATION, 0, 1);
  const speed = SLIDE_SPEED * (0.35 + 0.65 * t);
  p.vel.x = p.slideX * speed;
  p.vel.z = p.slideZ * speed;
  integrate(p, dt);
  if (p.actTimer <= 0) {
    p.act = PlayerAct.Stunned;
    p.actTimer = 0.5;
    p.vel.x *= 0.2;
    p.vel.z *= 0.2;
    p.tackleCooldown = TACKLE_COOLDOWN;
  }
  void world;
}

export function integrate(p: PlayerState, dt: number): void {
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  clampToPitch(p);
}

export function clampToPitch(p: PlayerState): void {
  const limZ = HALF_WIDTH - PLAYER_RADIUS;
  if (p.pos.z > limZ) {
    p.pos.z = limZ;
    if (p.vel.z > 0) p.vel.z = 0;
  } else if (p.pos.z < -limZ) {
    p.pos.z = -limZ;
    if (p.vel.z < 0) p.vel.z = 0;
  }
  // Keepers may stand a touch inside the goal; everyone else stops at the line.
  const limX = HALF_LENGTH + (p.role === Role.Keeper ? GOAL_DEPTH * 0.4 : 0) - PLAYER_RADIUS;
  if (p.pos.x > limX) {
    p.pos.x = limX;
    if (p.vel.x > 0) p.vel.x = 0;
  } else if (p.pos.x < -limX) {
    p.pos.x = -limX;
    if (p.vel.x < 0) p.vel.x = 0;
  }
}

/** Push overlapping players apart; heavier/stronger players give less ground. */
export function resolvePlayerCollisions(world: World, dt: number): void {
  const players = world.players;
  const minD = PLAYER_RADIUS * 2;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const dSq = dx * dx + dz * dz;
      if (dSq > minD * minD || dSq < 1e-9) continue;
      const d = Math.sqrt(dSq);
      const nx = dx / d;
      const nz = dz / d;
      const overlap = minD - d;

      // A sliding player bowls through; a stunned one is dead weight.
      const wa = a.act === PlayerAct.Slide ? 0.15 : a.act === PlayerAct.Stunned ? 0.8 : 0.5;
      const wb = b.act === PlayerAct.Slide ? 0.15 : b.act === PlayerAct.Stunned ? 0.8 : 0.5;
      const total = wa + wb || 1;
      a.pos.x -= nx * overlap * (wa / total);
      a.pos.z -= nz * overlap * (wa / total);
      b.pos.x += nx * overlap * (wb / total);
      b.pos.z += nz * overlap * (wb / total);

      // Kill the closing velocity so bodies do not jitter against each other.
      const rvn = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
      if (rvn < 0) {
        const push = rvn * 0.5;
        a.vel.x += nx * push;
        a.vel.z += nz * push;
        b.vel.x -= nx * push;
        b.vel.z -= nz * push;
      }
      clampToPitch(a);
      clampToPitch(b);
    }
  }
  void dt;
}
