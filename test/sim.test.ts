import assert from 'node:assert/strict';
import test from 'node:test';

import { HALF_LENGTH, HALF_WIDTH, TICK_DT, TICK_RATE, GOAL_DEPTH } from '@shared/constants.js';
import { decodeInputBatch, decodeSnapshot, encodeInputBatch, encodeSnapshot } from '@shared/protocol.js';
import { MatchPhase, emptyInput, type PlayerInput, type World } from '@shared/types.js';
import { clearEvents, createWorld, stepWorld } from '@shared/sim/index.js';
import { BotBrain } from '../server/ai/bot.js';

function runBotMatch(
  seconds: number,
  seed = 1234,
  wallSeconds = seconds,
): { world: World; goals: number; shots: number } {
  const world = createWorld({ matchSeconds: seconds, teamSize: 5 }, seed);
  const brains = new Map<number, BotBrain>();
  for (const p of world.players) brains.set(p.id, new BotBrain(p.id, seed ^ (p.id * 2654435761)));

  let goals = 0;
  let shots = 0;
  const ticks = Math.round(wallSeconds * TICK_RATE);
  for (let i = 0; i < ticks; i++) {
    clearEvents(world);
    const inputs = new Map<number, PlayerInput>();
    for (const p of world.players) {
      const brain = brains.get(p.id);
      if (brain) inputs.set(p.id, brain.think(world, p, TICK_DT));
    }
    stepWorld(world, inputs, TICK_DT);
    goals += world.events.filter((e) => e.t === 'goal').length;
    shots += world.events.filter((e) => e.t === 'kick' && e.kind === 'shot').length;

    assert.ok(Number.isFinite(world.ball.pos.x), 'ball x is finite');
    assert.ok(Number.isFinite(world.ball.pos.y), 'ball y is finite');
    assert.ok(Math.abs(world.ball.pos.x) < HALF_LENGTH + GOAL_DEPTH + 1, 'ball stays on the map');
    assert.ok(Math.abs(world.ball.pos.z) < HALF_WIDTH + 1, 'ball stays inside the boards');
    for (const p of world.players) {
      assert.ok(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z), 'player position is finite');
      assert.ok(Math.abs(p.pos.x) <= HALF_LENGTH + GOAL_DEPTH, 'player stays on the map');
    }
  }
  return { world, goals, shots };
}

test('a bot-only match runs cleanly and produces football', () => {
  const { world, shots, goals } = runBotMatch(600, 1234, 480);
  assert.ok(world.match.phase !== MatchPhase.Warmup, 'match got underway');
  // Shot volume is the stable signal; goals are rarer and seed-dependent.
  assert.ok(shots >= 5, `expected the bots to work shots, got ${shots}`);
  assert.ok(goals >= 1, `expected at least one goal in eight minutes, got ${goals}`);
});

test('the match clock runs down and full time is reached', () => {
  // The clock only ticks during open play, so a 70 second match takes longer
  // than 70 seconds of wall time once whistles and celebrations are counted.
  const { world } = runBotMatch(70, 1234, 260);
  assert.ok(
    world.match.phase === MatchPhase.FullTime || world.match.clock < 5,
    `expected full time, phase=${world.match.phase} clock=${world.match.clock}`,
  );
});

test('the ball changes hands rather than sticking to one player', () => {
  const world = createWorld({ matchSeconds: 120, teamSize: 5 }, 77);
  const brains = new Map(world.players.map((p) => [p.id, new BotBrain(p.id, 77 ^ p.id)]));
  const owners = new Set<number>();
  for (let i = 0; i < TICK_RATE * 60; i++) {
    clearEvents(world);
    const inputs = new Map<number, PlayerInput>();
    for (const p of world.players) inputs.set(p.id, brains.get(p.id)!.think(world, p, TICK_DT));
    stepWorld(world, inputs, TICK_DT);
    if (world.ball.owner >= 0) owners.add(world.ball.owner);
  }
  assert.ok(owners.size >= 4, `expected several players to touch the ball, got ${owners.size}`);
});

test('snapshot encoding round-trips', () => {
  const world = createWorld({ teamSize: 5 }, 9);
  world.match.score = [2, 1];
  world.ball.pos = { x: 12.34, y: 2.5, z: -7.89 };
  world.ball.vel = { x: -3.5, y: 4.25, z: 1 };
  world.ball.owner = world.players[3].id;
  world.events.push({ t: 'whistle', kind: 'kickoff' });
  world.events.push({ t: 'kick', kind: 'shot', player: 4, power: 0.75 });

  const snap = decodeSnapshot(encodeSnapshot(world, 123456));
  assert.ok(snap);
  assert.equal(snap.players.length, world.players.length);
  assert.equal(snap.score[0], 2);
  assert.equal(snap.ball.owner, world.players[3].id);
  assert.ok(Math.abs(snap.ball.x - 12.34) < 0.02);
  assert.ok(Math.abs(snap.ball.y - 2.5) < 0.02);
  assert.equal(snap.events.length, 2);
  assert.equal(snap.events[1].t, 'kick');

  const p0 = snap.players[0];
  const src = world.players[0];
  assert.equal(p0.id, src.id);
  assert.equal(p0.team, src.team);
  assert.equal(p0.role, src.role);
  assert.ok(Math.abs(p0.x - src.pos.x) < 0.02);
});

test('input batches round-trip', () => {
  const batch: PlayerInput[] = [
    { ...emptyInput(41), moveX: 0.5, moveZ: -1, buttons: 0b101, aim: 1.2 },
    { ...emptyInput(42), moveX: -0.25, moveZ: 0.75, buttons: 0b10, aim: -2.9 },
  ];
  const out = decodeInputBatch(encodeInputBatch(batch));
  assert.equal(out.length, 2);
  assert.equal(out[0].seq, 41);
  assert.equal(out[1].buttons, 0b10);
  assert.ok(Math.abs(out[0].moveX - 0.5) < 0.01);
  assert.ok(Math.abs(out[1].aim - -2.9) < 0.01);
});
