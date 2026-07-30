import {
  BALL_DRAG,
  BALL_RADIUS,
  BALL_RESTITUTION,
  BALL_ROLL_DECEL,
  GRAVITY,
  HALF_LENGTH,
  HALF_WIDTH,
} from '../constants.js';
import { len2, v3, type Vec3 } from '../math.js';
import type { BallState, PlayerState } from '../types.js';

/**
 * Cheap forward integration of the ball, used by the AI (and the client's aim
 * marker). Collisions with players are ignored; walls and the turf are not.
 */
export function predictBall(ball: BallState, time: number, step = 1 / 30): Vec3 {
  const p = v3(ball.pos.x, ball.pos.y, ball.pos.z);
  const v = v3(ball.vel.x, ball.vel.y, ball.vel.z);
  let t = 0;
  while (t < time) {
    const dt = Math.min(step, time - t);
    const grounded = p.y <= BALL_RADIUS + 0.01 && Math.abs(v.y) < 0.6;
    if (!grounded) {
      const speed = Math.hypot(v.x, v.y, v.z);
      const d = BALL_DRAG * speed * dt;
      v.x -= v.x * d;
      v.y -= v.y * d;
      v.z -= v.z * d;
      v.y -= GRAVITY * dt;
    } else {
      const gs = len2(v.x, v.z);
      if (gs > 0.02) {
        const dec = Math.min(gs, BALL_ROLL_DECEL * dt);
        v.x -= (v.x / gs) * dec;
        v.z -= (v.z / gs) * dec;
      } else {
        v.x = 0;
        v.z = 0;
      }
      v.y = 0;
    }
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
    if (p.y < BALL_RADIUS) {
      p.y = BALL_RADIUS;
      if (v.y < -0.5) v.y = -v.y * BALL_RESTITUTION;
      else v.y = 0;
    }
    if (p.z > HALF_WIDTH - BALL_RADIUS) {
      p.z = HALF_WIDTH - BALL_RADIUS;
      v.z = -Math.abs(v.z) * 0.6;
    } else if (p.z < -HALF_WIDTH + BALL_RADIUS) {
      p.z = -HALF_WIDTH + BALL_RADIUS;
      v.z = Math.abs(v.z) * 0.6;
    }
    if (Math.abs(p.x) > HALF_LENGTH - BALL_RADIUS) {
      p.x = Math.sign(p.x) * (HALF_LENGTH - BALL_RADIUS);
      v.x *= -0.6;
    }
    t += dt;
  }
  return p;
}

/**
 * Earliest point on the ball's path this player could plausibly get to.
 * Returns the ball's current position when nothing is reachable.
 */
export function interceptPoint(
  ball: BallState,
  p: PlayerState,
  speed: number,
  horizon = 1.8,
): { x: number; z: number; t: number } {
  let best = { x: ball.pos.x, z: ball.pos.z, t: horizon };
  for (let t = 0.1; t <= horizon; t += 0.12) {
    const pt = predictBall(ball, t);
    if (pt.y > 2.5) continue;
    const d = Math.hypot(pt.x - p.pos.x, pt.z - p.pos.z);
    if (d <= speed * t + 0.6) return { x: pt.x, z: pt.z, t };
    best = { x: pt.x, z: pt.z, t };
  }
  return best;
}
