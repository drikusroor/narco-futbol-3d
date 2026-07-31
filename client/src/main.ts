import * as THREE from 'three';
import { BALL_RADIUS, TEAM_INFO, TICK_DT } from '@shared/constants.js';
import { clamp } from '@shared/math.js';
import {
  MatchPhase,
  PlayerAct,
  POWERUP_INFO,
  Role,
  type DrillId,
  type DrillReport,
  type ServerMessage,
} from '@shared/types.js';
import type { Snapshot } from '@shared/protocol.js';

import { Sfx } from './audio/sfx.js';
import { initDiscord } from './discord.js';
import { applyStatic, onLangChange, t, type Key } from './i18n.js';
import { keyLabel } from './input/bindings.js';
import { Controls } from './input/controls.js';
import { GameSocket } from './net/socket.js';
import { MatchState, type RenderPlayer } from './net/state.js';
import { makeBall, makePlayerRig, makePowerup, makeReferee, poseRig, tintPowerup, type PlayerRig } from './render/actors.js';
import { BallTrail, Effects } from './render/effects.js';
import { DrillMarkers } from './render/markers.js';
import { BroadcastCamera, createStage } from './render/scene.js';
import { buildStadium, decayCrowdHype, setCrowdHype } from './render/stadium.js';
import { Hud } from './ui/hud.js';
import { Settings } from './ui/settings.js';
import { DrillPanel, DrillPicker } from './ui/training.js';
import { Tutorial } from './ui/tutorial.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const stage = createStage(canvas);
const stadium = buildStadium(stage.scene);
const effects = new Effects(stage.scene);
const trail = new BallTrail(stage.scene);
const camera = new BroadcastCamera(stage.camera);
const hud = new Hud();
const sfx = new Sfx();
const state = new MatchState();

const ball = makeBall();
stage.scene.add(ball.group);
const referee = makeReferee();
stage.scene.add(referee.group);
const markers = new DrillMarkers(stage.scene);

const rigs = new Map<number, PlayerRig>();
const pickupMeshes = new Map<number, THREE.Group>();
const nameTags = new Map<number, THREE.Sprite>();

let socket: GameSocket | null = null;
let running = false;
let accumulator = 0;
let lastFrame = performance.now();
let myName = 'Anon';
let lobbyNames = new Map<number, string>();
/** Set when this session is a solo practice rather than a match. */
let pendingDrill: DrillId | null = null;
let drillReport: DrillReport | null = null;
/** True while we are the ones hanging up, so the close is not an error. */
let leaving = false;

// --- input ------------------------------------------------------------------

const controls = new Controls(
  canvas,
  (action) => onAction(action),
  (key) => onRawKey(key),
);
const settings = new Settings(
  controls,
  sfx,
  () => refreshChatHint(),
  () => leaveMatch(),
);
const drillPanel = new DrillPanel();
const tutorial = new Tutorial(
  controls,
  () => hud.toast(t('tutorial.done.title'), '', 2600),
  (stage) => socket?.send({ t: 'training', drill: 'tutorial', stage }),
);

/** Chat is the one place a raw key still matters, because you are typing. */
function onRawKey(key: string): void {
  if (!hud.chatOpen) return;
  if (key === 'enter') {
    const text = hud.closeChat();
    controls.typing = false;
    if (text) socket?.send({ t: 'chat', text });
  } else if (key === 'escape') {
    hud.closeChat();
    controls.typing = false;
  }
}

function onAction(action: string): void {
  if (hud.chatOpen) return;
  switch (action) {
    case 'chat':
      if (running && !settings.open) {
        hud.openChat();
        controls.typing = true;
      }
      break;
    case 'help':
      hud.toggleHelp();
      break;
    case 'settings':
      settings.toggle();
      break;
    case 'mute':
      hud.note(sfx.toggleMute() ? t('event.muted') : t('event.unmuted'));
      break;
    default:
      break;
  }
}

function refreshChatHint(): void {
  hud.setChatHint(keyLabel(controls.bindings.chat[0] || 't'));
}

// --- menu -------------------------------------------------------------------

const menu = document.getElementById('menu')!;
const menuMain = document.getElementById('menu-main')!;
const menuTraining = document.getElementById('menu-training')!;
const loading = document.getElementById('loading')!;
const nameInput = document.getElementById('name-input') as HTMLInputElement;
const roomInput = document.getElementById('room-input') as HTMLInputElement;
const teamSelect = document.getElementById('team-select') as HTMLSelectElement;
const lengthSelect = document.getElementById('length-select') as HTMLSelectElement;
const sizeSelect = document.getElementById('size-select') as HTMLSelectElement;
const difficultySelect = document.getElementById('difficulty-select') as HTMLSelectElement;

nameInput.value = localStorage.getItem('nf.name') ?? '';
roomInput.value = new URLSearchParams(location.search).get('room') ?? '';

let discordRoom: string | null = null;
void initDiscord().then((ctx) => {
  if (ctx.room) {
    discordRoom = ctx.room;
    roomInput.value = ctx.room;
    roomInput.disabled = true;
    document.getElementById('menu-note')!.dataset.i18n = 'menu.discord';
    applyStatic();
  }
});

applyStatic();
refreshChatHint();
onLangChange(() => refreshChatHint());

document.getElementById('play-button')!.addEventListener('click', () => join());
document.getElementById('settings-button')!.addEventListener('click', () => settings.show());
document.getElementById('tutorial-button')!.addEventListener('click', () =>
  join({ drill: 'tutorial' }),
);
document.getElementById('training-button')!.addEventListener('click', () => {
  menuMain.classList.add('hidden');
  menuTraining.classList.remove('hidden');
});
document.getElementById('training-back')!.addEventListener('click', () => {
  menuTraining.classList.add('hidden');
  menuMain.classList.remove('hidden');
});
new DrillPicker((drill) => join({ drill }));

/** A room nobody else will wander into, for solo practice. */
function privateRoom(): string {
  return `practica-${Math.random().toString(36).slice(2, 10)}`;
}

function join(opts: { drill?: DrillId } = {}): void {
  myName = (nameInput.value.trim() || 'Anon').slice(0, 18);
  localStorage.setItem('nf.name', myName);
  pendingDrill = opts.drill ?? null;
  const room = pendingDrill ? privateRoom() : discordRoom ?? roomInput.value.trim();
  const teamValue = teamSelect.value;

  sfx.start();
  menu.classList.add('hidden');
  loading.classList.remove('hidden');
  loading.querySelector('span')!.textContent = t('loading.connecting');
  // Every room numbers its ticks from zero, so nothing from the last one keeps.
  state.reset();
  lastGoalCount = -1;
  lobbyNames.clear();

  socket = new GameSocket({
    onOpen: () => {
      loading.classList.add('hidden');
      hud.show();
      settings.setInGame(true);
      running = true;
    },
    onClose: (reason) => {
      running = false;
      leaveTraining();
      settings.setInGame(false);
      const deliberate = leaving;
      leaving = false;
      if (!deliberate) {
        loading.classList.remove('hidden');
        loading.querySelector('span')!.textContent = t('loading.disconnected', { reason });
      }
      setTimeout(
        () => {
          loading.classList.add('hidden');
          menu.classList.remove('hidden');
          menuTraining.classList.add('hidden');
          menuMain.classList.remove('hidden');
          document.getElementById('hud')!.classList.add('hidden');
        },
        deliberate ? 0 : 2200,
      );
    },
    onSnapshot: (snap: Snapshot, at: number) => {
      state.onSnapshot(snap, at);
      handleEvents(snap);
    },
    onMessage: (msg: ServerMessage) => handleServerMessage(msg),
  });
  socket.connect({
    room: room || 'estadio',
    name: myName,
    team: pendingDrill ? 0 : teamValue === 'auto' ? undefined : Number(teamValue),
  });
}

/** Walk off the pitch on purpose: no "disconnected" scare, straight to the menu. */
function leaveMatch(): void {
  if (!socket) return;
  leaving = true;
  socket.close();
  running = false;
  // close() detaches the socket, so nothing else will report the close.
  socket = null;
  leaveTraining();
  settings.setInGame(false);
  menu.classList.remove('hidden');
  menuTraining.classList.add('hidden');
  menuMain.classList.remove('hidden');
  document.getElementById('hud')!.classList.add('hidden');
}

/** Put the training furniture away, whether we finished or got disconnected. */
function leaveTraining(): void {
  drillReport = null;
  drillPanel.hide();
  markers.clear();
  tutorial.stop();
  hud.setTrainingTime(null);
}

function handleServerMessage(msg: ServerMessage): void {
  switch (msg.t) {
    case 'welcome': {
      state.myPlayerId = msg.playerId;
      // Only the first player into a room dictates the match settings;
      // everyone after that drops into the game already being played.
      if (msg.host) {
        socket?.send({
          t: 'config',
          matchSeconds: pendingDrill ? 600 : Number(lengthSelect.value),
          teamSize: Number(sizeSelect.value),
          difficulty: Number(difficultySelect.value),
          powerups: !pendingDrill,
        });
        if (pendingDrill) socket?.send({ t: 'training', drill: pendingDrill });
      }
      break;
    }
    case 'lobby': {
      lobbyNames = new Map(msg.players.map((p) => [p.id, p.name]));
      const mine = msg.players.find((p) => p.id === state.myPlayerId);
      if (mine) {
        controls.flip = mine.team === 1 ? -1 : 1;
        camera.flip = mine.team === 1 ? -1 : 1;
        const role = state.world.players.find((p) => p.id === mine.id)?.role ?? Role.Midfielder;
        hud.setYou(mine.name, mine.team, role);
        const ping = msg.players.find((p) => p.id === state.myPlayerId)?.ping ?? 0;
        hud.setPing(ping);
      }
      refreshNameTags();
      break;
    }
    case 'chat':
      hud.chat(msg.from, msg.text, msg.team);
      break;
    case 'notice':
      hud.note(msg.key ? t(msg.key as Key, msg.params) : msg.text);
      break;
    case 'drill': {
      drillReport = msg;
      drillTime = msg.time;
      drillPanel.show(msg);
      markers.set(msg.markers);
      if (msg.drill === 'tutorial') {
        drillPanel.hide();
        if (!tutorial.running) tutorial.start();
      }
      break;
    }
    default:
      break;
  }
}

// --- reacting to the match --------------------------------------------------

let lastGoalCount = -1;
/** Drill clock, kept running locally between the server's updates. */
let drillTime = 0;

function handleEvents(snap: Snapshot): void {
  tutorial.pushEvents(snap.events);
  for (const e of snap.events) {
    switch (e.t) {
      case 'kick':
        sfx.kick(e.power);
        {
          const p = snap.players.find((x) => x.id === e.player);
          if (p) effects.turf(p.x, p.z, 5);
        }
        break;
      case 'tackle':
        if (e.kind === 'slide') {
          sfx.slide();
          const p = snap.players.find((x) => x.id === e.player);
          if (p) effects.turf(p.x, p.z, 16, 0x5a4a2a);
        } else {
          sfx.tackle();
        }
        break;
      case 'foul': {
        const name = lobbyNames.get(e.player) ?? t('event.someone');
        hud.note(t('event.foul', { name }));
        break;
      }
      case 'goal': {
        const scorer = lobbyNames.get(e.scorer) ?? '';
        hud.handleGoalCounter(snap.goalCount, e.team, scorer);
        sfx.goal();
        setCrowdHype(1);
        const info = TEAM_INFO[e.team] ?? TEAM_INFO[0];
        effects.confetti(snap.ball.x, snap.ball.z, info.primary, info.accent);
        break;
      }
      case 'save':
        hud.note(t('event.save'));
        sfx.gasp();
        setCrowdHype(0.65);
        break;
      case 'post':
        sfx.post();
        effects.sparks(e.x, e.z);
        hud.note(t('event.post'));
        setCrowdHype(0.8);
        break;
      case 'whistle':
        sfx.whistle(e.kind === 'fulltime');
        if (e.kind === 'fulltime' && !drillReport) {
          const [a, b] = snap.score;
          hud.toast(t('event.fulltime'), a === b ? t('event.draw') : TEAM_INFO[a > b ? 0 : 1].name, 4000);
        }
        if (e.kind === 'foul') hud.toast(t('event.foul.toast'), '', 1400);
        break;
      case 'pickup': {
        sfx.powerup();
        const info = POWERUP_INFO[e.type];
        const who = lobbyNames.get(e.player) ?? '';
        // The names are flavour and stay in Spanish; the explanation is not.
        const blurb = info ? t(`powerup.${info.key}.blurb` as Key) : '';
        if (e.player === state.myPlayerId) hud.toast(info?.label ?? '', blurb, 1800);
        else if (who) hud.note(`${who} → ${info?.label ?? ''}`);
        break;
      }
      case 'bounce':
        sfx.bounce(e.speed);
        if (e.speed > 6) effects.dust(e.x, e.y, e.z, e.speed);
        break;
      case 'wall':
        sfx.wall(e.speed);
        break;
      case 'chance':
        setCrowdHype(0.55);
        break;
      default:
        break;
    }
  }

  if (snap.goalCount !== lastGoalCount) lastGoalCount = snap.goalCount;
}

// --- name tags ---------------------------------------------------------------

function makeNameTag(text: string, colour: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 34px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, 128, 34, 240);
  ctx.fillStyle = `#${colour.toString(16).padStart(6, '0')}`;
  ctx.fillText(text, 128, 34, 240);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  sprite.scale.set(4.2, 1.05, 1);
  return sprite;
}

function refreshNameTags(): void {
  for (const [id, sprite] of nameTags) {
    sprite.removeFromParent();
    nameTags.delete(id);
  }
  for (const [id, name] of lobbyNames) {
    const p = state.world.players.find((x) => x.id === id);
    if (!p || p.bot) continue; // only humans get a tag; bots stay anonymous
    const tag = makeNameTag(name, id === state.myPlayerId ? 0xffd34d : 0xffffff);
    tag.renderOrder = 10;
    stage.scene.add(tag);
    nameTags.set(id, tag);
  }
}

// --- frame ------------------------------------------------------------------

function rigFor(p: RenderPlayer): PlayerRig {
  let rig = rigs.get(p.id);
  if (!rig || rig.team !== p.team || rig.role !== p.role) {
    if (rig) rig.group.removeFromParent();
    rig = makePlayerRig(p.team, p.role);
    stage.scene.add(rig.group);
    rigs.set(p.id, rig);
  }
  return rig;
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  if (running && socket) {
    // Fixed-step prediction so the local sim matches the server exactly.
    accumulator += dt;
    let steps = 0;
    while (accumulator >= TICK_DT && steps < 5) {
      accumulator -= TICK_DT;
      steps++;
      const input = controls.sample();
      if (state.myPlayerId >= 0) {
        socket.queueInput(state.predict(input));
      }
    }
    socket.flush();
    state.decayError(dt);
  }

  const view = state.sample(now);
  if (view) drawWorld(view, dt, now);

  if (drillReport) {
    drillTime += dt;
    hud.setTrainingTime(drillTime);
    markers.update(now / 1000);
  }

  effects.update(dt);
  decayCrowdHype(dt);
  stadium.update(now / 1000);
  stage.renderer.render(stage.scene, stage.camera);
}

function drawWorld(view: NonNullable<ReturnType<MatchState['sample']>>, dt: number, now: number): void {
  const seen = new Set<number>();
  let myPlayer: RenderPlayer | null = null;

  for (const p of view.players) {
    seen.add(p.id);
    const rig = rigFor(p);
    const controlled = p.id === state.myPlayerId;
    if (controlled) myPlayer = p;
    poseRig(rig, p.x, p.z, p.facing, p.speed, p.act, p.actTimer, dt, p.powerup, controlled || (!p.bot && p.controlled));

    const tag = nameTags.get(p.id);
    if (tag) tag.position.set(p.x, 2.6, p.z);

    // Boots on turf for anyone near the camera focus.
    if (controlled && p.speed > 1.2 && p.act !== PlayerAct.Stunned) {
      sfx.step(p.speed, now / 1000);
    }
  }

  for (const [id, rig] of rigs) {
    if (!seen.has(id)) {
      rig.group.removeFromParent();
      rigs.delete(id);
    }
  }

  // Ball.
  ball.group.position.set(view.ball.x, Math.max(BALL_RADIUS, view.ball.y), view.ball.z);
  ball.mesh.rotation.x -= view.ball.speed * dt * 0.9;
  ball.mesh.rotation.y -= view.ball.spinY * dt * 0.35;
  ball.shadow.position.set(0, -view.ball.y + 0.03, 0);
  const shadowScale = clamp(1.1 - view.ball.y * 0.05, 0.45, 1.1);
  ball.shadow.scale.setScalar(shadowScale);
  trail.update(view.ball.x, view.ball.y, view.ball.z, view.ball.speed);

  // Referee.
  poseRig(
    referee.rig,
    view.referee.x,
    view.referee.z,
    view.referee.facing,
    2.5,
    PlayerAct.Run,
    0,
    dt,
    0,
    false,
  );
  referee.rig.ring.visible = false;

  // Power-ups.
  const livePickups = new Set<number>();
  for (const pu of view.pickups) {
    livePickups.add(pu.id);
    let mesh = pickupMeshes.get(pu.id);
    if (!mesh) {
      mesh = makePowerup();
      stage.scene.add(mesh);
      pickupMeshes.set(pu.id, mesh);
    }
    tintPowerup(mesh, pu.type);
    mesh.visible = pu.respawn <= 0;
    mesh.position.set(pu.x, 1.15 + Math.sin(now / 400 + pu.id) * 0.22, pu.z);
    mesh.rotation.y = now / 700 + pu.id;
    (mesh.userData.halo as THREE.Mesh).rotation.z = now / 500;
  }
  for (const [id, mesh] of pickupMeshes) {
    if (!livePickups.has(id)) {
      mesh.removeFromParent();
      pickupMeshes.delete(id);
    }
  }

  // Camera and crowd.
  const focus = myPlayer ?? { x: view.ball.x, z: view.ball.z };
  camera.update(
    view.ball.x,
    view.ball.z,
    view.ball.y,
    focus.x,
    focus.z,
    view.ball.speed,
    dt,
    effects.shake,
  );

  // The crowd gets louder the closer play is to a goal.
  const danger = Math.abs(view.ball.x) / 40;
  sfx.setCrowd(clamp(danger * 0.5 + (view.phase === MatchPhase.GoalCelebration ? 0.5 : 0), 0, 1));

  if (tutorial.running) {
    tutorial.observe({ view, me: myPlayer ?? undefined, myId: state.myPlayerId, dt });
  }

  hud.update(view, state.myPlayerId);
}

requestAnimationFrame(frame);

// A handle on the innards for headless debugging. Dev builds only - Vite
// folds this away entirely when the game is bundled for production.
if (import.meta.env.DEV) {
  (window as unknown as { __nf: unknown }).__nf = { state, controls, tutorial, hud, settings };
}

// Keep the audio context alive across tab switches.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) sfx.start();
});
