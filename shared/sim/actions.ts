import {
  BALL_RADIUS,
  CONTROL_RADIUS,
  GOAL_HALF_WIDTH,
  KICK_ANIM_TIME,
  LOB_ANGLE,
  LOB_SPEED_MAX,
  LOB_SPEED_MIN,
  PASS_SPEED_MAX,
  PASS_SPEED_MIN,
  SHOT_AIM_ASSIST,
  SHOT_LIFT_MAX,
  SHOT_SPEED_MAX,
  SHOT_SPEED_MIN,
  SHOULDER_IMPULSE,
  SLIDE_DURATION,
  STUN_TIME,
  TACKLE_COOLDOWN,
  TACKLE_RANGE,
  THROUGH_PASS_LEAD,
  TOUCH_COOLDOWN,
} from '../constants.js';
import { Rng, clamp, dirFromHeading, dist2, len2, lerp, normalize2 } from '../math.js';
import { PlayerAct, Role, type PlayerState, type World } from '../types.js';
import { attackDir, targetGoalX } from './formation.js';
import { passMul, powerMul, strengthMul } from './stats.js';

export function setAct(p: PlayerState, act: PlayerAct, time: number): void {
  p.act = act;
  p.actTimer = time;
}

export function markKick(p: PlayerState, power: number): void {
  p.kickFx = clamp(power, 0.05, 1);
  setAct(p, PlayerAct.Kick, KICK_ANIM_TIME);
}

function rngOf(world: World): Rng {
  const r = new Rng(world.rngState);
  return r;
}
function saveRng(world: World, r: Rng): void {
  world.rngState = r.state;
}

/** Ball close enough to strike (includes low volleys, not head height). */
export function canReachBall(world: World, p: PlayerState): boolean {
  const b = world.ball;
  if (b.pos.y > 2.4) return false;
  return dist2(p.pos, b.pos) < CONTROL_RADIUS * 1.2 + BALL_RADIUS;
}

interface KickOpts {
  dirX: number;
  dirZ: number;
  speed: number;
  lift: number; // vertical velocity component
  spinY: number;
  cooldown: number;
}

function applyKick(world: World, p: PlayerState, o: KickOpts): void {
  const b = world.ball;
  b.vel.x = o.dirX * o.speed;
  b.vel.z = o.dirZ * o.speed;
  b.vel.y = o.lift;
  b.spin.y = o.spinY;
  b.spin.x = 0;
  b.spin.z = 0;
  // Lift the ball off the deck a hair so it does not immediately clip the turf.
  if (o.lift > 0.5) b.pos.y = Math.max(b.pos.y, BALL_RADIUS + 0.05);
  b.owner = -1;
  b.lastTouch = p.id;
  b.lastTouchTeam = p.team;
  b.sinceKick = 0;
  p.kickCooldown = o.cooldown;
  p.touchCooldown = TOUCH_COOLDOWN;
}

/** Sideways velocity at the moment of striking becomes curve on the ball. */
function curveFrom(p: PlayerState, dirX: number, dirZ: number, scale: number): number {
  const perp = p.vel.x * dirZ - p.vel.z * dirX;
  return clamp(perp * scale, -34, 34);
}

// --- Passing ----------------------------------------------------------------

export interface PassTarget {
  player: PlayerState;
  aimX: number;
  aimZ: number;
  score: number;
}

/**
 * Pick who the pass is meant for. Heavily weighted toward whoever the player is
 * facing, then by how useful the pass is (forward, clean lane, sensible range).
 */
export function pickPassTarget(
  world: World,
  p: PlayerState,
  charge: number,
  loft = false,
): PassTarget | null {
  const face = dirFromHeading(p.facing);
  const dir = attackDir(p.team);
  let best: PassTarget | null = null;

  for (const mate of world.players) {
    if (mate.id === p.id || mate.team !== p.team) continue;
    if (mate.role === Role.Keeper && dir * (mate.pos.x - p.pos.x) < -20) continue;
    const dx = mate.pos.x - p.pos.x;
    const dz = mate.pos.z - p.pos.z;
    const d = len2(dx, dz);
    if (d < 2.5 || d > 55) continue;
    const nx = dx / d;
    const nz = dz / d;
    const align = nx * face.x + nz * face.z; // -1..1
    // You can recycle the ball sideways or slightly backwards, it just scores
    // worse than playing forward.
    if (align < -0.35) continue;

    // Lead the pass: further ahead the harder it is hit (through ball).
    const flight = d / lerp(PASS_SPEED_MIN, PASS_SPEED_MAX, charge);
    const lead = charge * THROUGH_PASS_LEAD;
    const aimX = mate.pos.x + mate.vel.x * flight * 0.8 + dir * lead;
    const aimZ = mate.pos.z + mate.vel.z * flight * 0.8;

    let score = (align + 0.35) * 2.4 + clamp(1 - Math.abs(d - 16) / 34, 0, 1) * 1.2;
    score += clamp((dx * dir) / 24, -0.6, 1.1); // forward passes are worth more
    if (!loft) score -= laneRisk(world, p, aimX, aimZ) * 2.2;
    if (mate.role === Role.Keeper) score -= 1.4;

    if (!best || score > best.score) best = { player: mate, aimX, aimZ, score };
  }
  return best;
}

/** 0 = clean lane, 1 = an opponent is sitting right in it. */
export function laneRisk(world: World, from: PlayerState, toX: number, toZ: number): number {
  const dx = toX - from.pos.x;
  const dz = toZ - from.pos.z;
  const len = len2(dx, dz);
  if (len < 0.5) return 0;
  const nx = dx / len;
  const nz = dz / len;
  let risk = 0;
  for (const o of world.players) {
    if (o.team === from.team) continue;
    const ox = o.pos.x - from.pos.x;
    const oz = o.pos.z - from.pos.z;
    const along = ox * nx + oz * nz;
    if (along < 0.5 || along > len) continue;
    const off = Math.abs(ox * nz - oz * nx);
    // Opponents can step across, so account for a bit of reach.
    const reach = 1.8 + Math.min(2.5, along * 0.09);
    if (off < reach) risk = Math.max(risk, 1 - off / reach);
  }
  return risk;
}

export function doPass(world: World, p: PlayerState, charge: number): void {
  const rng = rngOf(world);
  const target = pickPassTarget(world, p, charge);
  const face = dirFromHeading(p.facing);
  let dirX = face.x;
  let dirZ = face.z;
  let speed = lerp(PASS_SPEED_MIN, PASS_SPEED_MAX, charge) * passMul(p);

  if (target) {
    const dx = target.aimX - p.pos.x;
    const dz = target.aimZ - p.pos.z;
    const d = len2(dx, dz) || 1;
    dirX = dx / d;
    dirZ = dz / d;
    // Weight the pass to arrive rather than blast through: solve for distance.
    const wanted = Math.sqrt(Math.max(4, d) * 2 * 8.5);
    speed = clamp(wanted * passMul(p), PASS_SPEED_MIN * 0.8, PASS_SPEED_MAX * 1.15);
    if (charge > 0.75) speed *= 1.12; // driven through ball
  }

  // Accuracy: worse on the turn and at pace, better with Vision.
  const hurry = clamp(len2(p.vel.x, p.vel.z) / 10, 0, 1);
  const err = ((rng.next() - 0.5) * (0.055 + hurry * 0.075)) / passMul(p);
  const cos = Math.cos(err);
  const sin = Math.sin(err);
  const rx = dirX * cos - dirZ * sin;
  const rz = dirX * sin + dirZ * cos;

  applyKick(world, p, {
    dirX: rx,
    dirZ: rz,
    speed,
    lift: charge > 0.8 ? 0.4 : 0,
    spinY: curveFrom(p, rx, rz, 1.6),
    cooldown: 0.26,
  });
  markKick(p, charge);
  world.events.push({ t: 'kick', kind: 'pass', player: p.id, power: charge });
  saveRng(world, rng);
}

export function doLob(world: World, p: PlayerState, charge: number): void {
  const rng = rngOf(world);
  const target = pickPassTarget(world, p, charge, true);
  const face = dirFromHeading(p.facing);
  let dirX = face.x;
  let dirZ = face.z;
  let speed = lerp(LOB_SPEED_MIN, LOB_SPEED_MAX, charge);

  if (target) {
    const dx = target.aimX - p.pos.x;
    const dz = target.aimZ - p.pos.z;
    const d = len2(dx, dz) || 1;
    dirX = dx / d;
    dirZ = dz / d;
    // Ballistic solve for the launch angle so chips actually land on the head.
    const g = 16.5;
    const angle = LOB_ANGLE;
    const v = Math.sqrt((g * d) / Math.sin(2 * angle));
    speed = clamp(v, LOB_SPEED_MIN * 0.7, LOB_SPEED_MAX * 1.2);
  }

  const err = (rng.next() - 0.5) * 0.09;
  const cos = Math.cos(err);
  const sin = Math.sin(err);
  const rx = dirX * cos - dirZ * sin;
  const rz = dirX * sin + dirZ * cos;

  const horiz = speed * Math.cos(LOB_ANGLE);
  const vert = speed * Math.sin(LOB_ANGLE);
  applyKick(world, p, {
    dirX: rx,
    dirZ: rz,
    speed: horiz,
    lift: vert,
    spinY: curveFrom(p, rx, rz, 1.1),
    cooldown: 0.3,
  });
  markKick(p, charge);
  world.events.push({ t: 'kick', kind: 'lob', player: p.id, power: charge });
  saveRng(world, rng);
}

// --- Shooting ---------------------------------------------------------------

/** Aim at the corner the keeper is not covering. */
export function shotAimZ(world: World, p: PlayerState): number {
  const keeper = world.players.find((k) => k.team !== p.team && k.role === Role.Keeper);
  const limit = GOAL_HALF_WIDTH - 1.1;
  if (!keeper) return 0;
  const side = keeper.pos.z >= 0 ? -1 : 1;
  return clamp(side * limit * 0.85, -limit, limit);
}

export function doShot(world: World, p: PlayerState, charge: number): void {
  const rng = rngOf(world);
  const goalX = targetGoalX(p.team);
  const aimZ = shotAimZ(world, p);
  const face = dirFromHeading(p.facing);

  const dgx = goalX - p.pos.x;
  const dgz = aimZ - p.pos.z;
  const dg = len2(dgx, dgz) || 1;
  const gx = dgx / dg;
  const gz = dgz / dg;

  // Aim assist only helps when you are already pointed goalwards; turn your
  // back and you will hoof it wherever you are facing.
  const align = clamp(face.x * gx + face.z * gz, 0, 1);
  const assist = SHOT_AIM_ASSIST * align * align;
  let dirX = face.x * (1 - assist) + gx * assist;
  let dirZ = face.z * (1 - assist) + gz * assist;
  const n = normalize2(dirX, dirZ);
  dirX = n.x;
  dirZ = n.z;

  const speed = lerp(SHOT_SPEED_MIN, SHOT_SPEED_MAX, charge) * powerMul(p);
  // Tap = drilled along the deck, hold = it climbs.
  const liftFrac = SHOT_LIFT_MAX * Math.pow(charge, 1.6);
  const lift = speed * liftFrac;

  const scuff = ((rng.next() - 0.5) * (0.05 + (1 - align) * 0.1)) / (0.8 + charge * 0.4);
  const cos = Math.cos(scuff);
  const sin = Math.sin(scuff);
  const rx = dirX * cos - dirZ * sin;
  const rz = dirX * sin + dirZ * cos;

  applyKick(world, p, {
    dirX: rx,
    dirZ: rz,
    speed,
    lift,
    spinY: curveFrom(p, rx, rz, 2.4),
    cooldown: 0.34,
  });
  markKick(p, charge);
  world.events.push({ t: 'kick', kind: 'shot', player: p.id, power: charge });

  // Rough shot-on-target check so the crowd can gasp in the right places.
  if (dg < 34 && align > 0.55) world.events.push({ t: 'chance', team: p.team });
  saveRng(world, rng);
}

/** Keeper punts and desperation clearances. */
export function kickLoose(world: World, p: PlayerState, dirX: number, dirZ: number, speed: number, lift: number): void {
  applyKick(world, p, { dirX, dirZ, speed, lift, spinY: 0, cooldown: 0.4 });
  markKick(p, 0.8);
  world.events.push({ t: 'kick', kind: 'clear', player: p.id, power: 0.8 });
}

// --- Tackling ---------------------------------------------------------------

export function startSlide(world: World, p: PlayerState): void {
  const v = normalize2(p.vel.x, p.vel.z);
  const face = dirFromHeading(p.facing);
  p.slideX = v.x || face.x;
  p.slideZ = v.z || face.z;
  setAct(p, PlayerAct.Slide, SLIDE_DURATION);
  p.tackleCooldown = TACKLE_COOLDOWN + SLIDE_DURATION;
  world.events.push({ t: 'tackle', kind: 'slide', player: p.id, won: false });
}

/**
 * Standing challenge: barge the nearest opponent in front of you and try to
 * knock the ball off them.
 */
export function tryShoulder(world: World, p: PlayerState): void {
  const rng = rngOf(world);
  setAct(p, PlayerAct.Tackle, 0.28);
  p.tackleCooldown = TACKLE_COOLDOWN;

  const face = dirFromHeading(p.facing);
  let victim: PlayerState | null = null;
  let bestD = TACKLE_RANGE;
  for (const o of world.players) {
    if (o.team === p.team || o.act === PlayerAct.Stunned) continue;
    const dx = o.pos.x - p.pos.x;
    const dz = o.pos.z - p.pos.z;
    const d = len2(dx, dz);
    if (d > bestD || d < 1e-4) continue;
    if ((dx / d) * face.x + (dz / d) * face.z < 0.35) continue;
    victim = o;
    bestD = d;
  }

  let won = false;
  if (victim) {
    const dx = victim.pos.x - p.pos.x;
    const dz = victim.pos.z - p.pos.z;
    const d = len2(dx, dz) || 1;
    const ratio = strengthMul(p) / strengthMul(victim);
    const push = SHOULDER_IMPULSE * clamp(ratio, 0.5, 2);
    victim.vel.x += (dx / d) * push;
    victim.vel.z += (dz / d) * push;
    p.vel.x -= (dx / d) * push * 0.35;
    p.vel.z -= (dz / d) * push * 0.35;
    if (world.ball.owner === victim.id && rng.next() < clamp(0.45 * ratio, 0.15, 0.9)) {
      world.ball.owner = -1;
      victim.touchCooldown = 0.55;
      world.ball.vel.x += (dx / d) * 3.5;
      world.ball.vel.z += (dz / d) * 3.5;
      won = true;
    }
    if (rng.next() < 0.25 * clamp(ratio, 0.4, 2)) {
      setAct(victim, PlayerAct.Stunned, STUN_TIME * 0.6);
    }
  } else if (canReachBall(world, p) && world.ball.owner !== p.id) {
    // Poke tackle on a loose ball.
    world.ball.vel.x += face.x * 6;
    world.ball.vel.z += face.z * 6;
    world.ball.lastTouch = p.id;
    world.ball.lastTouchTeam = p.team;
    won = true;
  }

  world.events.push({ t: 'tackle', kind: 'shoulder', player: p.id, won });
  saveRng(world, rng);
}

/**
 * Resolve sliding players against the ball and against opponents. Winning the
 * ball first is clean; taking the man is a foul.
 */
export function resolveSlides(world: World, dt: number): void {
  const rng = rngOf(world);
  for (const p of world.players) {
    if (p.act !== PlayerAct.Slide) continue;
    const b = world.ball;

    // Ball first.
    if (dist2(p.pos, b.pos) < 1.9 && b.pos.y < 1.4) {
      const dirX = p.slideX;
      const dirZ = p.slideZ;
      const owner = b.owner;
      b.owner = -1;
      b.lastTouch = p.id;
      b.lastTouchTeam = p.team;
      b.sinceKick = 0;
      const power = 9 + strengthMul(p) * 3;
      b.vel.x = dirX * power + b.vel.x * 0.2;
      b.vel.z = dirZ * power + b.vel.z * 0.2;
      b.vel.y = Math.max(b.vel.y, 2.2);
      p.touchCooldown = 0.5;
      if (owner >= 0 && owner !== p.id) {
        const victim = world.players.find((x) => x.id === owner);
        if (victim) victim.touchCooldown = 0.6;
        world.events.push({ t: 'tackle', kind: 'slide', player: p.id, won: true });
      }
      // Having played the ball, the slide cannot foul any more this attempt.
      p.slideX = 0;
      p.slideZ = 0;
      continue;
    }

    // Then bodies.
    for (const o of world.players) {
      if (o.team === p.team || o.act === PlayerAct.Stunned) continue;
      if (dist2(p.pos, o.pos) > 1.5) continue;
      setAct(o, PlayerAct.Stunned, STUN_TIME);
      o.vel.x += p.slideX * 4;
      o.vel.z += p.slideZ * 4;
      if (world.ball.owner === o.id) {
        world.ball.owner = -1;
        o.touchCooldown = 0.6;
      }
      // Clipping a man without the ball is a foul.
      if (rng.next() < 0.85) {
        world.events.push({ t: 'foul', player: p.id, victim: o.id });
      }
      setAct(p, PlayerAct.Stunned, 0.6);
      break;
    }
  }
  saveRng(world, rng);
  void dt;
}
