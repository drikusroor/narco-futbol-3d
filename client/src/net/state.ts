import { SNAPSHOT_RATE, TICK_DT } from '@shared/constants.js';
import { angleDelta, clamp, lerp } from '@shared/math.js';
import { expandSeq, type Snapshot, type SnapshotPlayer } from '@shared/protocol.js';
import {
  MatchPhase,
  PlayerAct,
  PowerupType,
  Role,
  type GameEvent,
  type PlayerInput,
  type PlayerState,
  type World,
} from '@shared/types.js';
import { createWorld, makePlayer, stepWorld, clearEvents } from '@shared/sim/index.js';

/** How far behind the server we render remote entities, in milliseconds. */
const INTERP_DELAY = (1000 / SNAPSHOT_RATE) * 2.2;
const MAX_BUFFER = 20;

export interface RenderPlayer {
  id: number;
  team: number;
  role: number;
  bot: boolean;
  controlled: boolean;
  x: number;
  z: number;
  facing: number;
  speed: number;
  act: PlayerAct;
  actTimer: number;
  stamina: number;
  powerup: PowerupType;
  charge: number;
}

export interface RenderState {
  players: RenderPlayer[];
  ball: { x: number; y: number; z: number; speed: number; spinY: number; owner: number };
  referee: { x: number; z: number; facing: number; whistle: number };
  pickups: { id: number; type: number; x: number; z: number; respawn: number }[];
  phase: MatchPhase;
  phaseTimer: number;
  clock: number;
  duration: number;
  score: [number, number];
}

interface Timed {
  snap: Snapshot;
  at: number;
}

/**
 * Holds the two views of the match that the client needs: the interpolated
 * (slightly delayed) authoritative view used to draw everyone else, and a
 * locally predicted simulation used to draw the player you are actually
 * controlling, so your own input never waits for a round trip.
 */
export class MatchState {
  readonly world: World;
  private buffer: Timed[] = [];
  private pending: PlayerInput[] = [];
  private latest: Snapshot | null = null;
  private lastAppliedTick = -1;
  /** Smoothed-out difference between prediction and server truth. */
  private errX = 0;
  private errZ = 0;
  private ballErr = { x: 0, y: 0, z: 0 };
  myPlayerId = -1;
  /** Events from the newest snapshot, consumed once by the presentation layer. */
  freshEvents: GameEvent[] = [];
  goalCount = 0;

  constructor() {
    this.world = createWorld({}, 1);
  }

  /**
   * Forget everything about the last connection. Rooms number their ticks from
   * zero, so without this a second session's snapshots all look older than the
   * first one's and get dropped until its tick count catches up.
   */
  reset(): void {
    this.buffer = [];
    this.pending = [];
    this.latest = null;
    this.lastAppliedTick = -1;
    this.errX = 0;
    this.errZ = 0;
    this.ballErr = { x: 0, y: 0, z: 0 };
    this.myPlayerId = -1;
    this.nextSeq = 1;
    this.freshEvents = [];
    this.goalCount = 0;
  }

  get me(): PlayerState | undefined {
    return this.world.players.find((p) => p.id === this.myPlayerId);
  }

  get myTeam(): number {
    return this.me?.team ?? 0;
  }

  // --- receiving ------------------------------------------------------------

  onSnapshot(snap: Snapshot, at: number): void {
    // Late or duplicated packets are simply dropped.
    if (snap.tick <= this.lastAppliedTick) return;
    this.lastAppliedTick = snap.tick;
    this.latest = snap;
    this.buffer.push({ snap, at });
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
    this.freshEvents = snap.events;
    this.goalCount = snap.goalCount;
    this.reconcile(snap);
  }

  /** Overwrite the predicted world with server truth, then replay our inputs. */
  private reconcile(snap: Snapshot): void {
    const me = this.me;
    const beforeX = me?.pos.x ?? 0;
    const beforeZ = me?.pos.z ?? 0;
    const ballBefore = { ...this.world.ball.pos };

    applySnapshot(this.world, snap);

    const mine = snap.players.find((p) => p.id === this.myPlayerId);
    if (mine) {
      const ack = expandSeq(mine.lastSeq, this.nextSeq);
      this.pending = this.pending.filter((i) => i.seq > ack);
      const inputs = new Map<number, PlayerInput>();
      for (const input of this.pending) {
        inputs.clear();
        inputs.set(this.myPlayerId, input);
        clearEvents(this.world);
        stepWorld(this.world, inputs, TICK_DT);
      }
    }

    // Carry the correction as a decaying offset rather than teleporting.
    const after = this.me;
    if (after) {
      this.errX = clamp(beforeX - after.pos.x + this.errX, -4, 4);
      this.errZ = clamp(beforeZ - after.pos.z + this.errZ, -4, 4);
    }
    this.ballErr.x = clamp(ballBefore.x - this.world.ball.pos.x + this.ballErr.x, -5, 5);
    this.ballErr.y = clamp(ballBefore.y - this.world.ball.pos.y + this.ballErr.y, -5, 5);
    this.ballErr.z = clamp(ballBefore.z - this.world.ball.pos.z + this.ballErr.z, -5, 5);
  }

  private nextSeq = 1;

  /** Advance the local prediction by one tick with the player's own input. */
  predict(input: PlayerInput): PlayerInput {
    input.seq = this.nextSeq++;
    this.pending.push(input);
    if (this.pending.length > 180) this.pending.shift();
    const inputs = new Map<number, PlayerInput>();
    inputs.set(this.myPlayerId, input);
    clearEvents(this.world);
    stepWorld(this.world, inputs, TICK_DT);
    return input;
  }

  decayError(dt: number): void {
    const k = Math.exp(-9 * dt);
    this.errX *= k;
    this.errZ *= k;
    this.ballErr.x *= k;
    this.ballErr.y *= k;
    this.ballErr.z *= k;
  }

  // --- presenting -----------------------------------------------------------

  /**
   * Build the frame's view of the world: everyone else interpolated between the
   * last two snapshots, the local player and (when we have it) the ball taken
   * from the prediction.
   */
  sample(now: number): RenderState | null {
    if (!this.latest) return null;
    const target = now - INTERP_DELAY;

    let older: Timed | null = null;
    let newer: Timed | null = null;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].at <= target) {
        older = this.buffer[i];
        newer = this.buffer[i + 1] ?? null;
        break;
      }
    }
    if (!older) older = this.buffer[0] ?? { snap: this.latest, at: now };
    if (!newer) newer = older;

    const span = newer.at - older.at;
    const t = span > 1 ? clamp((target - older.at) / span, 0, 1) : 0;

    const players: RenderPlayer[] = [];
    for (const a of older.snap.players) {
      const b = newer.snap.players.find((p) => p.id === a.id) ?? a;
      players.push(blendPlayer(a, b, t, a.id === this.myPlayerId ? this : null));
    }

    const ball = this.sampleBall(older.snap, newer.snap, t);

    const ref = {
      x: lerp(older.snap.referee.x, newer.snap.referee.x, t),
      z: lerp(older.snap.referee.z, newer.snap.referee.z, t),
      facing: older.snap.referee.facing + angleDelta(older.snap.referee.facing, newer.snap.referee.facing) * t,
      whistle: Math.max(older.snap.referee.whistle, newer.snap.referee.whistle),
    };

    const live = this.latest;
    return {
      players,
      ball,
      referee: ref,
      pickups: live.pickups,
      phase: live.phase as MatchPhase,
      phaseTimer: live.phaseTimer,
      clock: live.clock,
      duration: live.duration,
      score: live.score,
    };
  }

  private sampleBall(
    a: Snapshot,
    b: Snapshot,
    t: number,
  ): RenderState['ball'] {
    const predicted = this.world.ball;
    const mine = predicted.owner === this.myPlayerId && this.myPlayerId >= 0;
    if (mine) {
      // While it is at our feet the prediction is what feels right.
      return {
        x: predicted.pos.x + this.ballErr.x,
        y: predicted.pos.y + this.ballErr.y,
        z: predicted.pos.z + this.ballErr.z,
        speed: Math.hypot(predicted.vel.x, predicted.vel.y, predicted.vel.z),
        spinY: predicted.spin.y,
        owner: predicted.owner,
      };
    }
    return {
      x: lerp(a.ball.x, b.ball.x, t),
      y: lerp(a.ball.y, b.ball.y, t),
      z: lerp(a.ball.z, b.ball.z, t),
      speed: Math.hypot(b.ball.vx, b.ball.vy, b.ball.vz),
      spinY: b.ball.spinY,
      owner: b.ball.owner,
    };
  }

  private blendLocal(p: RenderPlayer): void {
    const me = this.me;
    if (!me) return;
    p.x = me.pos.x + this.errX;
    p.z = me.pos.z + this.errZ;
    p.facing = me.facing;
    p.speed = Math.hypot(me.vel.x, me.vel.z);
    p.act = me.act;
    p.actTimer = me.actTimer;
    p.stamina = me.stamina;
    p.powerup = me.powerup;
    const charge = Math.max(me.passCharge, me.shootCharge, me.lobCharge);
    p.charge = charge < 0 ? 0 : charge;
  }

  /** Used by `sample` for the locally controlled player. */
  applyLocal(p: RenderPlayer): void {
    this.blendLocal(p);
  }
}

function blendPlayer(
  a: SnapshotPlayer,
  b: SnapshotPlayer,
  t: number,
  local: MatchState | null,
): RenderPlayer {
  const out: RenderPlayer = {
    id: a.id,
    team: a.team,
    role: a.role,
    bot: b.bot,
    controlled: b.controlled,
    x: lerp(a.x, b.x, t),
    z: lerp(a.z, b.z, t),
    facing: a.facing + angleDelta(a.facing, b.facing) * t,
    speed: Math.hypot(b.vx, b.vz),
    act: b.act as PlayerAct,
    actTimer: b.actTimer,
    stamina: b.stamina,
    powerup: b.powerup as PowerupType,
    charge: b.charge,
  };
  if (local) local.applyLocal(out);
  return out;
}

/** Copy a snapshot over the predicted world, creating players as needed. */
export function applySnapshot(world: World, snap: Snapshot): void {
  const seen = new Set<number>();
  for (const sp of snap.players) {
    seen.add(sp.id);
    let p = world.players.find((x) => x.id === sp.id);
    if (!p) {
      p = makePlayer(sp.id, (sp.team as 0 | 1) ?? 0, 0, sp.role as Role, '', sp.bot);
      world.players.push(p);
    }
    p.team = (sp.team as 0 | 1) ?? 0;
    p.role = sp.role as Role;
    p.bot = sp.bot;
    p.controlled = sp.controlled;
    p.pos.x = sp.x;
    p.pos.z = sp.z;
    p.vel.x = sp.vx;
    p.vel.z = sp.vz;
    p.facing = sp.facing;
    p.act = sp.act as PlayerAct;
    p.actTimer = sp.actTimer;
    p.stamina = sp.stamina;
    p.powerup = sp.powerup as PowerupType;
    p.powerupTimer = sp.powerupTimer;
    p.kickFx = sp.kickFx;
  }
  world.players = world.players.filter((p) => seen.has(p.id));

  const b = world.ball;
  b.pos.x = snap.ball.x;
  b.pos.y = snap.ball.y;
  b.pos.z = snap.ball.z;
  b.vel.x = snap.ball.vx;
  b.vel.y = snap.ball.vy;
  b.vel.z = snap.ball.vz;
  b.spin.y = snap.ball.spinY;
  b.owner = snap.ball.owner;

  world.match.phase = snap.phase as MatchPhase;
  world.match.phaseTimer = snap.phaseTimer;
  world.match.clock = snap.clock;
  world.match.duration = snap.duration;
  world.match.score = [snap.score[0], snap.score[1]];
  world.match.goalCount = snap.goalCount;

  world.referee.pos.x = snap.referee.x;
  world.referee.pos.z = snap.referee.z;
  world.referee.facing = snap.referee.facing;
  world.referee.whistle = snap.referee.whistle;

  world.pickups = snap.pickups.map((pu) => ({
    id: pu.id,
    type: pu.type as PowerupType,
    pos: { x: pu.x, y: 1.1, z: pu.z },
    respawn: pu.respawn,
    bob: 0,
  }));
  world.tick = snap.tick;
}
