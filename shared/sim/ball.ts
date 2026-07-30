import {
  BALL_DRAG,
  BALL_MAGNUS,
  BALL_MAX_SPEED,
  BALL_RADIUS,
  BALL_RESTITUTION,
  BALL_ROLL_DECEL,
  BALL_SPIN_DECAY,
  BALL_GROUND_FRICTION,
  GOAL_DEPTH,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  GRAVITY,
  HALF_LENGTH,
  HALF_WIDTH,
  POST_RADIUS,
  WALL_HEIGHT,
  WALL_RESTITUTION,
} from '../constants.js';
import { clamp, len2, v3, type Vec3 } from '../math.js';
import type { World } from '../types.js';

/** Where the ball was at the start of the tick - used for goal-line crossing. */
export interface BallStepResult {
  prev: Vec3;
}

export function clampBallSpeed(v: Vec3): void {
  const s = Math.hypot(v.x, v.y, v.z);
  if (s > BALL_MAX_SPEED) {
    const k = BALL_MAX_SPEED / s;
    v.x *= k;
    v.y *= k;
    v.z *= k;
  }
}

/**
 * Integrate the ball for one step: gravity, quadratic drag, Magnus curve,
 * turf friction, then collisions with the turf, the walls and the woodwork.
 */
export function stepBall(world: World, dt: number): BallStepResult {
  const b = world.ball;
  const prev = v3(b.pos.x, b.pos.y, b.pos.z);
  b.sinceKick += dt;

  const grounded = b.pos.y <= BALL_RADIUS + 0.01 && Math.abs(b.vel.y) < 0.6;
  const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);

  if (!grounded) {
    // Air drag, opposing velocity, quadratic in speed.
    if (speed > 0.01) {
      const d = BALL_DRAG * speed;
      b.vel.x -= b.vel.x * d * dt;
      b.vel.y -= b.vel.y * d * dt;
      b.vel.z -= b.vel.z * d * dt;
    }
    // Magnus: a = k * (spin x vel). Mostly the Y spin bending the flight.
    const ax = BALL_MAGNUS * (b.spin.y * b.vel.z - b.spin.z * b.vel.y);
    const ay = BALL_MAGNUS * (b.spin.z * b.vel.x - b.spin.x * b.vel.z);
    const az = BALL_MAGNUS * (b.spin.x * b.vel.y - b.spin.y * b.vel.x);
    b.vel.x += ax * dt;
    b.vel.y += ay * dt;
    b.vel.z += az * dt;
    b.vel.y -= GRAVITY * dt;
  } else {
    // Rolling: constant deceleration plus a gentle curve from residual spin.
    const gs = len2(b.vel.x, b.vel.z);
    if (gs > 0.02) {
      const dec = Math.min(gs, BALL_ROLL_DECEL * dt);
      b.vel.x -= (b.vel.x / gs) * dec;
      b.vel.z -= (b.vel.z / gs) * dec;
      const curve = BALL_MAGNUS * 0.35 * b.spin.y;
      const vx = b.vel.x;
      const vz = b.vel.z;
      b.vel.x += -vz * curve * dt;
      b.vel.z += vx * curve * dt;
    } else {
      b.vel.x = 0;
      b.vel.z = 0;
    }
    b.vel.y = 0;
  }

  // Spin bleeds off over time.
  const decay = Math.pow(BALL_SPIN_DECAY, dt);
  b.spin.x *= decay;
  b.spin.y *= decay;
  b.spin.z *= decay;

  clampBallSpeed(b.vel);

  b.pos.x += b.vel.x * dt;
  b.pos.y += b.vel.y * dt;
  b.pos.z += b.vel.z * dt;

  collideGround(world);
  collideWoodwork(world);
  collideWalls(world);

  return { prev };
}

function collideGround(world: World): void {
  const b = world.ball;
  if (b.pos.y > BALL_RADIUS) return;
  b.pos.y = BALL_RADIUS;
  if (b.vel.y < -0.5) {
    const impact = -b.vel.y;
    b.vel.y = impact * BALL_RESTITUTION;

    // Friction impulse on the tangential velocity, capped by the normal impulse.
    const tx = b.vel.x;
    const tz = b.vel.z;
    const tSpeed = len2(tx, tz);
    if (tSpeed > 0.01) {
      const maxFric = BALL_GROUND_FRICTION * impact * (1 + BALL_RESTITUTION);
      const f = Math.min(tSpeed, maxFric);
      b.vel.x -= (tx / tSpeed) * f;
      b.vel.z -= (tz / tSpeed) * f;
    }
    // Backspin kicks the ball back, topspin drives it on.
    b.vel.x += b.spin.z * 0.012 * impact;
    b.vel.z -= b.spin.x * 0.012 * impact;
    b.spin.x *= 0.6;
    b.spin.z *= 0.6;

    if (impact > 1.5) {
      world.events.push({ t: 'bounce', x: b.pos.x, y: b.pos.y, z: b.pos.z, speed: impact });
    }
  } else if (b.vel.y < 0) {
    b.vel.y = 0;
  }
}

function bounceOffCylinder(world: World, cx: number, cz: number, radius: number): boolean {
  const b = world.ball;
  const dx = b.pos.x - cx;
  const dz = b.pos.z - cz;
  const d = len2(dx, dz);
  const minD = radius + BALL_RADIUS;
  if (d >= minD || d < 1e-6) return false;
  const nx = dx / d;
  const nz = dz / d;
  b.pos.x = cx + nx * minD;
  b.pos.z = cz + nz * minD;
  const vn = b.vel.x * nx + b.vel.z * nz;
  if (vn < 0) {
    b.vel.x -= (1 + 0.72) * vn * nx;
    b.vel.z -= (1 + 0.72) * vn * nz;
    world.events.push({ t: 'post', x: cx, z: cz });
  }
  return true;
}

function collideWoodwork(world: World): void {
  const b = world.ball;
  for (const sign of [-1, 1]) {
    const gx = sign * HALF_LENGTH;
    if (Math.abs(b.pos.x - gx) > 2.5) continue;
    if (b.pos.y < GOAL_HEIGHT + POST_RADIUS) {
      bounceOffCylinder(world, gx, -GOAL_HALF_WIDTH, POST_RADIUS);
      bounceOffCylinder(world, gx, GOAL_HALF_WIDTH, POST_RADIUS);
    }
    // Crossbar: a horizontal bar spanning the mouth at goal height.
    if (Math.abs(b.pos.z) < GOAL_HALF_WIDTH) {
      const dy = b.pos.y - GOAL_HEIGHT;
      const dx = b.pos.x - gx;
      const d = Math.hypot(dx, dy);
      const minD = POST_RADIUS + BALL_RADIUS;
      if (d < minD && d > 1e-6) {
        const nx = dx / d;
        const ny = dy / d;
        b.pos.x = gx + nx * minD;
        b.pos.y = GOAL_HEIGHT + ny * minD;
        const vn = b.vel.x * nx + b.vel.y * ny;
        if (vn < 0) {
          b.vel.x -= 1.72 * vn * nx;
          b.vel.y -= 1.72 * vn * ny;
          world.events.push({ t: 'post', x: gx, z: b.pos.z });
        }
      }
    }
  }
}

/**
 * The touchlines are boards - this league does not do throw-ins. Behind the
 * goal line the ball either enters the goal mouth or rebounds off the hoarding.
 */
function collideWalls(world: World): void {
  const b = world.ball;

  // Side boards.
  if (b.pos.z > HALF_WIDTH - BALL_RADIUS && b.pos.y < WALL_HEIGHT) {
    b.pos.z = HALF_WIDTH - BALL_RADIUS;
    if (b.vel.z > 0) {
      b.vel.z = -b.vel.z * WALL_RESTITUTION;
      b.spin.y *= -0.5;
      world.events.push({ t: 'wall', x: b.pos.x, z: b.pos.z, speed: Math.abs(b.vel.z) });
    }
  } else if (b.pos.z < -HALF_WIDTH + BALL_RADIUS && b.pos.y < WALL_HEIGHT) {
    b.pos.z = -HALF_WIDTH + BALL_RADIUS;
    if (b.vel.z < 0) {
      b.vel.z = -b.vel.z * WALL_RESTITUTION;
      b.spin.y *= -0.5;
      world.events.push({ t: 'wall', x: b.pos.x, z: b.pos.z, speed: Math.abs(b.vel.z) });
    }
  }

  for (const sign of [-1, 1]) {
    const line = sign * HALF_LENGTH;
    const beyond = sign > 0 ? b.pos.x > line - BALL_RADIUS : b.pos.x < line + BALL_RADIUS;
    if (!beyond) continue;
    const inMouth = Math.abs(b.pos.z) < GOAL_HALF_WIDTH - BALL_RADIUS * 0.5 && b.pos.y < GOAL_HEIGHT;
    if (inMouth) {
      // Inside the goal: net catches it at the back and the side netting damps it.
      const back = sign * (HALF_LENGTH + GOAL_DEPTH);
      const past = sign > 0 ? b.pos.x > back - BALL_RADIUS : b.pos.x < back + BALL_RADIUS;
      if (past) {
        b.pos.x = back - sign * BALL_RADIUS;
        b.vel.x *= -0.18;
        b.vel.z *= 0.4;
        b.vel.y *= 0.3;
      }
      continue;
    }
    // Hoarding behind the goal.
    b.pos.x = line - sign * BALL_RADIUS;
    if (Math.sign(b.vel.x) === sign) {
      b.vel.x = -b.vel.x * WALL_RESTITUTION;
      world.events.push({ t: 'wall', x: b.pos.x, z: b.pos.z, speed: Math.abs(b.vel.x) });
    }
  }
}

/** True when the ball's path this tick fully crossed a goal line inside the frame. */
export function crossedGoalLine(world: World, prev: Vec3): 0 | 1 | -1 {
  const b = world.ball;
  for (const sign of [-1, 1] as const) {
    const line = sign * (HALF_LENGTH + BALL_RADIUS * 0.5);
    const was = sign > 0 ? prev.x < line : prev.x > line;
    const now = sign > 0 ? b.pos.x >= line : b.pos.x <= line;
    if (!was || !now) continue;
    const t = clamp((line - prev.x) / (b.pos.x - prev.x || 1e-6), 0, 1);
    const z = prev.z + (b.pos.z - prev.z) * t;
    const y = prev.y + (b.pos.y - prev.y) * t;
    if (Math.abs(z) < GOAL_HALF_WIDTH - BALL_RADIUS * 0.4 && y < GOAL_HEIGHT - BALL_RADIUS * 0.4) {
      // sign > 0 means it went in at +X, which is team 1's goal, so team 0 scored.
      return sign > 0 ? 0 : 1;
    }
  }
  return -1;
}
