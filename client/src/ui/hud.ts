import { GOAL_HALF_WIDTH, HALF_LENGTH, HALF_WIDTH, TEAM_INFO } from '@shared/constants.js';
import { MatchPhase, POWERUP_INFO, PowerupType, type Role } from '@shared/types.js';
import { applyStatic, onLangChange, t, type Key } from '../i18n.js';
import type { RenderState } from '../net/state.js';
import { avatarElement, setAvatar } from './avatar.js';

const PHASE_KEY: Record<number, Key> = {
  [MatchPhase.Warmup]: 'phase.warmup',
  [MatchPhase.Kickoff]: 'phase.kickoff',
  [MatchPhase.Play]: 'phase.play',
  [MatchPhase.GoalCelebration]: 'phase.goal',
  [MatchPhase.FreeKick]: 'phase.freekick',
  [MatchPhase.FullTime]: 'phase.fulltime',
};

const ROLE_KEY: Key[] = [
  'role.keeper',
  'role.defender',
  'role.midfielder',
  'role.winger',
  'role.striker',
];

/** Localised name for a role, used on the HUD and in the lobby feed. */
export function roleName(role: Role): string {
  return t(ROLE_KEY[role] ?? 'role.midfielder');
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** Scoreboard, toasts, radar and chat. Plain DOM over the canvas. */
export class Hud {
  private homeScore = el('home-score');
  private awayScore = el('away-score');
  private homeBadge = el('home-badge');
  private awayBadge = el('away-badge');
  private clock = el('clock');
  private phaseLabel = el('phase-label');
  private toasts = el('toasts');
  private feed = el('feed');
  private chatlog = el('chatlog');
  private chatinput = el<HTMLInputElement>('chatinput');
  private staminaBar = el('stamina-bar');
  private chargeBar = el('charge-bar');
  private powerup = el('powerup');
  private powerupLabel = el('powerup-label');
  private powerupBar = el('powerup-bar');
  private youLabel = el('you-text');
  private youAvatar = el<HTMLImageElement>('you-avatar');
  private pingLabel = el('ping');
  private radar = el<HTMLCanvasElement>('radar');
  private radarCtx = this.radar.getContext('2d')!;
  private help = el('help');
  private lastGoalCount = 0;
  /** In training the clock counts the drill, not the match. */
  private trainingTime: number | null = null;
  private you = { name: '', team: 0, role: 0 as Role };

  constructor() {
    this.homeBadge.textContent = TEAM_INFO[0].short;
    this.awayBadge.textContent = TEAM_INFO[1].short;
    onLangChange(() => {
      this.setYou(this.you.name, this.you.team, this.you.role);
      applyStatic();
    });
  }

  show(): void {
    el('hud').classList.remove('hidden');
  }

  /** Feed the drill clock in, or null to go back to the match clock. */
  setTrainingTime(seconds: number | null): void {
    this.trainingTime = seconds;
  }

  setChatHint(key: string): void {
    this.chatinput.placeholder = t('hud.chat.ph', { key });
  }

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
  }

  setPing(ms: number): void {
    this.pingLabel.textContent = String(Math.round(ms));
  }

  setYou(name: string, team: number, role: Role): void {
    this.you = { name, team, role };
    if (!name) return;
    this.youLabel.textContent = `${name} · ${TEAM_INFO[team]?.short ?? '??'} · ${roleName(role)}`;
    this.youLabel.style.color = `#${(TEAM_INFO[team]?.primary ?? 0xffffff).toString(16).padStart(6, '0')}`;
    setAvatar(this.youAvatar, name, 64);
  }

  update(state: RenderState, myId: number): void {
    this.homeScore.textContent = String(state.score[0]);
    this.awayScore.textContent = String(state.score[1]);

    if (this.trainingTime !== null) {
      const secs = Math.max(0, Math.floor(this.trainingTime));
      this.clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      this.clock.style.color = '';
      this.phaseLabel.textContent = t('phase.training');
    } else {
      const secs = Math.max(0, Math.ceil(state.clock));
      this.clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      this.clock.style.color = secs <= 30 && state.phase === MatchPhase.Play ? '#ff6a4a' : '';
      this.phaseLabel.textContent = t(PHASE_KEY[state.phase] ?? 'phase.play');
    }

    const me = state.players.find((p) => p.id === myId);
    if (me) {
      this.staminaBar.style.right = `${(1 - me.stamina) * 100}%`;
      this.chargeBar.style.right = `${(1 - me.charge) * 100}%`;
      if (me.powerup !== PowerupType.None) {
        const info = POWERUP_INFO[me.powerup];
        this.powerup.classList.remove('hidden');
        this.powerupLabel.textContent = info?.label ?? '';
        this.powerupBar.style.background = `#${(info?.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
      } else {
        this.powerup.classList.add('hidden');
      }
    }

    this.drawRadar(state, myId);
  }

  /** Big centre-screen shout. */
  toast(text: string, sub = '', ttl = 2600): void {
    const wrap = document.createElement('div');
    const main = document.createElement('div');
    main.className = 'toast';
    main.textContent = text;
    wrap.appendChild(main);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'toast sub';
      s.textContent = sub;
      wrap.appendChild(s);
    }
    this.toasts.appendChild(wrap);
    setTimeout(() => main.classList.add('fade'), ttl - 600);
    setTimeout(() => wrap.remove(), ttl);
  }

  /** Small right-hand ticker: fouls, saves, substitutions. */
  note(text: string): void {
    const line = document.createElement('div');
    line.className = 'feed-line';
    line.textContent = text;
    this.feed.appendChild(line);
    setTimeout(() => line.remove(), 5200);
    while (this.feed.children.length > 6) this.feed.firstChild?.remove();
  }

  chat(from: string, text: string, team: number): void {
    const line = document.createElement('div');
    line.className = `t${team}`;
    line.appendChild(avatarElement(from, 'avatar tiny'));
    const b = document.createElement('b');
    b.textContent = `${from}: `;
    line.appendChild(b);
    line.appendChild(document.createTextNode(text));
    this.chatlog.appendChild(line);
    while (this.chatlog.children.length > 7) this.chatlog.firstChild?.remove();
    setTimeout(() => line.remove(), 18000);
  }

  openChat(): void {
    this.chatinput.classList.add('on');
    this.chatinput.focus();
  }

  closeChat(): string {
    const text = this.chatinput.value.trim();
    this.chatinput.value = '';
    this.chatinput.classList.remove('on');
    this.chatinput.blur();
    return text;
  }

  get chatOpen(): boolean {
    return this.chatinput.classList.contains('on');
  }

  /** Fire a celebration once per goal, driven by the server's counter. */
  handleGoalCounter(count: number, team: number, scorer: string): void {
    if (count === this.lastGoalCount) return;
    this.lastGoalCount = count;
    if (count === 0) return;
    this.toast(t('event.goal'), scorer ? `${scorer} — ${TEAM_INFO[team]?.name ?? ''}` : TEAM_INFO[team]?.name ?? '');
  }

  private drawRadar(state: RenderState, myId: number): void {
    const ctx = this.radarCtx;
    const w = this.radar.width;
    const h = this.radar.height;
    ctx.clearRect(0, 0, w, h);

    const pad = 6;
    const sx = (w - pad * 2) / (HALF_LENGTH * 2);
    const sz = (h - pad * 2) / (HALF_WIDTH * 2);
    const px = (x: number) => pad + (x + HALF_LENGTH) * sx;
    const pz = (z: number) => pad + (z + HALF_WIDTH) * sz;

    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
    ctx.beginPath();
    ctx.moveTo(w / 2, pad);
    ctx.lineTo(w / 2, h - pad);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 8 * sx, 0, Math.PI * 2);
    ctx.stroke();

    // Goals.
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(pad - 3, pz(-GOAL_HALF_WIDTH), 3, (GOAL_HALF_WIDTH * 2) * sz);
    ctx.fillRect(w - pad, pz(-GOAL_HALF_WIDTH), 3, (GOAL_HALF_WIDTH * 2) * sz);

    for (const pu of state.pickups) {
      if (pu.respawn > 0) continue;
      const info = POWERUP_INFO[pu.type];
      ctx.fillStyle = `#${(info?.color ?? 0xffffff).toString(16).padStart(6, '0')}`;
      ctx.fillRect(px(pu.x) - 2, pz(pu.z) - 2, 4, 4);
    }

    for (const p of state.players) {
      const me = p.id === myId;
      ctx.beginPath();
      ctx.arc(px(p.x), pz(p.z), me ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = me
        ? '#ffd34d'
        : `#${(TEAM_INFO[p.team]?.primary ?? 0xffffff).toString(16).padStart(6, '0')}`;
      ctx.fill();
      if (!p.bot && !me) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.beginPath();
    ctx.arc(px(state.ball.x), pz(state.ball.z), 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
}
