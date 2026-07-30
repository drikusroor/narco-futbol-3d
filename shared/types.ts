import type { Vec2, Vec3 } from './math.js';

// --- Input ------------------------------------------------------------------

/** Button bits packed into PlayerInput.buttons. */
export const BTN = {
  SPRINT: 1 << 0,
  PASS: 1 << 1,
  SHOOT: 1 << 2,
  LOB: 1 << 3,
  TACKLE: 1 << 4,
  SWITCH: 1 << 5,
} as const;

/**
 * One tick of intent from a controller (human or bot). Held-button state is
 * sent every tick rather than as edges, so a dropped packet self-heals on the
 * next one and the server stays the authority on charge times.
 */
export interface PlayerInput {
  seq: number;
  /** Desired move direction in world space, magnitude 0..1. */
  moveX: number;
  moveZ: number;
  buttons: number;
  /** Where the player is aiming (heading in radians); usually the move dir. */
  aim: number;
}

export function emptyInput(seq = 0): PlayerInput {
  return { seq, moveX: 0, moveZ: 0, buttons: 0, aim: 0 };
}

export function hasBtn(input: PlayerInput, bit: number): boolean {
  return (input.buttons & bit) !== 0;
}

// --- Player -----------------------------------------------------------------

export type Team = 0 | 1;

export enum Role {
  Keeper = 0,
  Defender = 1,
  Midfielder = 2,
  Winger = 3,
  Striker = 4,
}

export enum PlayerAct {
  Idle = 0,
  Run = 1,
  Kick = 2,
  Tackle = 3,
  Slide = 4,
  Stunned = 5,
  Celebrate = 6,
  Dive = 7,
}

export enum PowerupType {
  None = 0,
  /** "Polvo Blanco" - raw pace. */
  Speed = 1,
  /** "Polvora" - shot power. */
  Power = 2,
  /** "El Patron" - strength in the challenge. */
  Strength = 3,
  /** "Vision" - crisper, faster passing. */
  Vision = 4,
}

export const POWERUP_TYPES: PowerupType[] = [
  PowerupType.Speed,
  PowerupType.Power,
  PowerupType.Strength,
  PowerupType.Vision,
];

export const POWERUP_INFO: Record<
  number,
  { key: string; label: string; blurb: string; color: number }
> = {
  [PowerupType.Speed]: {
    key: 'speed',
    label: 'Polvo Blanco',
    blurb: 'Everything moves faster. Especially you.',
    color: 0xd8f6ff,
  },
  [PowerupType.Power]: {
    key: 'power',
    label: 'Polvora',
    blurb: 'Shots leave scorch marks.',
    color: 0xff7a2f,
  },
  [PowerupType.Strength]: {
    key: 'strength',
    label: 'El Patron',
    blurb: 'Nobody takes it off you.',
    color: 0xc06bff,
  },
  [PowerupType.Vision]: {
    key: 'vision',
    label: 'Vision',
    blurb: 'Passes find their man.',
    color: 0x5dff9b,
  },
};

export interface PlayerState {
  id: number;
  team: Team;
  role: Role;
  /** Formation slot index within the team; 0 is always the keeper. */
  slot: number;
  bot: boolean;
  name: string;
  pos: Vec3;
  vel: Vec2;
  facing: number;
  act: PlayerAct;
  actTimer: number;
  stamina: number;
  kickCooldown: number;
  tackleCooldown: number;
  touchCooldown: number;
  /** Charge timers, seconds the button has been held. */
  passCharge: number;
  shootCharge: number;
  lobCharge: number;
  powerup: PowerupType;
  powerupTimer: number;
  /** Set for one tick when this player kicked; drives client SFX. */
  kickFx: number;
  /** True while this player is the closest controllable target for a human. */
  controlled: boolean;
  /** Server-side book-keeping: last input applied. */
  lastSeq: number;
  /** Previous tick's button mask, for press/release edge detection. */
  lastButtons: number;
  /** Direction locked in when a slide started. */
  slideX: number;
  slideZ: number;
}

// --- Ball -------------------------------------------------------------------

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  /** Angular velocity, rad/s. Y component curves the ball. */
  spin: Vec3;
  /** Player id that touched it last, -1 if nobody. */
  lastTouch: number;
  lastTouchTeam: number;
  /** Player currently dribbling, -1 when the ball is free. */
  owner: number;
  /** Ticks since the ball was last kicked; used for interception grace. */
  sinceKick: number;
}

// --- Power-ups on the pitch -------------------------------------------------

export interface PowerupPickup {
  id: number;
  type: PowerupType;
  pos: Vec3;
  /** > 0 means it is waiting to respawn. */
  respawn: number;
  bob: number;
}

// --- Match ------------------------------------------------------------------

export enum MatchPhase {
  Warmup = 0,
  Kickoff = 1,
  Play = 2,
  GoalCelebration = 3,
  FreeKick = 4,
  FullTime = 5,
}

export interface MatchState {
  phase: MatchPhase;
  phaseTimer: number;
  clock: number; // seconds remaining
  duration: number;
  score: [number, number];
  /** Team that restarts play (kickoff / free kick). */
  restartTeam: Team;
  restartPos: Vec3;
  lastScorer: number;
  lastScorerTeam: number;
  /** Increments on every goal; clients use it to fire celebrations once. */
  goalCount: number;
}

export interface WorldConfig {
  teamSize: number;
  matchSeconds: number;
  powerupsEnabled: boolean;
  botDifficulty: number; // 0..1
}

export interface World {
  tick: number;
  time: number;
  config: WorldConfig;
  players: PlayerState[];
  ball: BallState;
  pickups: PowerupPickup[];
  match: MatchState;
  referee: { pos: Vec3; facing: number; whistle: number };
  rngState: number;
  /** Transient, cleared every tick; drives sound + UI on the client. */
  events: GameEvent[];
  powerupTimer: number;
  nextPickupId: number;
  /** Anti-stall watchdog: how long the ball has sat in one spot. */
  stall: { timer: number; x: number; z: number };
}

// --- Events -----------------------------------------------------------------

export type GameEvent =
  | { t: 'kick'; kind: 'pass' | 'shot' | 'lob' | 'clear'; player: number; power: number }
  | { t: 'tackle'; kind: 'shoulder' | 'slide'; player: number; won: boolean }
  | { t: 'foul'; player: number; victim: number }
  | { t: 'goal'; team: number; scorer: number; power: number }
  | { t: 'save'; player: number }
  | { t: 'post'; x: number; z: number }
  | { t: 'whistle'; kind: 'kickoff' | 'goal' | 'foul' | 'fulltime' }
  | { t: 'pickup'; player: number; type: PowerupType }
  | { t: 'bounce'; x: number; y: number; z: number; speed: number }
  | { t: 'wall'; x: number; z: number; speed: number }
  | { t: 'chance'; team: number };

// --- Network messages (JSON control channel) --------------------------------

export interface LobbyPlayerInfo {
  id: number;
  name: string;
  team: Team;
  bot: boolean;
  ping: number;
}

export type ClientMessage =
  | { t: 'join'; name: string; room?: string; team?: Team }
  | { t: 'switchTeam'; team: Team }
  | { t: 'ready'; ready: boolean }
  | { t: 'chat'; text: string }
  | { t: 'config'; matchSeconds?: number; teamSize?: number; powerups?: boolean; difficulty?: number }
  | { t: 'pong'; time: number };

export type ServerMessage =
  | {
      t: 'welcome';
      playerId: number;
      room: string;
      config: WorldConfig;
      tickRate: number;
      snapshotRate: number;
    }
  | { t: 'lobby'; players: LobbyPlayerInfo[]; score: [number, number]; phase: MatchPhase }
  | { t: 'chat'; from: string; text: string; team: number }
  | { t: 'notice'; text: string }
  | { t: 'ping'; time: number };
