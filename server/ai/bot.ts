import {
  CONTROL_RADIUS,
  GOAL_HALF_WIDTH,
  HALF_LENGTH,
  HALF_WIDTH,
  RUN_SPEED,
  SPRINT_SPEED,
} from '@shared/constants.js';
import { Rng, clamp, dist2, headingOf, len2, normalize2 } from '@shared/math.js';
import {
  BTN,
  MatchPhase,
  PlayerAct,
  Role,
  emptyInput,
  type PlayerInput,
  type PlayerState,
  type World,
} from '@shared/types.js';
import { attackDir, homePosition, ownGoalX, targetGoalX } from '@shared/sim/index.js';
import { laneRisk, pickPassTarget } from '@shared/sim/actions.js';
import { interceptPoint } from '@shared/sim/predict.js';
import { speedMul } from '@shared/sim/stats.js';
import { keeperThink, newKeeperMemory, type KeeperMemory } from './keeper.js';

type BotState = 'chase' | 'press' | 'support' | 'mark' | 'onball';

/**
 * One brain per bot. Bots are deliberately not frame-perfect: they re-decide on
 * a reaction timer, aim with noise, and hold buttons the way a human would.
 */
export class BotBrain {
  readonly playerId: number;
  private rng: Rng;
  private decisionTimer = 0;
  private state: BotState = 'support';
  private targetX = 0;
  private targetZ = 0;
  private aim = 0;
  private sprint = false;
  /** Remaining hold time for a queued kick, and which button it is. */
  private holdBtn = 0;
  private holdTime = 0;
  private holdWait = 0;
  private holdAim = 0;
  private tackleCharge = 0;
  private nextTackle = 0;
  private keeperMem: KeeperMemory = newKeeperMemory();
  private seq = 0;

  constructor(playerId: number, seed: number) {
    this.playerId = playerId;
    this.rng = new Rng(seed);
  }

  think(world: World, p: PlayerState, dt: number): PlayerInput {
    const skill = clamp(world.config.botDifficulty, 0, 1);

    if (p.role === Role.Keeper) {
      return keeperThink(world, p, this.rng, skill, this.seq++, this.keeperMem);
    }

    // While a kick is charging the bot commits to it; re-deciding here would
    // restart the charge every reaction tick and it would never let go.
    if (!this.holdBtn) {
      this.decisionTimer -= dt;
      if (this.decisionTimer <= 0) {
        // Sharper players read the game sooner. Set this before deciding so a
        // queued kick can extend it.
        this.decisionTimer = 0.28 - skill * 0.16 + this.rng.range(0, 0.06);
        this.decide(world, p, skill);
      }
    }

    const input = emptyInput(this.seq++);

    if (this.holdBtn) {
      // Charging a kick: plant, turn onto the aim line, release when lined up.
      this.holdTime -= dt;
      this.holdWait -= dt;
      const facingOk =
        Math.abs(((this.holdAim - p.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.3;
      const charged = this.holdTime <= 0;
      if ((!charged || !facingOk) && this.holdWait > 0) {
        input.buttons |= this.holdBtn;
      } else {
        this.holdBtn = 0; // released this tick - the sim fires the kick
      }
      input.aim = this.holdAim;
      input.moveX = Math.sin(this.holdAim) * 0.3;
      input.moveZ = Math.cos(this.holdAim) * 0.3;
      if (this.tackleCharge > 0) this.tackleCharge = 0;
      return input;
    }

    let mx = this.targetX - p.pos.x;
    let mz = this.targetZ - p.pos.z;
    const d = len2(mx, mz);
    if (d > 0.35) {
      mx /= d;
      mz /= d;
      // Ease off near the target so bots do not vibrate on the spot.
      const throttle = clamp(d / 2.2, 0.35, 1);
      input.moveX = mx * throttle;
      input.moveZ = mz * throttle;
    }
    input.aim = d > 0.35 ? headingOf(mx, mz) : this.aim;

    if (this.sprint && p.stamina > 0.12) input.buttons |= BTN.SPRINT;

    if (this.tackleCharge > 0) {
      this.tackleCharge -= dt;
      input.buttons |= BTN.TACKLE;
    }

    return input;
  }

  private decide(world: World, p: PlayerState, skill: number): void {
    const ball = world.ball;
    const dir = attackDir(p.team);
    const owner = ball.owner >= 0 ? world.players.find((x) => x.id === ball.owner) : undefined;

    if (world.match.phase !== MatchPhase.Play && world.match.phase !== MatchPhase.Kickoff) {
      const home = homePosition(world, p);
      this.setTarget(home.x, home.z, false);
      this.state = 'support';
      return;
    }

    if (owner?.id === p.id) {
      this.state = 'onball';
      this.onBall(world, p, skill);
      return;
    }

    const chaser = this.designatedChaser(world, p.team);
    if (!owner) {
      if (chaser === p.id) {
        this.state = 'chase';
        const spd = RUN_SPEED * speedMul(p);
        const pt = interceptPoint(ball, p, SPRINT_SPEED * speedMul(p));
        this.setTarget(pt.x, pt.z, dist2(p.pos, ball.pos) > 4 || pt.t > 0.5);
        this.aim = headingOf(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
        void spd;
        return;
      }
      this.offBallShape(world, p, true);
      return;
    }

    if (owner.team === p.team) {
      this.state = 'support';
      this.offBallShape(world, p, false);
      return;
    }

    // Defending.
    const presser = this.designatedChaser(world, p.team);
    if (presser === p.id) {
      this.state = 'press';
      this.press(world, p, owner, skill);
      return;
    }
    this.state = 'mark';
    this.mark(world, p, owner);
    void dir;
  }

  /** Which of our players should go to the ball: lowest time-to-ball. */
  private designatedChaser(world: World, team: number): number {
    let bestId = -1;
    let bestT = Infinity;
    for (const p of world.players) {
      if (p.team !== team || p.role === Role.Keeper) continue;
      if (p.act === PlayerAct.Stunned) continue;
      const d = dist2(p.pos, world.ball.pos);
      const t = d / Math.max(2, SPRINT_SPEED * speedMul(p));
      // Humans get a slight preference so bots do not barge them off the ball.
      const bias = p.bot ? 1 : 0.85;
      if (t * bias < bestT) {
        bestT = t * bias;
        bestId = p.id;
      }
    }
    return bestId;
  }

  // --- On the ball ----------------------------------------------------------

  private onBall(world: World, p: PlayerState, skill: number): void {
    const dir = attackDir(p.team);
    const goalX = targetGoalX(p.team);
    const dGoalX = Math.abs(goalX - p.pos.x);
    const dGoal = Math.hypot(goalX - p.pos.x, clamp(p.pos.z, -GOAL_HALF_WIDTH, GOAL_HALF_WIDTH) - p.pos.z);
    const pressure = this.nearestOpponentDist(world, p);

    // Shoot? Bots work the ball into a sensible position rather than hitting
    // hopeful ones from the halfway line: close enough, central enough, and
    // with nobody stood in the way.
    const shootRange = 16 + skill * 10;
    const aimZ = this.shotCorner(world, p, skill);
    const shotHeading = headingOf(goalX - p.pos.x, aimZ - p.pos.z);
    const goodAngle = Math.abs(p.pos.z) < 17 || dGoal < 12;
    const smothered = this.blockerInCone(world, p, shotHeading, 3.2, 0.5);
    if (dGoal < shootRange && goodAngle && !smothered && laneRisk(world, p, goalX, aimZ) < 0.55) {
      const charge = clamp(dGoal / 26, 0.45, 1);
      this.queueKick(BTN.SHOOT, charge, shotHeading);
      this.setTarget(p.pos.x + dir * 1.2, p.pos.z, false);
      return;
    }
    void dGoalX;

    // Pass?
    // In the final third bots back themselves and drive at the goal instead of
    // passing round the outside.
    const squeeze = dGoal < 28 ? 2.4 : 3.4;
    const target = pickPassTarget(world, p, 0.45);
    const wantPass = pressure < squeeze || (target && target.score > 2.6 && this.rng.next() < 0.35 + skill * 0.4);
    if (target && wantPass) {
      const d = dist2(p.pos, target.player.pos);
      const aim = headingOf(target.aimX - p.pos.x, target.aimZ - p.pos.z);
      const risk = laneRisk(world, p, target.aimX, target.aimZ);
      if (risk > 0.45 && d > 12) {
        this.queueKick(BTN.LOB, clamp(d / 40, 0.35, 1), aim);
      } else {
        this.queueKick(BTN.PASS, clamp(d / 45, 0.2, 0.95), aim);
      }
      return;
    }

    // Otherwise carry it, steering around the nearest opponent.
    const laneZ = clamp(p.pos.z * 0.5, -GOAL_HALF_WIDTH, GOAL_HALF_WIDTH);
    let tx = p.pos.x + dir * 12;
    let tz = laneZ + (p.pos.z - laneZ) * 0.5;
    const foe = this.nearestOpponent(world, p);
    if (foe && dist2(p.pos, foe.pos) < 6) {
      // Go round the defender - but toward the side with room, never into the
      // boards, or the carrier ends up pinned in the corner going nowhere.
      let side = p.pos.z >= foe.pos.z ? 1 : -1;
      if (p.pos.z + side * 6 > HALF_WIDTH - 5 || p.pos.z + side * 6 < -HALF_WIDTH + 5) side = -side;
      tz = clamp(p.pos.z + side * 6, -HALF_WIDTH + 5, HALF_WIDTH - 5);
      tx = p.pos.x + dir * 5;
    }
    // Never try to dribble through the goal line: cut back inside instead.
    if (Math.abs(tx) > HALF_LENGTH - 4) {
      tx = Math.sign(tx) * (HALF_LENGTH - 4);
      tz = clamp(tz * 0.4, -12, 12);
    }
    this.setTarget(clamp(tx, -HALF_LENGTH + 2, HALF_LENGTH - 2), clamp(tz, -HALF_WIDTH + 2, HALF_WIDTH - 2), pressure > 4);
  }

  /** Is somebody stood in the way, close enough to charge the shot down? */
  private blockerInCone(
    world: World,
    p: PlayerState,
    heading: number,
    range: number,
    halfAngle: number,
  ): boolean {
    const hx = Math.sin(heading);
    const hz = Math.cos(heading);
    for (const o of world.players) {
      if (o.team === p.team) continue;
      const dx = o.pos.x - p.pos.x;
      const dz = o.pos.z - p.pos.z;
      const d = len2(dx, dz);
      if (d > range || d < 1e-4) continue;
      const along = (dx / d) * hx + (dz / d) * hz;
      if (along > Math.cos(halfAngle)) return true;
    }
    return false;
  }

  /** Aim away from the keeper, with less precision from weaker bots. */
  private shotCorner(world: World, p: PlayerState, skill: number): number {
    const limit = GOAL_HALF_WIDTH - 1.2;
    const keeper = world.players.find((k) => k.team !== p.team && k.role === Role.Keeper);
    const side = keeper ? (keeper.pos.z >= 0 ? -1 : 1) : this.rng.next() < 0.5 ? -1 : 1;
    const sloppiness = (1 - skill) * limit * 0.9;
    return clamp(side * limit + this.rng.range(-sloppiness, sloppiness), -limit, limit);
  }

  private queueKick(btn: number, charge: number, aim: number): void {
    this.holdBtn = btn;
    // Charge time roughly tracks the sim's charge windows.
    const full = btn === BTN.SHOOT ? 0.85 : btn === BTN.LOB ? 0.65 : 0.7;
    this.holdTime = clamp(charge, 0.1, 1) * full;
    this.holdWait = this.holdTime + 0.45; // give up turning after this
    this.holdAim = aim;
    this.aim = aim;
    this.sprint = false;
    this.decisionTimer = Math.max(this.decisionTimer, this.holdTime + 0.12);
  }

  // --- Off the ball ---------------------------------------------------------

  private offBallShape(world: World, p: PlayerState, loose: boolean): void {
    const home = homePosition(world, p);
    const dir = attackDir(p.team);
    let tx = home.x;
    let tz = home.z;

    if (!loose && p.role !== Role.Defender) {
      // Offer an angle: get ahead of the ball and away from the carrier.
      const ahead = p.role === Role.Striker ? 10 : 5;
      tx = clamp(world.ball.pos.x + dir * ahead, -HALF_LENGTH + 6, HALF_LENGTH - 6);
      const side = p.pos.z >= world.ball.pos.z ? 1 : -1;
      tz = clamp(world.ball.pos.z + side * (8 + (p.slot % 2) * 4), -HALF_WIDTH + 4, HALF_WIDTH - 4);
      // Do not run offside-ish deep into the keeper's lap.
      if (Math.abs(tx) > HALF_LENGTH - 10) tx = (HALF_LENGTH - 10) * Math.sign(tx);
    }

    // Spread out: push away from the nearest team-mate.
    const mate = this.nearestTeammate(world, p);
    if (mate && dist2(p.pos, mate.pos) < 5.5) {
      const dx = p.pos.x - mate.pos.x;
      const dz = p.pos.z - mate.pos.z;
      const n = normalize2(dx, dz);
      tx += n.x * 4;
      tz += n.z * 4;
    }

    this.setTarget(
      clamp(tx, -HALF_LENGTH + 3, HALF_LENGTH - 3),
      clamp(tz, -HALF_WIDTH + 3, HALF_WIDTH - 3),
      dist2(p.pos, { x: tx, z: tz }) > 9,
    );
    this.aim = headingOf(world.ball.pos.x - p.pos.x, world.ball.pos.z - p.pos.z);
  }

  private press(world: World, p: PlayerState, carrier: PlayerState, skill: number): void {
    const goalX = ownGoalX(p.team);
    // Stand between the carrier and our goal, a touch goal-side.
    const gx = goalX - carrier.pos.x;
    const gz = 0 - carrier.pos.z;
    const g = len2(gx, gz) || 1;
    const standoff = 2.1;
    const tx = carrier.pos.x + (gx / g) * standoff;
    const tz = carrier.pos.z + (gz / g) * standoff;
    this.setTarget(tx, tz, true);
    this.aim = headingOf(carrier.pos.x - p.pos.x, carrier.pos.z - p.pos.z);

    const d = dist2(p.pos, carrier.pos);
    const ballD = dist2(p.pos, world.ball.pos);
    // Bots pick their moments rather than flailing at every frame.
    if (this.tackleCharge <= 0 && p.tackleCooldown <= 0 && world.time > this.nextTackle) {
      let attempt = 0;
      if (ballD < CONTROL_RADIUS * 1.15 && this.rng.next() < 0.35 + skill * 0.35) {
        attempt = 0.08; // poke at the ball
      } else if (d < 2.2 && this.rng.next() < 0.08 + skill * 0.16) {
        attempt = 0.08; // shoulder challenge
      } else if (
        d > 2.0 &&
        d < 3.6 &&
        len2(p.vel.x, p.vel.z) > RUN_SPEED * 0.85 &&
        this.rng.next() < 0.02 + skill * 0.05
      ) {
        attempt = 0.1; // committed slide while sprinting
      }
      if (attempt > 0) {
        this.tackleCharge = attempt;
        this.nextTackle = world.time + this.rng.range(0.7, 1.5);
      }
    }
  }

  private mark(world: World, p: PlayerState, carrier: PlayerState): void {
    // Pick up the most dangerous unmarked opponent near my zone.
    let mark: PlayerState | null = null;
    let bestScore = -Infinity;
    const dir = attackDir(p.team);
    for (const o of world.players) {
      if (o.team === p.team || o.role === Role.Keeper || o.id === carrier.id) continue;
      const threat = -dir * o.pos.x; // deeper in our half = more dangerous
      const score = threat * 0.6 - dist2(p.pos, o.pos) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        mark = o;
      }
    }
    const home = homePosition(world, p);
    if (!mark) {
      this.setTarget(home.x, home.z, false);
      return;
    }
    // Sit in the passing lane: goal-side of the man, on the line from the ball.
    const bx = world.ball.pos.x;
    const bz = world.ball.pos.z;
    const lx = mark.pos.x - bx;
    const lz = mark.pos.z - bz;
    const l = len2(lx, lz) || 1;
    const tx = clamp(mark.pos.x - (lx / l) * 2.2, -HALF_LENGTH + 3, HALF_LENGTH - 3);
    const tz = clamp(mark.pos.z - (lz / l) * 2.2, -HALF_WIDTH + 3, HALF_WIDTH - 3);
    // Blend with the shape so the whole team does not chase men around.
    this.setTarget(tx * 0.65 + home.x * 0.35, tz * 0.65 + home.z * 0.35, dist2(p.pos, mark.pos) > 8);
    this.aim = headingOf(bx - p.pos.x, bz - p.pos.z);
  }

  // --- helpers --------------------------------------------------------------

  private setTarget(x: number, z: number, sprint: boolean): void {
    this.targetX = x;
    this.targetZ = z;
    this.sprint = sprint;
  }

  private nearestOpponent(world: World, p: PlayerState): PlayerState | null {
    let best: PlayerState | null = null;
    let bestD = Infinity;
    for (const o of world.players) {
      if (o.team === p.team) continue;
      const d = dist2(p.pos, o.pos);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private nearestOpponentDist(world: World, p: PlayerState): number {
    const o = this.nearestOpponent(world, p);
    return o ? dist2(p.pos, o.pos) : 99;
  }

  private nearestTeammate(world: World, p: PlayerState): PlayerState | null {
    let best: PlayerState | null = null;
    let bestD = Infinity;
    for (const o of world.players) {
      if (o.team !== p.team || o.id === p.id) continue;
      const d = dist2(p.pos, o.pos);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }
}
