import {
  BALL_RADIUS,
  DEFAULT_MATCH_SECONDS,
  DEFAULT_TEAM_SIZE,
  HALF_LENGTH,
  KICKOFF_DELAY,
  MAX_TEAM_SIZE,
  MIN_TEAM_SIZE,
  STAMINA_MAX,
} from '../constants.js';
import { Rng, v2, v3, clamp } from '../math.js';
import {
  MatchPhase,
  PlayerAct,
  PowerupType,
  Role,
  type PlayerState,
  type Team,
  type World,
  type WorldConfig,
} from '../types.js';
import { attackDir, formationFor, kickoffPosition, slotToWorld } from './formation.js';

/** Nicknames for the bots. Pure barrio flavour, nobody real. */
export const BOT_NAMES = [
  'El Chino',
  'Rulo',
  'Cabezon',
  'Toto',
  'Mono',
  'Chapa',
  'Beto',
  'El Loco',
  'Turbo',
  'Pipa',
  'Cachete',
  'Nano',
  'Tuti',
  'Zurdo',
  'Gordo',
  'Flaco',
  'Tigre',
  'Pulga',
  'Chicho',
  'Bicho',
  'Coco',
  'Lobo',
  'Mosca',
  'Pocho',
];

export function defaultConfig(): WorldConfig {
  return {
    teamSize: DEFAULT_TEAM_SIZE,
    matchSeconds: DEFAULT_MATCH_SECONDS,
    powerupsEnabled: true,
    botDifficulty: 0.68,
  };
}

export function sanitizeConfig(cfg: Partial<WorldConfig>): Partial<WorldConfig> {
  const out: Partial<WorldConfig> = {};
  if (typeof cfg.teamSize === 'number') {
    out.teamSize = clamp(Math.round(cfg.teamSize), MIN_TEAM_SIZE, MAX_TEAM_SIZE);
  }
  if (typeof cfg.matchSeconds === 'number') {
    out.matchSeconds = clamp(Math.round(cfg.matchSeconds), 60, 1800);
  }
  if (typeof cfg.powerupsEnabled === 'boolean') out.powerupsEnabled = cfg.powerupsEnabled;
  if (typeof cfg.botDifficulty === 'number') out.botDifficulty = clamp(cfg.botDifficulty, 0, 1);
  return out;
}

export function makePlayer(
  id: number,
  team: Team,
  slot: number,
  role: Role,
  name: string,
  bot: boolean,
): PlayerState {
  return {
    id,
    team,
    role,
    slot,
    bot,
    name,
    pos: v3(0, 0, 0),
    vel: v2(0, 0),
    facing: attackDir(team) > 0 ? Math.PI / 2 : -Math.PI / 2,
    act: PlayerAct.Idle,
    actTimer: 0,
    stamina: STAMINA_MAX,
    kickCooldown: 0,
    tackleCooldown: 0,
    touchCooldown: 0,
    passCharge: -1,
    shootCharge: -1,
    lobCharge: -1,
    powerup: PowerupType.None,
    powerupTimer: 0,
    kickFx: 0,
    controlled: false,
    lastSeq: 0,
    lastButtons: 0,
    slideX: 0,
    slideZ: 0,
  };
}

/** Build a full world with both teams populated by bots. */
export function createWorld(config: Partial<WorldConfig> = {}, seed = Date.now() >>> 0): World {
  const cfg: WorldConfig = { ...defaultConfig(), ...sanitizeConfig(config) };
  const rng = new Rng(seed);
  const world: World = {
    tick: 0,
    time: 0,
    config: cfg,
    players: [],
    ball: {
      pos: v3(0, BALL_RADIUS, 0),
      vel: v3(0, 0, 0),
      spin: v3(0, 0, 0),
      lastTouch: -1,
      lastTouchTeam: -1,
      owner: -1,
      sinceKick: 999,
    },
    pickups: [],
    match: {
      phase: MatchPhase.Warmup,
      phaseTimer: 2,
      clock: cfg.matchSeconds,
      duration: cfg.matchSeconds,
      score: [0, 0],
      restartTeam: 0,
      restartPos: v3(0, BALL_RADIUS, 0),
      lastScorer: -1,
      lastScorerTeam: -1,
      goalCount: 0,
    },
    referee: { pos: v3(0, 0, 10), facing: 0, whistle: 0 },
    rngState: rng.state,
    events: [],
    powerupTimer: 6,
    nextPickupId: 1,
    stall: { timer: 0, x: 0, z: 0 },
  };

  rebuildRosters(world, rng);
  resetForKickoff(world, 0);
  world.match.phase = MatchPhase.Warmup;
  world.match.phaseTimer = 1.5;
  return world;
}

/**
 * Rebuild both squads to match config.teamSize, preserving whoever is already
 * in a slot (so a live team-size change does not evict humans).
 */
export function rebuildRosters(world: World, rng = new Rng(world.rngState)): void {
  const size = world.config.teamSize;
  const formation = formationFor(size);
  const kept: PlayerState[] = [];
  let nextId = 1;
  for (const p of world.players) nextId = Math.max(nextId, p.id + 1);

  for (const team of [0, 1] as Team[]) {
    const existing = world.players.filter((p) => p.team === team).sort((a, b) => a.slot - b.slot);
    // Humans keep their place first, then bots fill what is left.
    const humans = existing.filter((p) => !p.bot);
    const bots = existing.filter((p) => p.bot);
    for (let slot = 0; slot < size; slot++) {
      const spec = formation[slot];
      let p = humans.shift() ?? bots.shift();
      if (!p) {
        p = makePlayer(nextId++, team, slot, spec.role, rng.pick(BOT_NAMES), true);
      }
      p.team = team;
      p.slot = slot;
      p.role = spec.role;
      kept.push(p);
    }
  }
  world.players = kept.sort((a, b) => a.team - b.team || a.slot - b.slot);
  world.rngState = rng.state;
}

export function playerById(world: World, id: number): PlayerState | undefined {
  return world.players.find((p) => p.id === id);
}

export function teamPlayers(world: World, team: Team): PlayerState[] {
  return world.players.filter((p) => p.team === team);
}

/** Place everyone in formation for a kickoff taken by `kickingTeam`. */
export function resetForKickoff(world: World, kickingTeam: Team): void {
  const formation = formationFor(world.config.teamSize);
  for (const team of [0, 1] as Team[]) {
    const squad = teamPlayers(world, team);
    for (const p of squad) {
      const spec = formation[Math.min(p.slot, formation.length - 1)];
      const pos = kickoffPosition(spec, p.slot, squad.length, team, team === kickingTeam);
      setPlayerAt(p, pos.x, pos.z);
      p.facing = attackDir(team) > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }
  world.ball.pos = v3(0, BALL_RADIUS, 0);
  world.ball.vel = v3(0, 0, 0);
  world.ball.spin = v3(0, 0, 0);
  world.ball.owner = -1;
  world.ball.lastTouch = -1;
  world.ball.lastTouchTeam = -1;
  world.ball.sinceKick = 999;
  world.match.phase = MatchPhase.Kickoff;
  world.match.phaseTimer = KICKOFF_DELAY;
  world.match.restartTeam = kickingTeam;
  world.match.restartPos = v3(0, BALL_RADIUS, 0);
  world.referee.pos = v3(0, 0, 11);
}

/** Reset formation shape for a free kick without moving the ball. */
export function resetForFreeKick(world: World, team: Team, x: number, z: number): void {
  world.match.phase = MatchPhase.FreeKick;
  world.match.phaseTimer = 0;
  world.match.restartTeam = team;
  world.match.restartPos = v3(x, BALL_RADIUS, z);
  world.ball.pos = v3(x, BALL_RADIUS, z);
  world.ball.vel = v3(0, 0, 0);
  world.ball.spin = v3(0, 0, 0);
  world.ball.owner = -1;
  world.ball.sinceKick = 999;
}

export function setPlayerAt(p: PlayerState, x: number, z: number): void {
  p.pos.x = x;
  p.pos.y = 0;
  p.pos.z = z;
  p.vel.x = 0;
  p.vel.z = 0;
  p.act = PlayerAct.Idle;
  p.actTimer = 0;
  p.passCharge = -1;
  p.shootCharge = -1;
  p.lobCharge = -1;
  p.kickCooldown = 0;
  p.tackleCooldown = 0;
  p.touchCooldown = 0;
}

/** Home position for AI: formation slot pushed/pulled by where the ball is. */
export function homePosition(world: World, p: PlayerState): { x: number; z: number } {
  const formation = formationFor(world.config.teamSize);
  const spec = formation[Math.min(p.slot, formation.length - 1)];
  const base = slotToWorld(spec, p.team);
  if (p.role === Role.Keeper) return base;

  const dir = attackDir(p.team);
  const ballX = world.ball.pos.x;
  // Team shifts up to ~14m with the ball, and slides across with it.
  const shift = clamp((ballX * dir) / HALF_LENGTH, -1, 1);
  const push = p.role === Role.Defender ? 9 : p.role === Role.Midfielder ? 12 : 13;
  const x = clamp(base.x + shift * push * dir, -HALF_LENGTH + 4, HALF_LENGTH - 4);
  const lateral = clamp(world.ball.pos.z * 0.42, -12, 12);
  const z = base.z * 0.85 + lateral;
  return { x, z };
}
