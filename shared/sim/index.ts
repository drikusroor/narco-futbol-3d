import { TICK_DT } from '../constants.js';
import { emptyInput, type PlayerInput, type World } from '../types.js';
import { resolveSlides } from './actions.js';
import { stepBall } from './ball.js';
import { applyDribble, resolveBallBodies, updateOwnership } from './control.js';
import { resolvePlayerCollisions, stepPlayer } from './player.js';
import { updatePowerups } from './powerups.js';
import { checkGoal, processFouls, updateMatch, updateReferee, updateStallWatchdog } from './rules.js';

export * from './world.js';
export * from './formation.js';
export * from './stats.js';
export * from './actions.js';
export * from './ball.js';
export * from './control.js';
export * from './player.js';
export * from './powerups.js';
export * from './rules.js';

const NO_INPUT = emptyInput();

/**
 * One authoritative simulation step. The server runs this at 60 Hz with real
 * inputs; the client runs the identical function for prediction. Nothing in
 * here touches wall-clock time or unseeded randomness, so both agree.
 *
 * Call `clearEvents` at the top of your tick, before gathering inputs - the AI
 * can raise events (a keeper claiming and clearing) while deciding.
 */
export function clearEvents(world: World): void {
  world.events.length = 0;
}

export function stepWorld(world: World, inputs: Map<number, PlayerInput>, dt: number = TICK_DT): void {
  updateMatch(world, dt);
  updateOwnership(world, dt);

  for (const p of world.players) {
    stepPlayer(world, p, inputs.get(p.id) ?? NO_INPUT, dt);
  }

  resolveSlides(world);
  resolvePlayerCollisions(world);
  applyDribble(world, dt);

  const { prev } = stepBall(world, dt);
  resolveBallBodies(world);

  checkGoal(world, prev);
  processFouls(world);
  updateStallWatchdog(world);
  updatePowerups(world, dt);
  updateReferee(world, dt);

  world.tick++;
  world.time += dt;
}
