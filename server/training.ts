import { BALL_RADIUS, HALF_LENGTH, HALF_WIDTH, TICK_DT } from '@shared/constants.js';
import { dist2, v3 } from '@shared/math.js';
import {
  MatchPhase,
  PlayerAct,
  Role,
  type DrillId,
  type DrillMarker,
  type DrillReport,
  type DrillStat,
  type PlayerState,
  type Team,
  type World,
} from '@shared/types.js';
import { attackDir, setPlayerAt, targetGoalX } from '@shared/sim/index.js';

/**
 * Solo practice. A drill is just a scenario the server keeps resetting: it
 * parks everyone who is not involved on the touchline, puts the ball where the
 * exercise needs it, and watches the same simulation everyone else plays with.
 * Nothing here changes the rules of football - it only sets up the situation.
 */

const PAUSE_AFTER_GOAL = 1.4;
const PAUSE_AFTER_MISS = 0.9;

/** Shooting positions, as (distance from goal, offset across). */
const SHOT_SPOTS: [number, number][] = [
  [14, 0],
  [17, -9],
  [17, 9],
  [11, -5],
  [11, 5],
  [22, 0],
  [20, -14],
  [20, 14],
];

/** Slalom gates, as (fraction along the attack, offset across). */
const GATES: [number, number][] = [
  [0.22, -7],
  [0.38, 7],
  [0.54, -5],
  [0.7, 6],
  [0.84, 0],
];

/** Tutorial steps at which the team-mate and then the defender come on. */
const TUTORIAL_MATE_STAGE = 4; // "play a pass"
const TUTORIAL_DEFENDER_STAGE = 8; // "win the ball back"

const PASS_TARGETS: [number, number][] = [
  [0.32, -16],
  [0.5, 15],
  [0.66, -9],
  [0.45, 0],
  [0.72, 13],
  [0.28, 8],
];

export class Trainer {
  readonly drill: DrillId;
  private world: World;
  private humanId: number;
  private team: Team = 0;
  private dir = 1;
  private parked = new Set<number>();
  /** Parked players who stand somewhere specific rather than on the touchline. */
  private parkAt = new Map<number, { x: number; z: number }>();

  private markers: DrillMarker[] = [];
  private timer = 0;
  private pause = 0;
  private index = 0;
  private scored = 0;
  private attempts = 0;
  private streak = 0;
  private bestStreak = 0;
  private hits = 0;
  private gate = 0;
  private best = 0;
  private lastBallX = 0;
  private shotTaken = false;
  private sinceShot = 0;
  private lostBall = 0;
  private stage = 0;

  constructor(world: World, drill: DrillId, humanId: number) {
    this.world = world;
    this.drill = drill;
    this.humanId = humanId;
    this.setup();
  }

  /** The human may hand control to a team-mate mid-drill. */
  setHuman(id: number): void {
    this.humanId = id;
  }

  isParked(id: number): boolean {
    return this.parked.has(id);
  }

  private get me(): PlayerState | undefined {
    return this.world.players.find((p) => p.id === this.humanId);
  }

  // --- setup ----------------------------------------------------------------

  private setup(): void {
    const world = this.world;
    world.config.powerupsEnabled = false;
    world.pickups = [];
    const me = this.me;
    this.team = me?.team ?? 0;
    this.dir = attackDir(this.team);

    this.applyRoster();
    this.buildMarkers();
    this.beginRep(1.2);
  }

  /**
   * The tutorial walks through the controls one at a time, and tells us where
   * it has got to. Nobody wants a defender hounding them during "move with
   * WASD", so the cast on the pitch grows as the lesson needs it.
   */
  setStage(stage: number): void {
    if (this.drill !== 'tutorial' || stage === this.stage) return;
    this.stage = stage;
    const before = this.parked.size;
    this.applyRoster();
    if (this.parked.size !== before) this.placeSupport();
  }

  /** Work out who is needed right now; everyone else watches from the touchline. */
  private applyRoster(): void {
    const world = this.world;
    const keep = new Set<number>([this.humanId]);
    const foes = world.players.filter((p) => p.team !== this.team);
    const keeper = foes.find((p) => p.role === Role.Keeper);
    const defender = foes.find((p) => p.role === Role.Defender);
    const mate = world.players.find(
      (p) => p.team === this.team && p.id !== this.humanId && p.role !== Role.Keeper,
    );
    if (this.drill !== 'passing' && keeper) keep.add(keeper.id);
    if (this.drill === 'dribble' && defender) keep.add(defender.id);
    if (this.drill === 'tutorial') {
      if (mate && this.stage >= TUTORIAL_MATE_STAGE) keep.add(mate.id);
      if (defender && this.stage >= TUTORIAL_DEFENDER_STAGE) keep.add(defender.id);
    }

    this.parked.clear();
    for (const p of world.players) {
      if (!keep.has(p.id)) this.parked.add(p.id);
    }
    this.parkEveryone();
  }

  private buildMarkers(): void {
    const gx = targetGoalX(this.team);
    let id = 1;
    this.markers = [];
    if (this.drill === 'shooting') {
      const [d, z] = SHOT_SPOTS[this.index % SHOT_SPOTS.length];
      this.markers.push({ id: id++, kind: 'spot', x: gx - this.dir * d, z: z * this.dir, r: 0.9, active: true });
    } else if (this.drill === 'dribble') {
      GATES.forEach(([f, z], i) => {
        this.markers.push({
          id: id++,
          kind: 'gate',
          x: -this.dir * HALF_LENGTH + this.dir * f * (HALF_LENGTH * 2),
          z: z * this.dir,
          r: 2.4,
          active: i === this.gate,
        });
      });
    } else if (this.drill === 'passing') {
      const [f, z] = PASS_TARGETS[this.index % PASS_TARGETS.length];
      const target = {
        id: id++,
        kind: 'target' as const,
        x: -this.dir * HALF_LENGTH + this.dir * f * (HALF_LENGTH * 2),
        z: z * this.dir,
        r: 4.5,
        active: true,
      };
      this.markers.push(target);
      // Stand a team-mate in the circle. Passing at a man rather than at a
      // patch of grass is both the point of the drill and how doPass aims.
      this.parkAt.clear();
      const mate = this.world.players.find(
        (p) => p.team === this.team && p.id !== this.humanId && p.role !== Role.Keeper,
      );
      if (mate) this.parkAt.set(mate.id, { x: target.x, z: target.z });
    }
  }

  /** Put the ball and the player where this rep starts. */
  private beginRep(delay: number): void {
    const world = this.world;
    const me = this.me;
    this.timer = 0;
    this.shotTaken = false;
    this.sinceShot = 0;
    this.lostBall = 0;
    this.buildMarkers();

    let ballX = 0;
    let ballZ = 0;
    let meX = -this.dir * 6;
    let meZ = 0;

    if (this.drill === 'shooting') {
      const spot = this.markers[0];
      ballX = spot.x;
      ballZ = spot.z;
      meX = spot.x - this.dir * 3.2;
      meZ = spot.z;
    } else if (this.drill === 'dribble') {
      ballX = -this.dir * (HALF_LENGTH - 8);
      ballZ = 0;
      meX = ballX - this.dir * 1.4;
      meZ = 0;
    } else if (this.drill === 'passing') {
      ballX = -this.dir * (HALF_LENGTH * 0.55);
      ballZ = 0;
      meX = ballX - this.dir * 1.2;
      meZ = 0;
    }

    world.ball.pos = v3(ballX, BALL_RADIUS, ballZ);
    world.ball.vel = v3(0, 0, 0);
    world.ball.spin = v3(0, 0, 0);
    world.ball.owner = -1;
    world.ball.lastTouch = -1;
    world.ball.lastTouchTeam = -1;
    world.ball.sinceKick = 999;
    this.lastBallX = ballX;

    if (me) {
      setPlayerAt(me, meX, meZ);
      me.facing = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      me.stamina = 1;
    }
    this.placeSupport();

    // A short frozen "kickoff" gives the whistle and stops anyone jumping the gun.
    const m = world.match;
    m.phase = MatchPhase.Kickoff;
    m.phaseTimer = delay;
    m.restartTeam = this.team;
    m.restartPos = v3(ballX, BALL_RADIUS, ballZ);
    this.pause = 0;
  }

  /** Keeper on his line, defender goal-side, team-mate available for a pass. */
  private placeSupport(): void {
    const gx = targetGoalX(this.team);
    for (const p of this.world.players) {
      if (this.parked.has(p.id) || p.id === this.humanId) continue;
      if (p.role === Role.Keeper) {
        setPlayerAt(p, gx - this.dir * 1.6, 0);
      } else if (p.team !== this.team) {
        // Give the dribbler a head start; the tutorial's marker gets in close
        // because winning the ball back is the whole point of that step.
        const gap = this.drill === 'dribble' ? 16 : 9;
        setPlayerAt(p, this.world.ball.pos.x + this.dir * gap, this.world.ball.pos.z + 3);
      } else {
        setPlayerAt(p, this.world.ball.pos.x + this.dir * 6, this.world.ball.pos.z - 11);
      }
      p.facing = p.team === this.team ? (this.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : this.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    }
  }

  private parkEveryone(): void {
    let n = 0;
    for (const p of this.world.players) {
      if (!this.parked.has(p.id)) continue;
      const spot = this.parkAt.get(p.id);
      if (spot) {
        setPlayerAt(p, spot.x, spot.z);
        p.facing = this.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      } else {
        const side = p.team === 0 ? -1 : 1;
        setPlayerAt(p, -30 + (n % 8) * 5, side * (HALF_WIDTH - 1.4));
        p.facing = side > 0 ? Math.PI : 0;
        n++;
      }
      p.act = PlayerAct.Idle;
      p.stamina = 1;
    }
  }

  // --- per tick --------------------------------------------------------------

  /** Runs straight after stepWorld, with this tick's events still on the world. */
  afterStep(): void {
    const world = this.world;
    const m = world.match;
    // Training never runs out of time.
    m.clock = m.duration;
    this.parkEveryone();

    if (this.pause > 0) {
      this.pause -= TICK_DT;
      if (this.pause <= 0) this.beginRep(0.6);
      return;
    }

    // The drill has to see the tick that scored the goal, so it is judged
    // before the phase is taken into account. A free kick is left to play out:
    // being fouled should not cost you the run you were on.
    if (
      m.phase === MatchPhase.Play ||
      m.phase === MatchPhase.FreeKick ||
      m.phase === MatchPhase.GoalCelebration
    ) {
      this.timer += TICK_DT;
      switch (this.drill) {
        case 'shooting':
          this.stepShooting();
          break;
        case 'dribble':
          this.stepDribble();
          break;
        case 'passing':
          this.stepPassing();
          break;
        default:
          this.stepFree();
          break;
      }
    }
    this.lastBallX = world.ball.pos.x;

    // Anything the drill did not claim - a celebration it does not score, the
    // end of a match that is not being played - folds back into a fresh rep.
    const live =
      m.phase === MatchPhase.Play ||
      m.phase === MatchPhase.Kickoff ||
      m.phase === MatchPhase.FreeKick;
    if (this.pause <= 0 && !live) this.beginRep(0.6);
  }

  private goalForMe(): boolean {
    return this.world.events.some((e) => e.t === 'goal' && e.team === this.team);
  }

  private kickedByMe(): boolean {
    return this.world.events.some((e) => e.t === 'kick' && e.player === this.humanId);
  }

  private stepFree(): void {
    const ball = this.world.ball;
    if (this.goalForMe()) {
      this.scored++;
      this.pause = PAUSE_AFTER_GOAL;
      return;
    }
    // Nudge a ball that has died in a corner back into the middle.
    const dead = Math.hypot(ball.vel.x, ball.vel.z) < 0.4 && ball.owner < 0;
    const me = this.me;
    const far = me ? dist2(me.pos, ball.pos) > 30 : false;
    if (dead && far) {
      this.timer = 0;
      ball.pos = v3(0, BALL_RADIUS, 0);
      ball.vel = v3(0, 0, 0);
    }
  }

  private stepShooting(): void {
    const world = this.world;
    const ball = world.ball;
    if (this.goalForMe()) {
      this.scored++;
      this.attempts++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.index++;
      this.pause = PAUSE_AFTER_GOAL;
      return;
    }
    if (this.kickedByMe()) {
      this.shotTaken = true;
      this.sinceShot = 0;
    }

    const keeperHasIt =
      ball.owner >= 0 && world.players.find((p) => p.id === ball.owner)?.team !== this.team;
    const gx = targetGoalX(this.team);
    const behind = (ball.pos.x - gx) * this.dir > 0.5;
    const stopped = Math.hypot(ball.vel.x, ball.vel.z) < 0.8 && ball.owner < 0;

    if (this.shotTaken) {
      this.sinceShot += TICK_DT;
      if (keeperHasIt || behind || (stopped && this.sinceShot > 1.2) || this.sinceShot > 6) {
        this.missed();
      }
      return;
    }
    // Nobody stands over the ball all day.
    if (this.timer > 15 || keeperHasIt) this.missed();
  }

  private missed(): void {
    this.attempts++;
    this.streak = 0;
    this.index++;
    this.pause = PAUSE_AFTER_MISS;
  }

  private stepDribble(): void {
    const world = this.world;
    const ball = world.ball;
    const me = this.me;
    const mine = ball.owner === this.humanId || (me ? dist2(me.pos, ball.pos) < 2.6 : false);

    // A defender holding on to it for a moment means the run is over.
    const stolen =
      ball.owner >= 0 && world.players.find((p) => p.id === ball.owner)?.team !== this.team;
    this.lostBall = stolen ? this.lostBall + TICK_DT : 0;
    if (this.lostBall > 1) {
      this.gate = 0;
      this.pause = PAUSE_AFTER_MISS;
      this.attempts++;
      return;
    }

    const target = this.markers[this.gate];
    if (!target || !mine) return;
    const crossed =
      (this.lastBallX - target.x) * this.dir < 0 && (ball.pos.x - target.x) * this.dir >= 0;
    if (crossed && Math.abs(ball.pos.z - target.z) <= target.r) {
      this.gate++;
      this.hits++;
      if (this.gate >= this.markers.length) {
        // Lap complete.
        if (this.best === 0 || this.timer < this.best) this.best = this.timer;
        this.scored++;
        this.gate = 0;
        this.pause = PAUSE_AFTER_GOAL;
        return;
      }
      this.buildMarkers();
    }
  }

  private stepPassing(): void {
    const world = this.world;
    const ball = world.ball;
    const target = this.markers[0];
    if (!target) return;

    if (this.kickedByMe()) {
      this.attempts++;
      this.shotTaken = true;
      this.sinceShot = 0;
    }
    if (!this.shotTaken) {
      // Give them the ball back if it is sitting a long way off.
      const me = this.me;
      if (me && dist2(me.pos, ball.pos) > 22) {
        ball.pos = v3(me.pos.x + this.dir * 1.2, BALL_RADIUS, me.pos.z);
        ball.vel = v3(0, 0, 0);
      }
      return;
    }

    this.sinceShot += TICK_DT;
    // Either the ball runs through the circle, or the man in it brings it down.
    const receiver = ball.owner >= 0 ? world.players.find((p) => p.id === ball.owner) : undefined;
    const collected =
      !!receiver && receiver.id !== this.humanId && dist2(receiver.pos, target) <= target.r + 1;
    if (dist2(ball.pos, target) <= target.r || collected) {
      this.hits++;
      this.index++;
      this.pause = PAUSE_AFTER_GOAL;
      return;
    }
    const stopped = Math.hypot(ball.vel.x, ball.vel.z) < 1 && ball.owner < 0;
    if ((stopped && this.sinceShot > 0.8) || this.sinceShot > 5) {
      this.index++;
      this.pause = PAUSE_AFTER_MISS;
    }
  }

  // --- reporting -------------------------------------------------------------

  report(): DrillReport {
    return {
      drill: this.drill,
      promptKey: `drill.${this.drill === 'tutorial' ? 'free' : this.drill}.prompt`,
      markers: this.markers,
      stats: this.stats(),
      time: Math.round(this.timer * 10) / 10,
    };
  }

  private stats(): DrillStat[] {
    switch (this.drill) {
      case 'shooting':
        return [
          { key: 'drill.stat.scored', value: `${this.scored}/${this.attempts}` },
          { key: 'drill.stat.best', value: `${this.bestStreak}` },
        ];
      case 'dribble':
        return [
          { key: 'drill.stat.gates', value: `${this.gate}/${this.markers.length}` },
          { key: 'drill.stat.time', value: this.timer.toFixed(1) },
          { key: 'drill.stat.best', value: this.best ? this.best.toFixed(1) : '—' },
        ];
      case 'passing':
        return [{ key: 'drill.stat.hits', value: `${this.hits}/${this.attempts}` }];
      default:
        return [{ key: 'drill.stat.scored', value: `${this.scored}` }];
    }
  }
}

/** Training pitches are private: one player, their own room name. */
export function isTrainingRoom(name: string): boolean {
  return name.startsWith('practica-');
}
