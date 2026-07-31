import assert from 'node:assert/strict';
import test from 'node:test';

import { BALL_RADIUS, HALF_WIDTH, TICK_DT, TICK_RATE } from '@shared/constants.js';
import { headingOf } from '@shared/math.js';
import {
  BTN,
  MatchPhase,
  PlayerAct,
  Role,
  emptyInput,
  type PlayerInput,
  type PlayerState,
  type World,
} from '@shared/types.js';
import { clearEvents, createWorld, stepWorld, targetGoalX } from '@shared/sim/index.js';
import { Trainer } from '../server/training.js';

/**
 * The drills sit on top of the ordinary simulation, so these run the real
 * stepWorld and only check that the trainer sets scenarios up and judges them.
 */

function soloWorld(): { world: World; me: PlayerState } {
  const world = createWorld({ teamSize: 5 }, 77);
  const me = world.players.find((p) => p.team === 0 && p.role === Role.Striker)!;
  me.bot = false;
  return { world, me };
}

function run(world: World, trainer: Trainer, ticks: number, input: PlayerInput, id: number): void {
  const map = new Map<number, PlayerInput>();
  for (let i = 0; i < ticks; i++) {
    input.seq++;
    map.set(id, input);
    clearEvents(world);
    stepWorld(world, map, TICK_DT);
    trainer.afterStep();
  }
}

test('a drill parks everyone who is not involved and keeps the keeper on', () => {
  const { world, me } = soloWorld();
  const trainer = new Trainer(world, 'shooting', me.id);
  const keeper = world.players.find((p) => p.team === 1 && p.role === Role.Keeper)!;

  assert.ok(!trainer.isParked(me.id), 'the human plays');
  assert.ok(!trainer.isParked(keeper.id), 'the keeper they have to beat plays');
  const parked = world.players.filter((p) => trainer.isParked(p.id));
  assert.equal(parked.length, world.players.length - 2);
  for (const p of parked) {
    assert.ok(Math.abs(p.pos.z) > HALF_WIDTH - 2, `${p.id} should be off the pitch`);
  }
});

test('the shooting drill counts a goal and moves on to the next spot', () => {
  const { world, me } = soloWorld();
  const trainer = new Trainer(world, 'shooting', me.id);
  const keeper = world.players.find((p) => p.team === 1 && p.role === Role.Keeper)!;
  keeper.pos.z = 25; // the keeper AI is a bot brain, which is not running here

  const first = trainer.report().markers[0];
  assert.equal(first.kind, 'spot');
  assert.ok(world.ball.pos.x === first.x && world.ball.pos.z === first.z, 'ball is on the spot');

  // Wait out the whistle, then walk on to the ball.
  run(world, trainer, Math.round(1.4 * TICK_RATE), emptyInput(1), me.id);
  assert.equal(world.match.phase, MatchPhase.Play);

  const aim = headingOf(1, 0);
  run(world, trainer, 30, { ...emptyInput(1), moveX: 1, aim }, me.id);
  assert.equal(world.ball.owner, me.id, 'should have collected it');

  // Hold and release a shot at the goal.
  run(world, trainer, 30, { ...emptyInput(1), buttons: BTN.SHOOT, aim }, me.id);
  run(world, trainer, 90, { ...emptyInput(1), aim }, me.id);

  const stats = trainer.report().stats;
  assert.equal(stats[0].key, 'drill.stat.scored');
  assert.equal(stats[0].value, '1/1', `expected a goal, got ${stats[0].value}`);

  // The next rep must set itself up: new spot, ball on it, play restarted.
  run(world, trainer, Math.round(2.2 * TICK_RATE), emptyInput(1), me.id);
  const next = trainer.report().markers[0];
  assert.notEqual(`${next.x}:${next.z}`, `${first.x}:${first.z}`, 'a different spot');
  assert.ok(
    Math.hypot(world.ball.pos.x - next.x, world.ball.pos.z - next.z) < 0.01,
    'ball waiting on the new spot',
  );
});

test('a shot that goes nowhere is still counted as an attempt', () => {
  const { world, me } = soloWorld();
  const trainer = new Trainer(world, 'shooting', me.id);
  run(world, trainer, Math.round(1.4 * TICK_RATE), emptyInput(1), me.id);

  // Belt it into the corner flag and wait for it to settle.
  const aim = headingOf(0, 1);
  run(world, trainer, 30, { ...emptyInput(1), moveX: 1, aim: headingOf(1, 0) }, me.id);
  run(world, trainer, 40, { ...emptyInput(1), buttons: BTN.SHOOT, aim }, me.id);
  run(world, trainer, 8 * TICK_RATE, { ...emptyInput(1), aim }, me.id);

  assert.equal(trainer.report().stats[0].value, '0/1');
});

test('the dribbling drill ticks gates off in order', () => {
  const { world, me } = soloWorld();
  const trainer = new Trainer(world, 'dribble', me.id);
  run(world, trainer, Math.round(1.4 * TICK_RATE), emptyInput(1), me.id);

  const gates = trainer.report().markers;
  assert.equal(gates.length, 5);
  assert.ok(gates[0].active && !gates[1].active, 'the first gate is the live one');

  // Carry it through each gate: put the pair either side of the line and step.
  for (let i = 0; i < gates.length; i++) {
    const gate = trainer.report().markers[i];
    place(world, me, gate.x - 2, gate.z);
    run(world, trainer, 2, emptyInput(1), me.id);
    place(world, me, gate.x + 1.2, gate.z);
    run(world, trainer, 2, emptyInput(1), me.id);
  }

  // The last gate completes the lap, which records a time and resets.
  const stats = trainer.report().stats;
  const best = stats.find((s) => s.key === 'drill.stat.best')!;
  assert.notEqual(best.value, '—', 'a lap time should have been recorded');
});

test('the passing drill puts a man in the circle and counts finding him', () => {
  const { world, me } = soloWorld();
  const trainer = new Trainer(world, 'passing', me.id);
  run(world, trainer, Math.round(1.4 * TICK_RATE), emptyInput(1), me.id);

  const target = trainer.report().markers[0];
  assert.equal(target.kind, 'target');
  const mate = world.players.find(
    (p) => p.team === me.team && p.id !== me.id && p.role !== Role.Keeper,
  )!;
  assert.ok(
    Math.hypot(mate.pos.x - target.x, mate.pos.z - target.z) < 0.01,
    'a team-mate is standing on the target',
  );

  // Face the target, collect the ball and slide it in to him.
  const aim = headingOf(target.x - me.pos.x, target.z - me.pos.z);
  run(world, trainer, 20, { ...emptyInput(1), moveX: 1, aim }, me.id);
  run(world, trainer, 8, { ...emptyInput(1), aim, buttons: BTN.PASS }, me.id);
  run(world, trainer, 2 * TICK_RATE, { ...emptyInput(1), aim }, me.id);

  assert.equal(trainer.report().stats[0].value, '1/1', 'a completed pass counts');
});

test('the tutorial only brings players on when the lesson needs them', () => {
  const { world, me } = soloWorld();
  const trainer = new Trainer(world, 'tutorial', me.id);
  const mate = world.players.find(
    (p) => p.team === me.team && p.id !== me.id && p.role !== Role.Keeper,
  )!;
  const marker = world.players.find((p) => p.team !== me.team && p.role === Role.Defender)!;

  assert.ok(trainer.isParked(mate.id), 'nobody else is on for "move with WASD"');
  assert.ok(trainer.isParked(marker.id), 'and certainly not a defender');

  trainer.setStage(4); // play a pass
  assert.ok(!trainer.isParked(mate.id), 'someone to pass to');
  assert.ok(trainer.isParked(marker.id), 'still unmarked');

  trainer.setStage(8); // win the ball back
  assert.ok(!trainer.isParked(marker.id), 'now there is someone to tackle');

  // The drills ignore the stage entirely.
  const drill = new Trainer(world, 'shooting', me.id);
  drill.setStage(9);
  assert.ok(drill.isParked(mate.id));
});

test('training never runs out of time', () => {
  const { world, me } = soloWorld();
  world.config.matchSeconds = 20;
  world.match.duration = 20;
  world.match.clock = 20;
  const trainer = new Trainer(world, 'free', me.id);
  run(world, trainer, 40 * TICK_RATE, emptyInput(1), me.id);
  assert.notEqual(world.match.phase, MatchPhase.FullTime);
  assert.equal(world.match.clock, world.match.duration);
});

/** Drop the player and the ball at a spot, with the ball at their feet. */
function place(world: World, me: PlayerState, x: number, z: number): void {
  me.pos.x = x;
  me.pos.z = z;
  me.vel.x = 0;
  me.vel.z = 0;
  me.act = PlayerAct.Idle;
  world.ball.pos = { x: x + 0.4, y: BALL_RADIUS, z };
  world.ball.vel = { x: 0, y: 0, z: 0 };
  world.ball.owner = me.id;
}

test('the goal the drill points you at is the one you attack', () => {
  const { world, me } = soloWorld();
  const trainer = new Trainer(world, 'shooting', me.id);
  const spot = trainer.report().markers[0];
  const goal = targetGoalX(me.team);
  assert.ok(Math.sign(spot.x) === Math.sign(goal), 'the spot is in the attacking half');
  assert.ok(Math.abs(goal - spot.x) < 26, 'and within shooting range');
});
