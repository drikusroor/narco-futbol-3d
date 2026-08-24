import { TICK_DT } from '@shared/constants.js';
import { clearEvents, createWorld, stepWorld } from '@shared/sim/index.js';
import {
  emptyInput,
  Role,
  type GameEvent,
  type PlayerInput,
  type Team,
  type World,
} from '@shared/types.js';
import { BotBrain } from '../../../server/ai/bot.js';

export interface LocalMatchOptions {
  teamSize: number;
  matchSeconds: number;
  difficulty: number;
  powerups: boolean;
  /** One name per local human, in order. Length 1 or 2. */
  names: string[];
  team: Team;
}

/**
 * Runs the exact same authoritative simulation the server does, in-process,
 * with no network involved. Bots fill every shirt a local human is not
 * standing in - the same `rebuildRosters` shape a live room ends up with.
 */
export class LocalMatch {
  readonly world: World;
  /** Player entity ids for each local human, in the order given at construction. */
  readonly humanIds: number[] = [];
  private brains = new Map<number, BotBrain>();
  private accumulator = 0;
  private seed: number;

  constructor(opts: LocalMatchOptions) {
    this.seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.world = createWorld(
      {
        teamSize: opts.teamSize,
        matchSeconds: opts.matchSeconds,
        botDifficulty: opts.difficulty,
        powerupsEnabled: opts.powerups,
      },
      this.seed,
    );
    this.claimHumans(opts.team, opts.names);
    this.syncBrains();
  }

  /** Hand a shirt on `team` to each local human, outfield first, keeper last resort. */
  private claimHumans(team: Team, names: string[]): void {
    for (const name of names) {
      const candidate = this.world.players
        .filter((p) => p.team === team && p.bot && p.role !== Role.Keeper)
        .sort((a, b) => b.slot - a.slot)[0];
      const slot = candidate ?? this.world.players.filter((p) => p.team === team && p.bot)[0];
      if (!slot) continue;
      slot.bot = false;
      slot.controlled = true;
      slot.name = name;
      this.humanIds.push(slot.id);
    }
  }

  private syncBrains(): void {
    this.brains.clear();
    for (const p of this.world.players) {
      if (p.bot) this.brains.set(p.id, new BotBrain(p.id, (this.seed ^ (p.id * 2654435761)) >>> 0));
    }
  }

  playerTeam(id: number): Team {
    return (this.world.players.find((p) => p.id === id)?.team ?? 0) as Team;
  }

  playerRole(id: number): Role {
    return this.world.players.find((p) => p.id === id)?.role ?? Role.Midfielder;
  }

  /**
   * Advance by `dt`, feeding `humanInputs` (keyed by player id) into whichever
   * ticks land this frame. Returns every event raised across all of them,
   * since a slow frame can cover more than one tick and each only keeps its
   * own.
   */
  pump(dt: number, humanInputs: Map<number, PlayerInput>): GameEvent[] {
    const events: GameEvent[] = [];
    this.accumulator += Math.min(dt, 0.25);
    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;
      clearEvents(this.world);
      const inputs = new Map<number, PlayerInput>();
      for (const p of this.world.players) {
        if (p.bot) {
          const brain = this.brains.get(p.id);
          if (brain) inputs.set(p.id, brain.think(this.world, p, TICK_DT));
        } else {
          inputs.set(p.id, humanInputs.get(p.id) ?? emptyInput());
        }
      }
      stepWorld(this.world, inputs, TICK_DT);
      if (this.world.events.length) events.push(...this.world.events);
    }
    return events;
  }
}
