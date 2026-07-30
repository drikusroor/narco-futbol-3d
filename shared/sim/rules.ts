import {
  FREE_KICK_DELAY,
  FREE_KICK_WALL_DISTANCE,
  FULLTIME_LINGER,
  GOAL_CELEBRATION,
  HALF_LENGTH,
  HALF_WIDTH,
  PLAYER_RADIUS,
} from '../constants.js';
import { clamp, damp, dist2, len2, type Vec3 } from '../math.js';
import { MatchPhase, PlayerAct, type Team, type World } from '../types.js';
import { crossedGoalLine } from './ball.js';
import { resetForFreeKick, resetForKickoff, teamPlayers } from './world.js';

/** Advance clocks and move between phases. */
export function updateMatch(world: World, dt: number): void {
  const m = world.match;
  m.phaseTimer = Math.max(0, m.phaseTimer - dt);

  switch (m.phase) {
    case MatchPhase.Warmup:
      if (m.phaseTimer <= 0) resetForKickoff(world, 0);
      break;

    case MatchPhase.Kickoff:
      if (m.phaseTimer <= 0) {
        m.phase = MatchPhase.Play;
        blowWhistle(world, 'kickoff');
      }
      break;

    case MatchPhase.FreeKick:
      if (m.phaseTimer <= 0) m.phase = MatchPhase.Play;
      break;

    case MatchPhase.Play:
      m.clock = Math.max(0, m.clock - dt);
      if (m.clock <= 0) {
        m.phase = MatchPhase.FullTime;
        m.phaseTimer = FULLTIME_LINGER;
        blowWhistle(world, 'fulltime');
      }
      break;

    case MatchPhase.GoalCelebration:
      if (m.phaseTimer <= 0) {
        // The side that conceded restarts.
        const conceded: Team = m.lastScorerTeam === 0 ? 1 : 0;
        resetForKickoff(world, conceded);
      }
      break;

    case MatchPhase.FullTime:
      if (m.phaseTimer <= 0) resetMatch(world);
      break;
  }
}

export function blowWhistle(world: World, kind: 'kickoff' | 'goal' | 'foul' | 'fulltime'): void {
  world.referee.whistle = 0.8;
  world.events.push({ t: 'whistle', kind });
}

/** Fresh match, same teams. Rooms run back-to-back games. */
export function resetMatch(world: World): void {
  const m = world.match;
  m.score = [0, 0];
  m.clock = world.config.matchSeconds;
  m.duration = world.config.matchSeconds;
  m.lastScorer = -1;
  m.lastScorerTeam = -1;
  m.goalCount = 0;
  for (const p of world.players) {
    p.powerup = 0;
    p.powerupTimer = 0;
    p.stamina = 1;
  }
  resetForKickoff(world, 0);
  m.phase = MatchPhase.Warmup;
  m.phaseTimer = 2.5;
}

/** Did the ball fully cross a goal line inside the frame this tick? */
export function checkGoal(world: World, prev: Vec3): void {
  const m = world.match;
  if (m.phase !== MatchPhase.Play && m.phase !== MatchPhase.Kickoff && m.phase !== MatchPhase.FreeKick) {
    return;
  }
  const scoring = crossedGoalLine(world, prev);
  if (scoring < 0) return;

  const team = scoring as Team;
  m.score[team] += 1;
  m.goalCount += 1;
  m.phase = MatchPhase.GoalCelebration;
  m.phaseTimer = GOAL_CELEBRATION;

  // Credit the last player from the scoring team to touch it; own goals keep
  // the toucher but are attributed to the other side on the scoreboard.
  const lastTouch = world.ball.lastTouch;
  m.lastScorer = lastTouch;
  m.lastScorerTeam = team;

  const power = len2(world.ball.vel.x, world.ball.vel.z) / 30;
  world.events.push({ t: 'goal', team, scorer: lastTouch, power: clamp(power, 0, 1.5) });
  blowWhistle(world, 'goal');

  for (const p of world.players) {
    if (p.team === team) {
      p.act = PlayerAct.Celebrate;
      p.actTimer = GOAL_CELEBRATION;
    } else {
      p.act = PlayerAct.Idle;
      p.actTimer = 0;
    }
  }
}

/**
 * Turn foul events raised by the tackle code into a free kick: whistle, ball on
 * the spot, and the offending side backed off.
 */
export function processFouls(world: World): void {
  if (world.match.phase !== MatchPhase.Play) return;
  const foul = world.events.find((e) => e.t === 'foul');
  if (!foul || foul.t !== 'foul') return;

  const victim = world.players.find((p) => p.id === foul.victim);
  const offender = world.players.find((p) => p.id === foul.player);
  if (!victim || !offender) return;

  const x = clamp(victim.pos.x, -HALF_LENGTH + 3, HALF_LENGTH - 3);
  const z = clamp(victim.pos.z, -HALF_WIDTH + 3, HALF_WIDTH - 3);
  resetForFreeKick(world, victim.team, x, z);
  world.match.phaseTimer = FREE_KICK_DELAY;
  blowWhistle(world, 'foul');

  // Back the offending team out of the restart radius.
  for (const p of teamPlayers(world, offender.team)) {
    const d = dist2(p.pos, { x, z });
    if (d >= FREE_KICK_WALL_DISTANCE) continue;
    const dx = p.pos.x - x;
    const dz = p.pos.z - z;
    const len = Math.hypot(dx, dz) || 1;
    p.pos.x = clamp(x + (dx / len) * FREE_KICK_WALL_DISTANCE, -HALF_LENGTH + PLAYER_RADIUS, HALF_LENGTH - PLAYER_RADIUS);
    p.pos.z = clamp(z + (dz / len) * FREE_KICK_WALL_DISTANCE, -HALF_WIDTH + PLAYER_RADIUS, HALF_WIDTH - PLAYER_RADIUS);
    p.vel.x = 0;
    p.vel.z = 0;
  }
}

/** Seconds of the ball going nowhere before the referee steps in. */
const STALL_LIMIT = 7;
const STALL_RADIUS = 2.5;

/**
 * Nobody gets to kill a five minute game by standing on the ball in the corner.
 * If play has not moved for a while the referee restarts it with the other side
 * on the ball - the football equivalent of a shot clock.
 */
export function updateStallWatchdog(world: World): void {
  const s = world.stall;
  if (world.match.phase !== MatchPhase.Play) {
    s.timer = 0;
    s.x = world.ball.pos.x;
    s.z = world.ball.pos.z;
    return;
  }
  if (dist2(world.ball.pos, { x: s.x, z: s.z }) > STALL_RADIUS) {
    s.timer = 0;
    s.x = world.ball.pos.x;
    s.z = world.ball.pos.z;
    return;
  }
  s.timer += 1 / 60;
  if (s.timer < STALL_LIMIT) return;

  const holder = world.ball.owner >= 0 ? world.players.find((p) => p.id === world.ball.owner) : undefined;
  const guilty = holder?.team ?? (world.ball.lastTouchTeam >= 0 ? world.ball.lastTouchTeam : 0);
  const awardTo: Team = guilty === 0 ? 1 : 0;
  const x = clamp(world.ball.pos.x, -HALF_LENGTH + 6, HALF_LENGTH - 6);
  const z = clamp(world.ball.pos.z, -HALF_WIDTH + 5, HALF_WIDTH - 5);
  resetForFreeKick(world, awardTo, x, z);
  world.match.phaseTimer = FREE_KICK_DELAY;
  blowWhistle(world, 'foul');
  for (const p of teamPlayers(world, guilty as Team)) {
    if (dist2(p.pos, { x, z }) >= FREE_KICK_WALL_DISTANCE) continue;
    const dx = p.pos.x - x;
    const dz = p.pos.z - z;
    const len = Math.hypot(dx, dz) || 1;
    p.pos.x = clamp(x + (dx / len) * FREE_KICK_WALL_DISTANCE, -HALF_LENGTH + PLAYER_RADIUS, HALF_LENGTH - PLAYER_RADIUS);
    p.pos.z = clamp(z + (dz / len) * FREE_KICK_WALL_DISTANCE, -HALF_WIDTH + PLAYER_RADIUS, HALF_WIDTH - PLAYER_RADIUS);
  }
  s.timer = 0;
  s.x = x;
  s.z = z;
}

/**
 * The man in the middle. He keeps a diagonal on the play, stays out of the
 * passing lanes, and blows for the big moments.
 */
export function updateReferee(world: World, dt: number): void {
  const ref = world.referee;
  ref.whistle = Math.max(0, ref.whistle - dt);
  const b = world.ball;
  const targetX = clamp(b.pos.x * 0.85, -HALF_LENGTH + 8, HALF_LENGTH - 8);
  const targetZ = clamp(b.pos.z + 9, -HALF_WIDTH + 2.5, HALF_WIDTH - 2.5);
  const k = damp(1.6, dt);
  const dx = targetX - ref.pos.x;
  const dz = targetZ - ref.pos.z;
  ref.pos.x += dx * k;
  ref.pos.z += dz * k;
  if (Math.abs(dx) + Math.abs(dz) > 0.3) {
    ref.facing = Math.atan2(b.pos.x - ref.pos.x, b.pos.z - ref.pos.z);
  }
}
