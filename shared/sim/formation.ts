import { HALF_LENGTH, HALF_WIDTH, PITCH_LENGTH } from '../constants.js';
import { Role, type Team } from '../types.js';
import type { Vec2 } from '../math.js';

export interface FormationSlot {
  /** 0 = own goal line, 1 = opponent goal line. */
  x: number;
  /** -1 = left touchline, 1 = right touchline (from the team's own view). */
  z: number;
  role: Role;
}

/**
 * Formations by team size (keeper included). Small sides get compact shapes;
 * the 5-a-side default is a 1-2-1-1 that leaves room for counters.
 */
const FORMATIONS: Record<number, FormationSlot[]> = {
  2: [
    { x: 0.04, z: 0, role: Role.Keeper },
    { x: 0.5, z: 0, role: Role.Striker },
  ],
  3: [
    { x: 0.04, z: 0, role: Role.Keeper },
    { x: 0.28, z: 0, role: Role.Defender },
    { x: 0.6, z: 0, role: Role.Striker },
  ],
  4: [
    { x: 0.04, z: 0, role: Role.Keeper },
    { x: 0.25, z: -0.35, role: Role.Defender },
    { x: 0.25, z: 0.35, role: Role.Defender },
    { x: 0.62, z: 0, role: Role.Striker },
  ],
  5: [
    { x: 0.04, z: 0, role: Role.Keeper },
    { x: 0.24, z: -0.42, role: Role.Defender },
    { x: 0.24, z: 0.42, role: Role.Defender },
    { x: 0.47, z: 0, role: Role.Midfielder },
    { x: 0.68, z: 0, role: Role.Striker },
  ],
  6: [
    { x: 0.04, z: 0, role: Role.Keeper },
    { x: 0.22, z: -0.45, role: Role.Defender },
    { x: 0.22, z: 0.45, role: Role.Defender },
    { x: 0.45, z: 0, role: Role.Midfielder },
    { x: 0.62, z: -0.62, role: Role.Winger },
    { x: 0.72, z: 0.2, role: Role.Striker },
  ],
};

export function formationFor(teamSize: number): FormationSlot[] {
  return FORMATIONS[teamSize] ?? FORMATIONS[5];
}

/** Convert a normalized formation slot into world coordinates for a team. */
export function slotToWorld(slot: FormationSlot, team: Team): Vec2 {
  const usableWidth = HALF_WIDTH - 3.5;
  if (team === 0) {
    return { x: -HALF_LENGTH + slot.x * PITCH_LENGTH, z: slot.z * usableWidth };
  }
  return { x: HALF_LENGTH - slot.x * PITCH_LENGTH, z: -slot.z * usableWidth };
}

/** Direction (in X) this team attacks: +1 for team 0, -1 for team 1. */
export function attackDir(team: Team): number {
  return team === 0 ? 1 : -1;
}

/** Centre of the goal this team is defending. */
export function ownGoalX(team: Team): number {
  return team === 0 ? -HALF_LENGTH : HALF_LENGTH;
}

/** Centre of the goal this team is attacking. */
export function targetGoalX(team: Team): number {
  return team === 0 ? HALF_LENGTH : -HALF_LENGTH;
}

/**
 * Kickoff placement: everyone in their own half, the kicking team gets a
 * player on the ball and a support runner just behind it.
 */
export function kickoffPosition(
  slot: FormationSlot,
  index: number,
  count: number,
  team: Team,
  kicking: boolean,
): Vec2 {
  const base = slotToWorld(slot, team);
  const dir = attackDir(team);
  // Squeeze everyone into their own half.
  let x = base.x;
  if (dir > 0) x = Math.min(x, -2.5);
  else x = Math.max(x, 2.5);

  if (kicking && count > 1) {
    // The most advanced slot stands over the ball, the next one supports.
    if (index === count - 1) return { x: -dir * 1.4, z: 0.9 };
    if (count > 2 && index === count - 2) return { x: -dir * 4.0, z: -2.2 };
  }
  if (slot.role === Role.Keeper) return base;
  return { x, z: base.z };
}
