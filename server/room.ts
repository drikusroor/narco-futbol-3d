import { SNAPSHOT_INTERVAL_TICKS, TICK_DT, TICK_RATE } from '@shared/constants.js';
import { dist2 } from '@shared/math.js';
import { encodeSnapshot } from '@shared/protocol.js';
import {
  BTN,
  MatchPhase,
  Role,
  emptyInput,
  type ClientMessage,
  type LobbyPlayerInfo,
  type PlayerInput,
  type PlayerState,
  type ServerMessage,
  type Team,
  type World,
  type WorldConfig,
} from '@shared/types.js';
import {
  BOT_NAMES,
  clearEvents,
  createWorld,
  rebuildRosters,
  resetMatch,
  sanitizeConfig,
  stepWorld,
} from '@shared/sim/index.js';
import { BotBrain } from './ai/bot.js';

export interface Client {
  id: number;
  /** The player entity this client is currently driving. */
  playerId: number;
  name: string;
  ping: number;
  lastPingSent: number;
  send(data: string | ArrayBuffer): void;
  close(): void;
}

/** Inputs land here as they arrive and are consumed by the next tick. */
interface ClientInput {
  latest: PlayerInput;
  lastSeq: number;
}

export class Room {
  readonly name: string;
  readonly world: World;
  private clients = new Map<number, Client>();
  private inputs = new Map<number, ClientInput>();
  private brains = new Map<number, BotBrain>();
  private timer: NodeJS.Timeout | null = null;
  private accumulator = 0;
  private lastStep = 0;
  private tickCounter = 0;
  private nextClientId = 1;
  private seed: number;

  constructor(name: string, config: Partial<WorldConfig> = {}) {
    this.name = name;
    this.seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.world = createWorld(config, this.seed);
    this.syncBrains();
  }

  get playerCount(): number {
    return this.clients.size;
  }

  get isEmpty(): boolean {
    return this.clients.size === 0;
  }

  // --- lifecycle ------------------------------------------------------------

  private start(): void {
    if (this.timer) return;
    this.lastStep = Date.now();
    this.accumulator = 0;
    this.timer = setInterval(() => this.pump(), 1000 / TICK_RATE);
  }

  private stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
    for (const c of this.clients.values()) c.close();
    this.clients.clear();
  }

  /**
   * Fixed-timestep loop. The interval is only a heartbeat; the accumulator is
   * what keeps the simulation at exactly 60 Hz regardless of timer drift.
   */
  private pump(): void {
    const now = Date.now();
    let elapsed = (now - this.lastStep) / 1000;
    this.lastStep = now;
    // A long stall (GC, suspended container) must not spiral into a catch-up storm.
    if (elapsed > 0.25) elapsed = 0.25;
    this.accumulator += elapsed;

    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;
      this.tick(now);
    }
  }

  private tick(now: number): void {
    const world = this.world;
    clearEvents(world);

    const inputs = new Map<number, PlayerInput>();
    for (const p of world.players) {
      if (p.bot) {
        const brain = this.brains.get(p.id);
        if (brain) inputs.set(p.id, brain.think(world, p, TICK_DT));
      } else {
        const ci = this.inputs.get(p.id);
        if (ci) inputs.set(p.id, ci.latest);
      }
    }

    stepWorld(world, inputs, TICK_DT);

    this.tickCounter++;
    if (this.tickCounter % SNAPSHOT_INTERVAL_TICKS === 0) {
      const buf = encodeSnapshot(world, now);
      for (const c of this.clients.values()) c.send(buf);
    }
    if (this.tickCounter % (TICK_RATE * 2) === 0) this.heartbeat(now);
  }

  private heartbeat(now: number): void {
    for (const c of this.clients.values()) {
      c.lastPingSent = now;
      this.sendJson(c, { t: 'ping', time: now });
    }
  }

  // --- joining / leaving ----------------------------------------------------

  join(transport: Pick<Client, 'send' | 'close'>, name: string, preferred?: Team): Client | null {
    const slot = this.pickSlot(preferred);
    if (!slot) return null;

    const full: Client = {
      ...transport,
      id: this.nextClientId++,
      playerId: slot.id,
      name,
      ping: 0,
      lastPingSent: 0,
    };
    slot.bot = false;
    slot.name = name;
    slot.controlled = true;
    this.brains.delete(slot.id);
    this.clients.set(full.id, full);
    this.inputs.set(slot.id, { latest: emptyInput(), lastSeq: 0 });

    this.sendJson(full, {
      t: 'welcome',
      playerId: slot.id,
      room: this.name,
      config: this.world.config,
      tickRate: TICK_RATE,
      snapshotRate: TICK_RATE / SNAPSHOT_INTERVAL_TICKS,
    });
    this.broadcastLobby();
    this.broadcastNotice(`${name} joined ${teamName(slot.team)}`);
    this.start();
    return full;
  }

  leave(clientId: number): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    const p = this.world.players.find((x) => x.id === client.playerId);
    if (p) {
      // Hand the shirt back to a bot so the match keeps its shape.
      p.bot = true;
      p.name = BOT_NAMES[(p.id * 7) % BOT_NAMES.length];
      p.controlled = false;
      this.brains.set(p.id, new BotBrain(p.id, (this.seed ^ (p.id * 2654435761)) >>> 0));
      this.inputs.delete(p.id);
    }
    this.clients.delete(clientId);
    this.broadcastLobby();
    this.broadcastNotice(`${client.name} left`);
    if (this.isEmpty) this.stop();
  }

  /** Prefer the thinner team, then the most advanced free shirt on it. */
  private pickSlot(preferred?: Team): PlayerState | null {
    const humans: [number, number] = [0, 0];
    for (const p of this.world.players) if (!p.bot) humans[p.team]++;
    const thinner: Team = humans[0] <= humans[1] ? 0 : 1;
    const order: Team[] =
      preferred === 0 || preferred === 1
        ? [preferred, (1 - preferred) as Team]
        : [thinner, (1 - thinner) as Team];

    for (const team of order) {
      const candidate = this.world.players
        .filter((p) => p.team === team && p.bot && p.role !== Role.Keeper)
        .sort((a, b) => b.slot - a.slot)[0];
      if (candidate) return candidate;
    }
    return null;
  }

  // --- messages -------------------------------------------------------------

  handleInput(client: Client, batch: PlayerInput[]): void {
    const state = this.inputs.get(client.playerId);
    if (!state) return;
    const wasSwitch = (state.latest.buttons & BTN.SWITCH) !== 0;
    for (const inp of batch) {
      if (inp.seq <= state.lastSeq) continue;
      state.lastSeq = inp.seq;
      state.latest = inp;
    }
    // Buttons that are edge-triggered in the sim need the newest state only;
    // the batch exists so a dropped packet does not eat a press.
    if (!wasSwitch && (state.latest.buttons & BTN.SWITCH) !== 0) {
      this.requestSwitch(client);
    }
  }

  handleJson(client: Client, msg: ClientMessage): void {
    switch (msg.t) {
      case 'pong': {
        const rtt = Date.now() - msg.time;
        client.ping = Math.round(rtt);
        break;
      }
      case 'chat': {
        const text = String(msg.text ?? '').slice(0, 160);
        if (!text.trim()) break;
        const p = this.world.players.find((x) => x.id === client.playerId);
        this.broadcastJson({ t: 'chat', from: client.name, text, team: p?.team ?? 0 });
        break;
      }
      case 'switchTeam': {
        this.switchTeam(client, msg.team);
        break;
      }
      case 'config': {
        this.applyConfig(client, msg);
        break;
      }
      default:
        break;
    }
  }

  private applyConfig(client: Client, msg: Extract<ClientMessage, { t: 'config' }>): void {
    const patch = sanitizeConfig({
      matchSeconds: msg.matchSeconds,
      teamSize: msg.teamSize,
      powerupsEnabled: msg.powerups,
      botDifficulty: msg.difficulty,
    });
    const world = this.world;
    let restart = false;
    if (patch.teamSize !== undefined && patch.teamSize !== world.config.teamSize) {
      world.config.teamSize = patch.teamSize;
      rebuildRosters(world);
      this.syncBrains();
      restart = true;
    }
    if (patch.matchSeconds !== undefined && patch.matchSeconds !== world.config.matchSeconds) {
      world.config.matchSeconds = patch.matchSeconds;
      restart = true;
    }
    if (patch.powerupsEnabled !== undefined) world.config.powerupsEnabled = patch.powerupsEnabled;
    if (patch.botDifficulty !== undefined) world.config.botDifficulty = patch.botDifficulty;

    if (restart) {
      resetMatch(world);
      this.reseatClients();
    }
    this.broadcastNotice(`${client.name} changed the match settings`);
    this.broadcastLobby();
  }

  private switchTeam(client: Client, team: Team): void {
    if (team !== 0 && team !== 1) return;
    const current = this.world.players.find((p) => p.id === client.playerId);
    if (!current || current.team === team) return;
    const target = this.world.players
      .filter((p) => p.team === team && p.bot && p.role !== Role.Keeper)
      .sort((a, b) => b.slot - a.slot)[0];
    if (!target) return;

    // Swap the human into the bot's shirt and give the bot the old one.
    current.bot = true;
    current.name = BOT_NAMES[(current.id * 7) % BOT_NAMES.length];
    current.controlled = false;
    this.brains.set(current.id, new BotBrain(current.id, (this.seed ^ (current.id * 40503)) >>> 0));
    this.inputs.delete(current.id);

    target.bot = false;
    target.name = client.name;
    this.brains.delete(target.id);
    client.playerId = target.id;
    this.inputs.set(target.id, { latest: emptyInput(), lastSeq: 0 });
    this.sendJson(client, {
      t: 'welcome',
      playerId: target.id,
      room: this.name,
      config: this.world.config,
      tickRate: TICK_RATE,
      snapshotRate: TICK_RATE / SNAPSHOT_INTERVAL_TICKS,
    });
    this.broadcastLobby();
  }

  /**
   * Player switching: hand control to whichever team-mate is best placed for
   * the ball, the way an arcade football game does when you are defending.
   */
  requestSwitch(client: Client): void {
    const current = this.world.players.find((p) => p.id === client.playerId);
    if (!current) return;
    if (this.world.ball.owner === current.id) return;
    let best: PlayerState | null = null;
    let bestD = Infinity;
    for (const p of this.world.players) {
      if (p.team !== current.team || p.id === current.id) continue;
      if (!p.bot || p.role === Role.Keeper) continue;
      const d = dist2(p.pos, this.world.ball.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return;
    const myD = dist2(current.pos, this.world.ball.pos);
    if (myD <= bestD + 1) return; // already the closest, nothing to switch to

    const name = client.name;
    current.bot = true;
    current.name = BOT_NAMES[(current.id * 13) % BOT_NAMES.length];
    current.controlled = false;
    this.brains.set(current.id, new BotBrain(current.id, (this.seed ^ (current.id * 22695477)) >>> 0));
    this.inputs.delete(current.id);

    best.bot = false;
    best.name = name;
    best.controlled = true;
    this.brains.delete(best.id);
    client.playerId = best.id;
    this.inputs.set(best.id, { latest: emptyInput(), lastSeq: 0 });
    this.sendJson(client, {
      t: 'welcome',
      playerId: best.id,
      room: this.name,
      config: this.world.config,
      tickRate: TICK_RATE,
      snapshotRate: TICK_RATE / SNAPSHOT_INTERVAL_TICKS,
    });
    this.broadcastLobby();
  }

  // --- helpers --------------------------------------------------------------

  /** Ensure every bot has a brain and no human does. */
  private syncBrains(): void {
    for (const p of this.world.players) {
      if (p.bot && !this.brains.has(p.id)) {
        this.brains.set(p.id, new BotBrain(p.id, (this.seed ^ (p.id * 2246822519)) >>> 0));
      }
      if (!p.bot) this.brains.delete(p.id);
    }
    for (const id of [...this.brains.keys()]) {
      if (!this.world.players.some((p) => p.id === id)) this.brains.delete(id);
    }
  }

  /** After a roster rebuild, make sure every client still drives a real player. */
  private reseatClients(): void {
    for (const c of this.clients.values()) {
      const p = this.world.players.find((x) => x.id === c.playerId);
      if (p) {
        p.bot = false;
        p.name = c.name;
        this.brains.delete(p.id);
        if (!this.inputs.has(p.id)) this.inputs.set(p.id, { latest: emptyInput(), lastSeq: 0 });
        continue;
      }
      const slot = this.pickSlot();
      if (!slot) continue;
      slot.bot = false;
      slot.name = c.name;
      c.playerId = slot.id;
      this.brains.delete(slot.id);
      this.inputs.set(slot.id, { latest: emptyInput(), lastSeq: 0 });
      this.sendJson(c, {
        t: 'welcome',
        playerId: slot.id,
        room: this.name,
        config: this.world.config,
        tickRate: TICK_RATE,
        snapshotRate: TICK_RATE / SNAPSHOT_INTERVAL_TICKS,
      });
    }
    this.syncBrains();
  }

  lobbyInfo(): LobbyPlayerInfo[] {
    const byPlayer = new Map<number, Client>();
    for (const c of this.clients.values()) byPlayer.set(c.playerId, c);
    return this.world.players.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      bot: p.bot,
      ping: byPlayer.get(p.id)?.ping ?? 0,
    }));
  }

  sendJson(client: Client, msg: ServerMessage): void {
    client.send(JSON.stringify(msg));
  }

  broadcastJson(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const c of this.clients.values()) c.send(data);
  }

  broadcastLobby(): void {
    this.broadcastJson({
      t: 'lobby',
      players: this.lobbyInfo(),
      score: this.world.match.score,
      phase: this.world.match.phase,
    });
  }

  broadcastNotice(text: string): void {
    this.broadcastJson({ t: 'notice', text });
  }

  get status(): { name: string; humans: number; phase: MatchPhase; score: [number, number] } {
    return {
      name: this.name,
      humans: this.clients.size,
      phase: this.world.match.phase,
      score: this.world.match.score,
    };
  }
}

function teamName(team: Team): string {
  return team === 0 ? 'Medallo' : 'Cali';
}
