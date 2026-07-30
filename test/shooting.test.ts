import assert from 'node:assert/strict';
import test from 'node:test';

import { BALL_RADIUS, GOAL_HALF_WIDTH, GOAL_HEIGHT, HALF_LENGTH, TICK_DT } from '@shared/constants.js';
import { headingOf } from '@shared/math.js';
import { MatchPhase, Role, type World } from '@shared/types.js';
import { createWorld, doShot, doPass, stepWorld, clearEvents } from '@shared/sim/index.js';

/** Put the world in open play with one shooter standing over the ball. */
function setupShooter(world: World, x: number, z: number, facing: number): void {
  world.match.phase = MatchPhase.Play;
  world.match.phaseTimer = 0;
  const shooter = world.players.find((p) => p.team === 0 && p.role !== Role.Keeper)!;
  // Park everyone else out of the way so nothing deflects the ball.
  for (const p of world.players) {
    p.pos.x = p.team === 0 ? -HALF_LENGTH + 2 : -HALF_LENGTH + 5;
    p.pos.z = (p.id % 5) * 3 - 20;
    p.vel.x = 0;
    p.vel.z = 0;
  }
  shooter.pos.x = x;
  shooter.pos.z = z;
  shooter.facing = facing;
  world.ball.pos = { x, y: BALL_RADIUS, z };
  world.ball.vel = { x: 0, y: 0, z: 0 };
  world.ball.spin = { x: 0, y: 0, z: 0 };
  world.ball.owner = shooter.id;
}

function angleBetween(a: number, b: number): number {
  return Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
}

test('a shot leaves within a few degrees of where the player is facing', () => {
  for (const [x, z] of [
    [20, 0],
    [10, 12],
    [25, -18],
    [-5, 6],
  ]) {
    const world = createWorld({ teamSize: 5 }, 42);
    const aim = headingOf(HALF_LENGTH - x, 0 - z); // straight at the goal centre
    setupShooter(world, x, z, aim);
    const shooter = world.players.find((p) => p.team === 0 && p.role !== Role.Keeper)!;
    doShot(world, shooter, 0.7);
    const velHeading = headingOf(world.ball.vel.x, world.ball.vel.z);
    const off = angleBetween(velHeading, aim);
    assert.ok(
      off < 0.12,
      `shot from (${x}, ${z}) left ${(off * 57.3).toFixed(1)} degrees off the aim`,
    );
  }
});

test('a well struck shot from 18m reaches the goal on target', () => {
  const world = createWorld({ teamSize: 5 }, 7);
  const x = HALF_LENGTH - 18;
  setupShooter(world, x, 0, headingOf(HALF_LENGTH - x, 0));
  // Take the keeper out of it entirely - this is about ball flight.
  const keeper = world.players.find((p) => p.team === 1 && p.role === Role.Keeper)!;
  keeper.pos.z = 40;
  const shooter = world.players.find((p) => p.team === 0 && p.role !== Role.Keeper)!;
  doShot(world, shooter, 0.7);

  let scored = false;
  for (let i = 0; i < 180 && !scored; i++) {
    clearEvents(world);
    stepWorld(world, new Map(), TICK_DT);
    scored = world.events.some((e) => e.t === 'goal');
  }
  assert.ok(scored, 'shot from 18m down the middle should find the net');
});

test('a shot that is charged harder travels faster', () => {
  const speeds: number[] = [];
  for (const charge of [0.2, 0.6, 1]) {
    const world = createWorld({ teamSize: 5 }, 3);
    setupShooter(world, 20, 0, headingOf(1, 0));
    const shooter = world.players.find((p) => p.team === 0 && p.role !== Role.Keeper)!;
    doShot(world, shooter, charge);
    speeds.push(Math.hypot(world.ball.vel.x, world.ball.vel.y, world.ball.vel.z));
  }
  assert.ok(speeds[0] < speeds[1] && speeds[1] < speeds[2], `speeds not increasing: ${speeds}`);
});

test('a pass finds a team-mate rather than the nearest opponent', () => {
  const world = createWorld({ teamSize: 5 }, 11);
  world.match.phase = MatchPhase.Play;
  world.match.phaseTimer = 0;
  const passer = world.players.find((p) => p.team === 0 && p.role === Role.Midfielder)!;
  const mate = world.players.find((p) => p.team === 0 && p.role === Role.Striker)!;
  for (const p of world.players) {
    p.pos.x = -30;
    p.pos.z = 20;
  }
  passer.pos.x = 0;
  passer.pos.z = 0;
  mate.pos.x = 14;
  mate.pos.z = 3;
  passer.facing = headingOf(mate.pos.x - passer.pos.x, mate.pos.z - passer.pos.z);
  world.ball.pos = { x: 0, y: BALL_RADIUS, z: 0 };
  world.ball.vel = { x: 0, y: 0, z: 0 };
  world.ball.owner = passer.id;

  doPass(world, passer, 0.5);
  const heading = headingOf(world.ball.vel.x, world.ball.vel.z);
  const wanted = headingOf(mate.pos.x, mate.pos.z);
  assert.ok(angleBetween(heading, wanted) < 0.3, 'pass should travel toward the team-mate');
  assert.ok(world.ball.owner === -1, 'the ball is loose once it is struck');
});

test('the goal frame is where the rules say it is', () => {
  // A ball rolled dead centre over the line is a goal; one outside the post is not.
  for (const [z, expectGoal] of [
    [0, true],
    [GOAL_HALF_WIDTH - 1, true],
    [GOAL_HALF_WIDTH + 2, false],
  ] as [number, boolean][]) {
    const world = createWorld({ teamSize: 5 }, 5);
    world.match.phase = MatchPhase.Play;
    world.match.phaseTimer = 0;
    for (const p of world.players) {
      p.pos.x = -HALF_LENGTH + 4;
      p.pos.z = -20;
    }
    world.ball.pos = { x: HALF_LENGTH - 3, y: GOAL_HEIGHT * 0.4, z };
    world.ball.vel = { x: 22, y: 0, z: 0 };
    world.ball.owner = -1;
    let scored = false;
    for (let i = 0; i < 60 && !scored; i++) {
      clearEvents(world);
      stepWorld(world, new Map(), TICK_DT);
      scored = world.events.some((e) => e.t === 'goal');
    }
    assert.equal(scored, expectGoal, `ball at z=${z} scored=${scored}`);
  }
});
