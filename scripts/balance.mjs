/**
 * Quick balance probe: simulate a batch of bot-only matches and print how the
 * games look (goals, possession changes, tackles, fouls). Run with:
 *   npx tsx scripts/balance.mjs        (via the tsx loader for TS imports)
 */
import { TICK_DT, TICK_RATE } from '../shared/constants.ts';
import { clearEvents, createWorld, stepWorld } from '../shared/sim/index.ts';
import { BotBrain } from '../server/ai/bot.ts';

const MATCHES = Number(process.argv[2] ?? 5);
const MINUTES = Number(process.argv[3] ?? 5);

let totals = { goals: 0, shots: 0, passes: 0, tackles: 0, fouls: 0, saves: 0, pickups: 0, posted: 0 };

for (let m = 0; m < MATCHES; m++) {
  const seed = 1000 + m * 7919;
  const world = createWorld({ matchSeconds: MINUTES * 60, teamSize: 5 }, seed);
  const brains = new Map(world.players.map((p) => [p.id, new BotBrain(p.id, seed ^ (p.id * 2654435761))]));
  const stats = { goals: 0, shots: 0, passes: 0, tackles: 0, fouls: 0, saves: 0, pickups: 0, posted: 0 };
  const ticks = MINUTES * 60 * TICK_RATE * 1.5;
  for (let i = 0; i < ticks; i++) {
    clearEvents(world);
    const inputs = new Map();
    for (const p of world.players) inputs.set(p.id, brains.get(p.id).think(world, p, TICK_DT));
    stepWorld(world, inputs, TICK_DT);
    for (const e of world.events) {
      if (e.t === 'goal') stats.goals++;
      else if (e.t === 'kick' && e.kind === 'shot') stats.shots++;
      else if (e.t === 'kick' && e.kind === 'pass') stats.passes++;
      else if (e.t === 'tackle') stats.tackles++;
      else if (e.t === 'foul') stats.fouls++;
      else if (e.t === 'save') stats.saves++;
      else if (e.t === 'pickup') stats.pickups++;
      else if (e.t === 'post') stats.posted++;
    }
  }
  console.log(
    `match ${m + 1}: ${world.match.score[0]}-${world.match.score[1]} ` +
      `shots=${stats.shots} passes=${stats.passes} tackles=${stats.tackles} ` +
      `fouls=${stats.fouls} saves=${stats.saves} woodwork=${stats.posted} powerups=${stats.pickups}`,
  );
  for (const k of Object.keys(totals)) totals[k] += stats[k];
}

console.log('\naverages per match:');
for (const [k, v] of Object.entries(totals)) {
  console.log(`  ${k.padEnd(9)} ${(v / MATCHES).toFixed(1)}`);
}
