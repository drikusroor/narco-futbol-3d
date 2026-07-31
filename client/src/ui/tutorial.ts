import { RUN_SPEED } from '@shared/constants.js';
import type { GameEvent } from '@shared/types.js';
import { onLangChange, t, type Key } from '../i18n.js';
import { keyLabel, type Action } from '../input/bindings.js';
import type { Controls } from '../input/controls.js';
import type { RenderPlayer, RenderState } from '../net/state.js';
import { bindingText } from './settings.js';

/** What a step is given each frame. */
export interface TutorialCtx {
  view: RenderState;
  me: RenderPlayer | undefined;
  myId: number;
  /** Events since the last frame, each seen exactly once. */
  events: GameEvent[];
  dt: number;
}

/** What the caller supplies; the coach fills in the events itself. */
export type TutorialInput = Omit<TutorialCtx, 'events'>;

interface Step {
  task: Key;
  tip: Key;
  /** Action whose bound keys are spliced into the text. */
  keys?: Action;
  /** Progress this step; return true when it is done. */
  check(ctx: TutorialCtx, memo: Memo): boolean;
}

/** Scratch space so a step can accumulate distance or time across frames. */
interface Memo {
  distance: number;
  lastX: number;
  lastZ: number;
  startId: number;
  started: boolean;
}

function moved(ctx: TutorialCtx, memo: Memo): number {
  if (!ctx.me) return 0;
  if (!memo.started) {
    memo.started = true;
    memo.lastX = ctx.me.x;
    memo.lastZ = ctx.me.z;
    memo.startId = ctx.myId;
    return 0;
  }
  const d = Math.hypot(ctx.me.x - memo.lastX, ctx.me.z - memo.lastZ);
  memo.lastX = ctx.me.x;
  memo.lastZ = ctx.me.z;
  // A jump that big is the drill resetting the scene, not you running.
  return d > 3 ? 0 : d;
}

function kicked(ctx: TutorialCtx, kind: 'pass' | 'shot' | 'lob'): boolean {
  return ctx.events.some((e) => e.t === 'kick' && e.kind === kind && e.player === ctx.myId);
}

const STEPS: Step[] = [
  {
    task: 'tutorial.move',
    tip: 'tutorial.move.tip',
    keys: 'up',
    check(ctx, memo) {
      memo.distance += moved(ctx, memo);
      return memo.distance > 8;
    },
  },
  {
    task: 'tutorial.sprint',
    tip: 'tutorial.sprint.tip',
    keys: 'sprint',
    // Measured in metres covered rather than seconds held: distance comes from
    // the simulation, so a slow frame rate cannot make this harder.
    check(ctx, memo) {
      const step = moved(ctx, memo);
      if ((ctx.me?.speed ?? 0) > RUN_SPEED * 1.06) memo.distance += step;
      return memo.distance > 9;
    },
  },
  {
    task: 'tutorial.getball',
    tip: 'tutorial.getball.tip',
    check(ctx) {
      return ctx.view.ball.owner === ctx.myId;
    },
  },
  {
    task: 'tutorial.dribble',
    tip: 'tutorial.dribble.tip',
    check(ctx, memo) {
      const step = moved(ctx, memo);
      if (ctx.view.ball.owner === ctx.myId) memo.distance += step;
      return memo.distance > 12;
    },
  },
  {
    task: 'tutorial.pass',
    tip: 'tutorial.pass.tip',
    keys: 'pass',
    check: (ctx) => kicked(ctx, 'pass'),
  },
  {
    task: 'tutorial.lob',
    tip: 'tutorial.lob.tip',
    keys: 'lob',
    check: (ctx) => kicked(ctx, 'lob'),
  },
  {
    task: 'tutorial.shoot',
    tip: 'tutorial.shoot.tip',
    keys: 'shoot',
    check: (ctx) => kicked(ctx, 'shot'),
  },
  {
    task: 'tutorial.score',
    tip: 'tutorial.score.tip',
    check(ctx) {
      const team = ctx.me?.team ?? 0;
      return ctx.events.some((e) => e.t === 'goal' && e.team === team);
    },
  },
  {
    task: 'tutorial.tackle',
    tip: 'tutorial.tackle.tip',
    keys: 'tackle',
    check(ctx) {
      return ctx.events.some((e) => e.t === 'tackle' && e.player === ctx.myId && e.won);
    },
  },
  {
    task: 'tutorial.switch',
    tip: 'tutorial.switch.tip',
    keys: 'switch',
    check(ctx, memo) {
      if (!memo.started) {
        memo.started = true;
        memo.startId = ctx.myId;
      }
      return ctx.myId !== memo.startId;
    },
  },
];

const DONE_KEY = 'nf.tutorialDone';

/**
 * A guided lap through every control, run entirely on the client: it watches
 * the same events and world state the HUD does and ticks each task off when it
 * actually happens on the pitch.
 */
export class Tutorial {
  private root = document.getElementById('tutorial')!;
  private stepLabel = document.getElementById('tutorial-step')!;
  private taskLabel = document.getElementById('tutorial-task')!;
  private tipLabel = document.getElementById('tutorial-tip')!;
  private controls: Controls;
  private index = -1;
  private memo: Memo = freshMemo();
  private celebrate = 0;
  private onFinish: () => void;
  private onStage: (stage: number) => void;
  /** Events land here as snapshots arrive and are drained by the next frame. */
  private queued: GameEvent[] = [];

  constructor(
    controls: Controls,
    onFinish: () => void = () => {},
    onStage: (stage: number) => void = () => {},
  ) {
    this.controls = controls;
    this.onFinish = onFinish;
    this.onStage = onStage;
    document.getElementById('tutorial-skip')!.addEventListener('click', () => this.next());
    onLangChange(() => this.render());
  }

  get running(): boolean {
    return this.index >= 0;
  }

  start(): void {
    this.index = 0;
    this.memo = freshMemo();
    this.celebrate = 0;
    this.root.classList.remove('hidden', 'done');
    this.render();
    this.onStage(0);
  }

  stop(): void {
    this.index = -1;
    this.root.classList.add('hidden');
  }

  /** Hand over a snapshot's events; they are judged on the next frame. */
  pushEvents(events: GameEvent[]): void {
    if (!this.running) return;
    for (const e of events) this.queued.push(e);
    if (this.queued.length > 64) this.queued.splice(0, this.queued.length - 64);
  }

  /** Called once per rendered frame while the tutorial is up. */
  observe(input: TutorialInput): void {
    if (!this.running) return;
    const events = this.queued;
    this.queued = [];
    if (this.celebrate > 0) {
      this.celebrate -= input.dt;
      if (this.celebrate <= 0) {
        this.stop();
        this.onFinish();
      }
      return;
    }
    const step = STEPS[this.index];
    if (!step) return;
    if (step.check({ ...input, events }, this.memo)) this.next();
  }

  private next(): void {
    this.index++;
    this.memo = freshMemo();
    if (this.index >= STEPS.length) {
      try {
        localStorage.setItem(DONE_KEY, '1');
      } catch {
        // not persisting is survivable
      }
      this.root.classList.add('done');
      this.stepLabel.textContent = '';
      this.taskLabel.textContent = t('tutorial.done.title');
      this.tipLabel.textContent = t('tutorial.done.sub');
      this.celebrate = 4;
      return;
    }
    this.render();
    // The server brings players on as the lesson needs them.
    this.onStage(this.index);
  }

  private render(): void {
    const step = STEPS[this.index];
    if (!step) return;
    // The movement step wants all four directions, not just "up".
    const keys = !step.keys
      ? ''
      : step.keys === 'up'
        ? (['up', 'left', 'down', 'right'] as Action[])
            .map((a) => keyLabel(this.controls.bindings[a][0]))
            .join('')
        : bindingText(this.controls, step.keys);
    this.stepLabel.textContent = t('tutorial.step', { n: this.index + 1, total: STEPS.length });
    this.taskLabel.textContent = t(step.task, { keys });
    this.tipLabel.textContent = t(step.tip);
  }
}

function freshMemo(): Memo {
  return { distance: 0, lastX: 0, lastZ: 0, startId: -1, started: false };
}

export function tutorialDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
}
