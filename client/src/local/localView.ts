import { decodeSnapshot, encodeSnapshot, type Snapshot } from '@shared/protocol.js';
import { type GameEvent, type MatchPhase, type PlayerAct, type PowerupType, type World } from '@shared/types.js';
import type { RenderState } from '../net/state.js';

/**
 * A real `Snapshot`, built the same way the wire format is - through the
 * actual encode/decode round trip - so quantisation and field layout can
 * never drift from what a networked match produces. `events` is overwritten
 * because a slow frame can cover more than one simulation tick and the world
 * only remembers the last one's.
 */
export function snapshotFromWorld(world: World, events: GameEvent[], serverTimeMs: number): Snapshot {
  const snap = decodeSnapshot(encodeSnapshot(world, serverTimeMs))!;
  snap.events = events;
  return snap;
}

/**
 * There is no network jitter to hide from in local play, so the render view
 * is read straight off the current snapshot instead of interpolated between
 * two buffered ones - zero added latency for every player at the table.
 */
export function renderStateFromSnapshot(snap: Snapshot): RenderState {
  return {
    players: snap.players.map((p) => ({
      id: p.id,
      team: p.team,
      role: p.role,
      bot: p.bot,
      controlled: p.controlled,
      x: p.x,
      z: p.z,
      facing: p.facing,
      speed: Math.hypot(p.vx, p.vz),
      act: p.act as PlayerAct,
      actTimer: p.actTimer,
      stamina: p.stamina,
      powerup: p.powerup as PowerupType,
      charge: p.charge,
    })),
    ball: {
      x: snap.ball.x,
      y: snap.ball.y,
      z: snap.ball.z,
      speed: Math.hypot(snap.ball.vx, snap.ball.vy, snap.ball.vz),
      spinY: snap.ball.spinY,
      owner: snap.ball.owner,
    },
    referee: snap.referee,
    pickups: snap.pickups,
    phase: snap.phase as MatchPhase,
    phaseTimer: snap.phaseTimer,
    clock: snap.clock,
    duration: snap.duration,
    score: snap.score,
  };
}
