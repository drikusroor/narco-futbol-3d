import type { PlayerInput, GameEvent, World } from './types.js';

/**
 * Binary wire format for the two high-frequency channels: client inputs and
 * server snapshots. Control traffic (join, lobby, chat) stays JSON on text
 * frames - the transport tells them apart by `typeof data`.
 *
 * Everything is quantised: positions to centimetres, angles to 1/32768 of PI.
 * A full 5v5 snapshot lands around 300 bytes, so 20 Hz costs ~6 KB/s per client.
 */

export const MSG_SNAPSHOT = 1;
export const MSG_INPUT = 2;

const ANGLE_SCALE = 32767 / Math.PI;

class Writer {
  private buf: ArrayBuffer;
  private view: DataView;
  private off = 0;
  constructor(size = 4096) {
    this.buf = new ArrayBuffer(size);
    this.view = new DataView(this.buf);
  }
  private need(bytes: number): void {
    if (this.off + bytes <= this.buf.byteLength) return;
    const next = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.off + bytes));
    new Uint8Array(next).set(new Uint8Array(this.buf));
    this.buf = next;
    this.view = new DataView(next);
  }
  u8(v: number): void {
    this.need(1);
    this.view.setUint8(this.off, v & 0xff);
    this.off += 1;
  }
  i8(v: number): void {
    this.need(1);
    this.view.setInt8(this.off, clampInt(v, -128, 127));
    this.off += 1;
  }
  u16(v: number): void {
    this.need(2);
    this.view.setUint16(this.off, v & 0xffff);
    this.off += 2;
  }
  i16(v: number): void {
    this.need(2);
    this.view.setInt16(this.off, clampInt(v, -32768, 32767));
    this.off += 2;
  }
  u32(v: number): void {
    this.need(4);
    this.view.setUint32(this.off, v >>> 0);
    this.off += 4;
  }
  cm(v: number): void {
    this.i16(Math.round(v * 100));
  }
  angle(v: number): void {
    this.i16(Math.round(wrapPi(v) * ANGLE_SCALE));
  }
  unit(v: number): void {
    this.u8(Math.round(Math.max(0, Math.min(1, v)) * 255));
  }
  bytes(): ArrayBuffer {
    return this.buf.slice(0, this.off);
  }
}

class Reader {
  private view: DataView;
  private off = 0;
  constructor(data: ArrayBuffer | Uint8Array) {
    this.view =
      data instanceof Uint8Array
        ? new DataView(data.buffer, data.byteOffset, data.byteLength)
        : new DataView(data);
  }
  get done(): boolean {
    return this.off >= this.view.byteLength;
  }
  u8(): number {
    const v = this.view.getUint8(this.off);
    this.off += 1;
    return v;
  }
  i8(): number {
    const v = this.view.getInt8(this.off);
    this.off += 1;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.off);
    this.off += 2;
    return v;
  }
  i16(): number {
    const v = this.view.getInt16(this.off);
    this.off += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.off);
    this.off += 4;
    return v;
  }
  cm(): number {
    return this.i16() / 100;
  }
  angle(): number {
    return this.i16() / ANGLE_SCALE;
  }
  unit(): number {
    return this.u8() / 255;
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  v = Math.round(v);
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapPi(a: number): number {
  const TAU = Math.PI * 2;
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x < -Math.PI) x += TAU;
  return x;
}

// --- Input ------------------------------------------------------------------

/**
 * Inputs are sent as a short redundant batch (the last few ticks) so a dropped
 * datagram never loses a button press.
 */
export function encodeInputBatch(inputs: PlayerInput[]): ArrayBuffer {
  const w = new Writer(64);
  w.u8(MSG_INPUT);
  w.u8(Math.min(inputs.length, 8));
  for (let i = Math.max(0, inputs.length - 8); i < inputs.length; i++) {
    const inp = inputs[i];
    w.u32(inp.seq);
    w.i8(inp.moveX * 127);
    w.i8(inp.moveZ * 127);
    w.u8(inp.buttons);
    w.angle(inp.aim);
  }
  return w.bytes();
}

export function decodeInputBatch(data: ArrayBuffer | Uint8Array): PlayerInput[] {
  const r = new Reader(data);
  const type = r.u8();
  if (type !== MSG_INPUT) return [];
  const count = r.u8();
  const out: PlayerInput[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      seq: r.u32(),
      moveX: r.i8() / 127,
      moveZ: r.i8() / 127,
      buttons: r.u8(),
      aim: r.angle(),
    });
  }
  return out;
}

// --- Snapshot ---------------------------------------------------------------

export interface SnapshotPlayer {
  id: number;
  team: number;
  role: number;
  bot: boolean;
  controlled: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  act: number;
  actTimer: number;
  stamina: number;
  powerup: number;
  powerupTimer: number;
  kickFx: number;
  charge: number;
  lastSeq: number;
}

export interface Snapshot {
  tick: number;
  phase: number;
  phaseTimer: number;
  clock: number;
  duration: number;
  score: [number, number];
  goalCount: number;
  players: SnapshotPlayer[];
  ball: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    spinY: number;
    owner: number;
  };
  pickups: { id: number; type: number; x: number; z: number; respawn: number }[];
  referee: { x: number; z: number; facing: number; whistle: number };
  events: GameEvent[];
  serverTime: number;
}

const EV = {
  kick: 1,
  tackle: 2,
  foul: 3,
  goal: 4,
  save: 5,
  post: 6,
  whistle: 7,
  pickup: 8,
  bounce: 9,
  wall: 10,
  chance: 11,
} as const;

const KICK_KINDS = ['pass', 'shot', 'lob', 'clear'] as const;
const WHISTLE_KINDS = ['kickoff', 'goal', 'foul', 'fulltime'] as const;

export function encodeSnapshot(world: World, serverTimeMs: number): ArrayBuffer {
  const w = new Writer(2048);
  w.u8(MSG_SNAPSHOT);
  w.u32(world.tick);
  w.u32(serverTimeMs >>> 0);
  w.u8(world.match.phase);
  w.u16(Math.round(world.match.phaseTimer * 100));
  w.u16(Math.round(world.match.clock * 10));
  w.u16(Math.round(world.match.duration));
  w.u8(world.match.score[0]);
  w.u8(world.match.score[1]);
  w.u8(world.match.goalCount);

  w.u8(world.players.length);
  for (const p of world.players) {
    w.u16(p.id);
    const flags = (p.team & 1) | ((p.role & 7) << 1) | (p.bot ? 16 : 0) | (p.controlled ? 32 : 0);
    w.u8(flags);
    w.cm(p.pos.x);
    w.cm(p.pos.z);
    w.cm(p.vel.x);
    w.cm(p.vel.z);
    w.angle(p.facing);
    w.u8(p.act);
    w.u8(Math.min(255, Math.round(p.actTimer * 100)));
    w.unit(p.stamina);
    w.u8(p.powerup);
    w.u8(Math.min(255, Math.round(p.powerupTimer * 10)));
    w.unit(p.kickFx);
    // Charge bar: whichever kick button is being held, for the HUD.
    const charge = Math.max(p.passCharge, p.shootCharge, p.lobCharge);
    w.unit(charge < 0 ? 0 : Math.min(1, charge));
    w.u16(p.lastSeq & 0xffff);
  }

  const b = world.ball;
  w.cm(b.pos.x);
  w.cm(b.pos.y);
  w.cm(b.pos.z);
  w.cm(b.vel.x);
  w.cm(b.vel.y);
  w.cm(b.vel.z);
  w.i16(Math.round(b.spin.y * 100));
  w.i16(b.owner);

  w.u8(world.pickups.length);
  for (const pu of world.pickups) {
    w.u8(pu.id & 0xff);
    w.u8(pu.type);
    w.cm(pu.pos.x);
    w.cm(pu.pos.z);
    w.u8(Math.min(255, Math.round(pu.respawn * 10)));
  }

  w.cm(world.referee.pos.x);
  w.cm(world.referee.pos.z);
  w.angle(world.referee.facing);
  w.unit(world.referee.whistle);

  const events = world.events.slice(0, 24);
  w.u8(events.length);
  for (const e of events) encodeEvent(w, e);

  return w.bytes();
}

function encodeEvent(w: Writer, e: GameEvent): void {
  switch (e.t) {
    case 'kick':
      w.u8(EV.kick);
      w.u8(KICK_KINDS.indexOf(e.kind));
      w.u16(e.player);
      w.unit(e.power);
      break;
    case 'tackle':
      w.u8(EV.tackle);
      w.u8((e.kind === 'slide' ? 1 : 0) | (e.won ? 2 : 0));
      w.u16(e.player);
      break;
    case 'foul':
      w.u8(EV.foul);
      w.u16(e.player);
      w.u16(e.victim);
      break;
    case 'goal':
      w.u8(EV.goal);
      w.u8(e.team);
      w.u16(e.scorer < 0 ? 0xffff : e.scorer);
      w.unit(Math.min(1, e.power));
      break;
    case 'save':
      w.u8(EV.save);
      w.u16(e.player);
      break;
    case 'post':
      w.u8(EV.post);
      w.cm(e.x);
      w.cm(e.z);
      break;
    case 'whistle':
      w.u8(EV.whistle);
      w.u8(WHISTLE_KINDS.indexOf(e.kind));
      break;
    case 'pickup':
      w.u8(EV.pickup);
      w.u16(e.player);
      w.u8(e.type);
      break;
    case 'bounce':
      w.u8(EV.bounce);
      w.cm(e.x);
      w.cm(e.y);
      w.cm(e.z);
      w.u8(Math.min(255, Math.round(e.speed * 8)));
      break;
    case 'wall':
      w.u8(EV.wall);
      w.cm(e.x);
      w.cm(e.z);
      w.u8(Math.min(255, Math.round(e.speed * 8)));
      break;
    case 'chance':
      w.u8(EV.chance);
      w.u8(e.team);
      break;
  }
}

function decodeEvent(r: Reader): GameEvent | null {
  const type = r.u8();
  switch (type) {
    case EV.kick: {
      const kind = KICK_KINDS[r.u8()] ?? 'pass';
      return { t: 'kick', kind, player: r.u16(), power: r.unit() };
    }
    case EV.tackle: {
      const flags = r.u8();
      return {
        t: 'tackle',
        kind: flags & 1 ? 'slide' : 'shoulder',
        won: (flags & 2) !== 0,
        player: r.u16(),
      };
    }
    case EV.foul:
      return { t: 'foul', player: r.u16(), victim: r.u16() };
    case EV.goal: {
      const team = r.u8();
      const scorer = r.u16();
      return { t: 'goal', team, scorer: scorer === 0xffff ? -1 : scorer, power: r.unit() };
    }
    case EV.save:
      return { t: 'save', player: r.u16() };
    case EV.post:
      return { t: 'post', x: r.cm(), z: r.cm() };
    case EV.whistle:
      return { t: 'whistle', kind: WHISTLE_KINDS[r.u8()] ?? 'kickoff' };
    case EV.pickup:
      return { t: 'pickup', player: r.u16(), type: r.u8() };
    case EV.bounce:
      return { t: 'bounce', x: r.cm(), y: r.cm(), z: r.cm(), speed: r.u8() / 8 };
    case EV.wall:
      return { t: 'wall', x: r.cm(), z: r.cm(), speed: r.u8() / 8 };
    case EV.chance:
      return { t: 'chance', team: r.u8() };
    default:
      return null;
  }
}

export function decodeSnapshot(data: ArrayBuffer | Uint8Array): Snapshot | null {
  const r = new Reader(data);
  if (r.u8() !== MSG_SNAPSHOT) return null;
  const snap: Snapshot = {
    tick: r.u32(),
    serverTime: r.u32(),
    phase: r.u8(),
    phaseTimer: r.u16() / 100,
    clock: r.u16() / 10,
    duration: r.u16(),
    score: [0, 0],
    goalCount: 0,
    players: [],
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spinY: 0, owner: -1 },
    pickups: [],
    referee: { x: 0, z: 0, facing: 0, whistle: 0 },
    events: [],
  };
  snap.score = [r.u8(), r.u8()];
  snap.goalCount = r.u8();

  const playerCount = r.u8();
  for (let i = 0; i < playerCount; i++) {
    const id = r.u16();
    const flags = r.u8();
    snap.players.push({
      id,
      team: flags & 1,
      role: (flags >> 1) & 7,
      bot: (flags & 16) !== 0,
      controlled: (flags & 32) !== 0,
      x: r.cm(),
      z: r.cm(),
      vx: r.cm(),
      vz: r.cm(),
      facing: r.angle(),
      act: r.u8(),
      actTimer: r.u8() / 100,
      stamina: r.unit(),
      powerup: r.u8(),
      powerupTimer: r.u8() / 10,
      kickFx: r.unit(),
      charge: r.unit(),
      lastSeq: r.u16(),
    });
  }

  snap.ball = {
    x: r.cm(),
    y: r.cm(),
    z: r.cm(),
    vx: r.cm(),
    vy: r.cm(),
    vz: r.cm(),
    spinY: r.i16() / 100,
    owner: r.i16(),
  };

  const pickupCount = r.u8();
  for (let i = 0; i < pickupCount; i++) {
    snap.pickups.push({
      id: r.u8(),
      type: r.u8(),
      x: r.cm(),
      z: r.cm(),
      respawn: r.u8() / 10,
    });
  }

  snap.referee = { x: r.cm(), z: r.cm(), facing: r.angle(), whistle: r.unit() };

  const eventCount = r.u8();
  for (let i = 0; i < eventCount && !r.done; i++) {
    const e = decodeEvent(r);
    if (e) snap.events.push(e);
  }
  return snap;
}

/**
 * Rebuild a full input sequence number from the 16-bit ack in a snapshot,
 * using the client's current sequence as the reference window.
 */
export function expandSeq(ack16: number, current: number): number {
  const base = current & ~0xffff;
  let seq = base + ack16;
  if (seq > current) seq -= 0x10000;
  return seq;
}
