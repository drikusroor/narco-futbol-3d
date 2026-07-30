import {
  BOX_LENGTH,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  HALF_LENGTH,
  HALF_WIDTH,
  SPRINT_SPEED,
} from '@shared/constants.js';
import { Rng, clamp, dist2, headingOf, len2 } from '@shared/math.js';
import {
  BTN,
  MatchPhase,
  PlayerAct,
  emptyInput,
  type PlayerInput,
  type PlayerState,
  type World,
} from '@shared/types.js';
import { attackDir, ownGoalX } from '@shared/sim/formation.js';
import { kickLoose, pickPassTarget } from '@shared/sim/actions.js';
import { predictBall } from '@shared/sim/predict.js';
import { speedMul } from '@shared/sim/stats.js';

const DIVE_SPEED = 13.5;

/** Per-keeper memory: keepers are not allowed to be psychic. */
export interface KeeperMemory {
  /** World time at which the keeper has processed the current strike. */
  reactAt: number;
  lastKickAt: number;
}

export function newKeeperMemory(): KeeperMemory {
  return { reactAt: 0, lastKickAt: -1 };
}

/**
 * The keeper plays itself - nobody wants to be stuck in goal in a five minute
 * game. It holds a line between the ball and the middle of the goal, comes to
 * sweep when the ball is loose in the box, dives at shots it can reach, and
 * distributes quickly once it has hold of it.
 */
export function keeperThink(
  world: World,
  p: PlayerState,
  rng: Rng,
  skill: number,
  seq: number,
  mem: KeeperMemory,
): PlayerInput {
  const input = emptyInput(seq);
  const goalX = ownGoalX(p.team);
  const dir = attackDir(p.team);
  const ball = world.ball;

  if (world.match.phase !== MatchPhase.Play && world.match.phase !== MatchPhase.Kickoff) {
    return goTo(input, p, goalX + dir * 1.2, 0, false);
  }

  // --- has the ball: distribute -------------------------------------------
  if (ball.owner === p.id) {
    // Hold it for a beat, then find a team-mate or hoof it upfield.
    const target = pickPassTarget(world, p, 0.6);
    const aim = target
      ? headingOf(target.aimX - p.pos.x, target.aimZ - p.pos.z)
      : headingOf(dir, rng.range(-0.6, 0.6));
    p.facing = aim;
    if (target && dist2(p.pos, target.player.pos) < 34 && rng.next() < 0.6) {
      const d = dist2(p.pos, target.player.pos);
      const speed = clamp(Math.sqrt(d * 17), 12, 26);
      kickLoose(world, p, Math.sin(aim), Math.cos(aim), speed * 0.85, speed * 0.45);
    } else {
      kickLoose(world, p, Math.sin(aim), Math.cos(aim), 21, 11);
    }
    return goTo(input, p, goalX + dir * 2, 0, false);
  }

  // --- shot incoming: get across, and dive if it is going wide of us --------
  // A keeper has to see the strike before it can move, which is what gives a
  // well placed shot somewhere to go.
  if (ball.sinceKick < 0.05 && world.time - mem.lastKickAt > 0.2) {
    mem.lastKickAt = world.time;
    mem.reactAt = world.time + 0.34 - skill * 0.16;
  }
  const reacting = world.time >= mem.reactAt;
  const towardGoal = (goalX - ball.pos.x) * ball.vel.x > 0;
  const ballDist = Math.abs(ball.pos.x - goalX);
  if (reacting && towardGoal && ballDist < 32 && len2(ball.vel.x, ball.vel.z) > 7) {
    const cross = crossingPoint(world, goalX);
    if (cross) {
      const reachable = Math.abs(cross.z) < GOAL_HALF_WIDTH + 2.5 && cross.y < GOAL_HEIGHT + 0.6;
      if (reachable) {
        const lateral = cross.z - p.pos.z;
        const canRun = Math.abs(lateral) <= SPRINT_SPEED * speedMul(p) * cross.t;
        if (!canRun && cross.t < 0.55 && p.act !== PlayerAct.Dive && Math.abs(lateral) < 7) {
          // No time to run - throw yourself at it.
          const sign = Math.sign(lateral) || 1;
          p.act = PlayerAct.Dive;
          p.actTimer = 0.55;
          p.vel.z = sign * DIVE_SPEED;
          p.vel.x = (ball.pos.x - p.pos.x) * 0.35;
          p.facing = headingOf(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
          world.events.push({ t: 'save', player: p.id });
          return input;
        }
        const standX = clamp(goalX + dir * 1.0, -HALF_LENGTH + 0.6, HALF_LENGTH - 0.6);
        return goTo(input, p, standX, clamp(cross.z, -GOAL_HALF_WIDTH - 1, GOAL_HALF_WIDTH + 1), true);
      }
    }
  }

  // --- sweep loose balls in the box ---------------------------------------
  const inBox =
    Math.abs(ball.pos.x - goalX) < BOX_LENGTH + 2 && Math.abs(ball.pos.z) < GOAL_HALF_WIDTH + 6;
  const opponentClose = world.players.some(
    (o) => o.team !== p.team && dist2(o.pos, ball.pos) < 3.5,
  );
  if (inBox && ball.pos.y < 2.2 && (ball.owner < 0 || opponentClose)) {
    const chase = dist2(p.pos, ball.pos) < 9 && (!opponentClose || dist2(p.pos, ball.pos) < 4.5);
    if (chase || (ball.owner < 0 && dist2(p.pos, ball.pos) < 7)) {
      const out = goTo(input, p, ball.pos.x, ball.pos.z, true);
      if (dist2(p.pos, ball.pos) < 2.2 && rng.next() < 0.35 + skill * 0.4) {
        out.buttons |= BTN.TACKLE;
      }
      return out;
    }
  }

  // --- default: hold the angle --------------------------------------------
  const dx = ball.pos.x - goalX;
  const dz = ball.pos.z;
  const dLen = Math.hypot(dx, dz) || 1;
  // Come off the line more when the ball is close; never more than the box.
  const advance = clamp(BOX_LENGTH * 0.42 * (1 - dLen / 46), 0.8, BOX_LENGTH * 0.5);
  const standX = goalX + (dx / dLen) * advance;
  const standZ = clamp((dz / dLen) * advance * 0.9 + dz * 0.12, -GOAL_HALF_WIDTH - 1.5, GOAL_HALF_WIDTH + 1.5);
  return goTo(
    input,
    p,
    clamp(standX, -HALF_LENGTH + 0.5, HALF_LENGTH - 0.5),
    clamp(standZ, -HALF_WIDTH + 2, HALF_WIDTH - 2),
    dLen < 26,
  );
}

/** Where and when the ball will cross the goal line plane. */
function crossingPoint(world: World, goalX: number): { z: number; y: number; t: number } | null {
  const ball = world.ball;
  for (let t = 0.06; t <= 1.4; t += 0.06) {
    const pt = predictBall(ball, t);
    const crossed = goalX > 0 ? pt.x >= goalX - 0.5 : pt.x <= goalX + 0.5;
    if (crossed) return { z: pt.z, y: pt.y, t };
  }
  return null;
}

function goTo(input: PlayerInput, p: PlayerState, x: number, z: number, sprint: boolean): PlayerInput {
  const dx = x - p.pos.x;
  const dz = z - p.pos.z;
  const d = len2(dx, dz);
  if (d > 0.2) {
    const throttle = clamp(d / 1.5, 0.3, 1);
    input.moveX = (dx / d) * throttle;
    input.moveZ = (dz / d) * throttle;
    if (sprint && d > 1.5) input.buttons |= BTN.SPRINT;
  }
  input.aim = headingOf(dx, dz);
  return input;
}
