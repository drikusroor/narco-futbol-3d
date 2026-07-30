/** Diagnostic: classify what happens to every shot in a bot-only match. */
import { GOAL_HALF_WIDTH, GOAL_HEIGHT, HALF_LENGTH, TICK_DT, TICK_RATE } from '../shared/constants.ts';
import { clearEvents, createWorld, stepWorld } from '../shared/sim/index.ts';
import { BotBrain } from '../server/ai/bot.ts';

const MINUTES = Number(process.argv[2] ?? 5);
const MATCHES = Number(process.argv[3] ?? 3);
const lanes = [];
const samples = [];
const blockedLanes = [];
const tally = { goal: 0, keeper: 0, blocked: 0, wide: 0, woodwork: 0, lost: 0 };
let shots = 0;

for (let m = 0; m < MATCHES; m++) {
  const seed = 500 + m * 104729;
  const world = createWorld({ matchSeconds: MINUTES * 60, teamSize: 5 }, seed);
  const brains = new Map(world.players.map((p) => [p.id, new BotBrain(p.id, seed ^ (p.id * 2654435761))]));
  let tracking = null;

  for (let i = 0; i < MINUTES * 60 * TICK_RATE * 1.4; i++) {
    clearEvents(world);
    const inputs = new Map();
    for (const p of world.players) inputs.set(p.id, brains.get(p.id).think(world, p, TICK_DT));
    stepWorld(world, inputs, TICK_DT);

    for (const e of world.events) {
      if (e.t === 'kick' && e.kind === 'shot') {
        const shooter = world.players.find((p) => p.id === e.player);
        const bv = world.ball.vel;
        const bl = Math.hypot(bv.x, bv.z) || 1;
        let nearest = 99;
        for (const o of world.players) {
          if (o.team === shooter.team) continue;
          const dx = o.pos.x - world.ball.pos.x;
          const dz = o.pos.z - world.ball.pos.z;
          const d = Math.hypot(dx, dz) || 1e-4;
          const along = ((dx / d) * bv.x + (dz / d) * bv.z) / bl;
          if (along > Math.cos(0.5) && d < nearest) nearest = d;
        }
        lanes.push(nearest);
        const gx = shooter.team === 0 ? HALF_LENGTH : -HALF_LENGTH;
        const tgx = gx - world.ball.pos.x, tgz = 0 - world.ball.pos.z;
        const tg = Math.hypot(tgx, tgz) || 1;
        const offAngle = Math.acos(Math.max(-1, Math.min(1, ((bv.x/bl)*(tgx/tg) + (bv.z/bl)*(tgz/tg)))));
        if (samples.length < 12) samples.push(`shot from x=${world.ball.pos.x.toFixed(0)} z=${world.ball.pos.z.toFixed(0)} dGoal=${tg.toFixed(0)}m speed=${bl.toFixed(0)} off-target-angle=${(offAngle*57.3).toFixed(0)}deg lane=${nearest.toFixed(1)}`);
        tracking = {
          nearest,
          team: shooter.team,
          goalX: shooter.team === 0 ? HALF_LENGTH : -HALF_LENGTH,
          t: 0,
          hitPost: false,
          startX: world.ball.pos.x,
        };
        shots++;
      }
    }
    if (!tracking) continue;

    tracking.t += TICK_DT;
    if (world.events.some((e) => e.t === 'post')) tracking.hitPost = true;
    const goal = world.events.find((e) => e.t === 'goal');
    if (goal) {
      tally.goal++;
      tracking = null;
      continue;
    }
    const owner = world.ball.owner >= 0 ? world.players.find((p) => p.id === world.ball.owner) : null;
    const toucher = world.players.find((p) => p.id === world.ball.lastTouch);
    if (owner && owner.team !== tracking.team) {
      if (owner.role !== 0) blockedLanes.push(tracking.nearest);
      tally[owner.role === 0 ? 'keeper' : 'blocked']++;
      tracking = null;
      continue;
    }
    // Ball reached the goal line region without scoring.
    const past = Math.abs(world.ball.pos.x) > HALF_LENGTH - 0.6;
    if (past) {
      const insideMouth =
        Math.abs(world.ball.pos.z) < GOAL_HALF_WIDTH && world.ball.pos.y < GOAL_HEIGHT;
      if (tracking.hitPost) tally.woodwork++;
      else if (!insideMouth) tally.wide++;
      else tally.keeper++;
      tracking = null;
      continue;
    }
    if (toucher && toucher.team !== tracking.team && tracking.t > 0.05) {
      if (toucher.role !== 0) blockedLanes.push(tracking.nearest);
      tally[toucher.role === 0 ? 'keeper' : 'blocked']++;
      tracking = null;
      continue;
    }
    if (tracking.t > 3) {
      tally.lost++;
      tracking = null;
    }
  }
}

console.log(`shots: ${shots} over ${MATCHES} matches of ${MINUTES} min`);
for (const [k, v] of Object.entries(tally)) {
  console.log(`  ${k.padEnd(9)} ${v} (${((v / shots) * 100).toFixed(0)}%)`);
}

const fmt = (a) => a.length ? `n=${a.length} median=${a.slice().sort((x,y)=>x-y)[a.length>>1].toFixed(1)}m <3m=${(a.filter(v=>v<3).length/a.length*100).toFixed(0)}%` : 'none';
console.log('lane clearance at release :', fmt(lanes));
console.log('lane clearance of blocked :', fmt(blockedLanes));

console.log('\nsamples:'); for (const s of samples) console.log('  ' + s);
