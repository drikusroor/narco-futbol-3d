import { STAMINA_TIRED_THRESHOLD } from '../constants.js';
import { clamp } from '../math.js';
import { PowerupType, Role, type PlayerState } from '../types.js';

/**
 * Derived per-player multipliers. Power-ups are deliberately chunky - this is
 * an arcade game - but they stack on top of small role differences so a
 * defender still tackles better and a striker still finishes better.
 */

export function speedMul(p: PlayerState): number {
  let m = p.powerup === PowerupType.Speed ? 1.24 : 1;
  if (p.role === Role.Winger) m *= 1.04;
  if (p.role === Role.Defender) m *= 0.98;
  // Running on empty costs you a little pace.
  if (p.stamina < STAMINA_TIRED_THRESHOLD) m *= 0.82 + 0.18 * (p.stamina / STAMINA_TIRED_THRESHOLD);
  return m;
}

export function powerMul(p: PlayerState): number {
  let m = p.powerup === PowerupType.Power ? 1.3 : 1;
  if (p.role === Role.Striker) m *= 1.05;
  return m;
}

export function strengthMul(p: PlayerState): number {
  let m = p.powerup === PowerupType.Strength ? 1.55 : 1;
  if (p.role === Role.Defender) m *= 1.08;
  if (p.role === Role.Keeper) m *= 1.15;
  return m;
}

export function passMul(p: PlayerState): number {
  let m = p.powerup === PowerupType.Vision ? 1.22 : 1;
  if (p.role === Role.Midfielder) m *= 1.06;
  return m;
}

/** 0..1, how cleanly this player controls a ball arriving at speed. */
export function controlMul(p: PlayerState): number {
  // Keepers have hands: they smother pace that would bounce off a boot.
  if (p.role === Role.Keeper) return 2.4;
  let m = 1;
  if (p.powerup === PowerupType.Vision) m *= 1.15;
  if (p.role === Role.Striker || p.role === Role.Winger) m *= 1.05;
  return clamp(m, 0.5, 1.6);
}
