import assert from 'node:assert/strict';
import test from 'node:test';

import { BALL_RADIUS, HALF_LENGTH, TICK_DT, TICK_RATE } from '@shared/constants.js';
import { headingOf } from '@shared/math.js';
import { BTN, MatchPhase, PlayerAct, Role, emptyInput, type PlayerInput, type World } from '@shared/types.js';
import { clearEvents, createWorld, stepWorld } from '@shared/sim/index.js';

/**
 * These drive the same path a human does - held buttons in, charge accumulated
 * by the server, kick fired on release - rather than calling doShot directly.
 */

function openPlay(seed = 5): World {
  const world = createWorld({ teamSize: 5 }, seed);
  world.match.phase = MatchPhase.Play;
  world.match.phaseTimer = 0;
  return world;
}

/** Park everyone well away so a test has the pitch to itself. */
function clearPitch(world: World, except: number[]): void {
  let i = 0;
  for (const p of world.players) {
    if (except.includes(p.id)) continue;
    p.pos.x = -HALF_LENGTH + 2;
    p.pos.z = -20 + i++ * 2.5;
    p.vel.x = 0;
    p.vel.z = 0;
  }
}

function run(world: World, ticks: number, input: PlayerInput, id: number): void {
  const map = new Map<number, PlayerInput>();
  for (let i = 0; i < ticks; i++) {
    input.seq++;
    map.set(id, input);
    clearEvents(world);
    stepWorld(world, map, TICK_DT);
  }
}

test('holding and releasing shoot puts the ball in the net', () => {
  const world = openPlay();
  const striker = world.players.find((p) => p.team === 0 && p.role === Role.Striker)!;
  clearPitch(world, [striker.id]);
  const keeper = world.players.find((p) => p.team === 1 && p.role === Role.Keeper)!;
  keeper.pos.z = 30; // keeper out of the picture; this is about the input path

  striker.pos.x = HALF_LENGTH - 16;
  striker.pos.z = 0;
  striker.facing = headingOf(1, 0);
  world.ball.pos = { x: striker.pos.x + 1, y: BALL_RADIUS, z: 0 };
  world.ball.vel = { x: 0, y: 0, z: 0 };
  world.ball.owner = striker.id;

  // Hold the shoot button for half a second, aiming at the goal.
  const aim = headingOf(1, 0);
  const holding: PlayerInput = { ...emptyInput(1), buttons: BTN.SHOOT, aim };
  run(world, Math.round(0.5 * TICK_RATE), holding, striker.id);
  assert.ok(world.ball.owner === striker.id, 'still has the ball while charging');

  // Let go: the kick fires on the release edge.
  const released: PlayerInput = { ...emptyInput(100), buttons: 0, aim };
  clearEvents(world);
  stepWorld(world, new Map([[striker.id, released]]), TICK_DT);
  const shot = world.events.find((e) => e.t === 'kick' && e.kind === 'shot');
  assert.ok(shot, 'releasing shoot fires a shot');
  assert.ok(world.ball.vel.x > 15, `ball should be travelling, got ${world.ball.vel.x}`);

  let scored = false;
  for (let i = 0; i < 120 && !scored; i++) {
    clearEvents(world);
    stepWorld(world, new Map([[striker.id, released]]), TICK_DT);
    scored = world.events.some((e) => e.t === 'goal');
  }
  assert.ok(scored, 'the shot should find the net');
});

test('a longer hold hits the ball harder', () => {
  const speeds: number[] = [];
  for (const holdTicks of [4, 20, 55]) {
    const world = openPlay(11);
    const striker = world.players.find((p) => p.team === 0 && p.role === Role.Striker)!;
    clearPitch(world, [striker.id]);
    striker.pos.x = 0;
    striker.pos.z = 0;
    striker.facing = headingOf(1, 0);
    world.ball.pos = { x: 1, y: BALL_RADIUS, z: 0 };
    world.ball.vel = { x: 0, y: 0, z: 0 };
    world.ball.owner = striker.id;

    const aim = headingOf(1, 0);
    run(world, holdTicks, { ...emptyInput(1), buttons: BTN.SHOOT, aim }, striker.id);
    clearEvents(world);
    stepWorld(world, new Map([[striker.id, { ...emptyInput(999), buttons: 0, aim }]]), TICK_DT);
    speeds.push(Math.hypot(world.ball.vel.x, world.ball.vel.y, world.ball.vel.z));
  }
  assert.ok(speeds[0] < speeds[1] && speeds[1] < speeds[2], `charge did not scale: ${speeds}`);
});

test('sprinting into a tackle press becomes a sliding tackle', () => {
  const world = openPlay(19);
  const chaser = world.players.find((p) => p.team === 0 && p.role === Role.Midfielder)!;
  clearPitch(world, [chaser.id]);
  chaser.pos.x = 0;
  chaser.pos.z = 0;

  const aim = headingOf(1, 0);
  // Get up to sprinting speed first.
  run(world, 40, { ...emptyInput(1), moveX: 1, buttons: BTN.SPRINT, aim }, chaser.id);
  assert.ok(Math.hypot(chaser.vel.x, chaser.vel.z) > 7, 'should be at pace');

  clearEvents(world);
  stepWorld(
    world,
    new Map([[chaser.id, { ...emptyInput(500), moveX: 1, buttons: BTN.SPRINT | BTN.TACKLE, aim }]]),
    TICK_DT,
  );
  assert.equal(chaser.act, PlayerAct.Slide, 'sprint + tackle slides');
  const ev = world.events.find((e) => e.t === 'tackle');
  assert.ok(ev && ev.t === 'tackle' && ev.kind === 'slide');
});

test('a standing tackle press is a shoulder challenge, not a slide', () => {
  const world = openPlay(23);
  const defender = world.players.find((p) => p.team === 0 && p.role === Role.Defender)!;
  const attacker = world.players.find((p) => p.team === 1 && p.role === Role.Striker)!;
  clearPitch(world, [defender.id, attacker.id]);
  defender.pos.x = 0;
  defender.pos.z = 0;
  defender.facing = headingOf(1, 0);
  attacker.pos.x = 1.5;
  attacker.pos.z = 0;
  // Keep the ball out of it, or the press becomes a shield instead.
  world.ball.pos = { x: -30, y: BALL_RADIUS, z: 20 };
  world.ball.owner = -1;

  const before = attacker.vel.x;
  clearEvents(world);
  stepWorld(
    world,
    new Map([[defender.id, { ...emptyInput(1), buttons: BTN.TACKLE, aim: headingOf(1, 0) }]]),
    TICK_DT,
  );
  assert.equal(defender.act, PlayerAct.Tackle);
  assert.ok(attacker.vel.x > before, 'the challenge should shove them');
});

test('players cannot act until the whistle at a restart', () => {
  const world = createWorld({ teamSize: 5 }, 31);
  world.match.phase = MatchPhase.Kickoff;
  world.match.phaseTimer = 1;
  const striker = world.players.find((p) => p.team === 0 && p.role === Role.Striker)!;
  const startX = striker.pos.x;

  run(world, 30, { ...emptyInput(1), moveX: 1, moveZ: 1, buttons: BTN.SPRINT, aim: 0 }, striker.id);
  assert.ok(Math.abs(striker.pos.x - startX) < 0.2, 'nobody moves before the whistle');

  // Once the timer runs out play begins and the same input moves them. The
  // kickoff timer still has half a second on it, hence the longer run.
  run(world, 90, { ...emptyInput(60), moveX: 1, moveZ: 0, buttons: 0, aim: 0 }, striker.id);
  assert.ok(striker.pos.x > startX + 1, 'and moves once play is underway');
});
