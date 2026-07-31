import type { Sfx } from '../audio/sfx.js';
import {
  ACTIONS,
  SLOTS,
  defaultBindings,
  isPadKey,
  keyLabel,
  type Action,
} from '../input/bindings.js';
import type { Controls } from '../input/controls.js';
import { LANGS, applyStatic, getLang, onLangChange, setLang, t, type Key } from '../i18n.js';

/** How players are drawn: the 3D rig, the pre-rendered sheets, or both. */
export type SpriteMode = 'off' | 'auto' | 'all';
export const SPRITE_MODES: SpriteMode[] = ['off', 'auto', 'all'];

const ART_KEY = 'nf.art';

function loadArt(): SpriteMode {
  try {
    const saved = localStorage.getItem(ART_KEY);
    if (saved && (SPRITE_MODES as string[]).includes(saved)) return saved as SpriteMode;
  } catch {
    // no storage; the models are the safe default anyway
  }
  return 'off';
}

/**
 * The settings screen: language, volume and every key binding, rebindable by
 * clicking the key and pressing another one. It is also where a new player
 * finds out what the controls actually are.
 */
export class Settings {
  private root = document.getElementById('settings')!;
  private langRow = document.getElementById('lang-row')!;
  private bindTable = document.getElementById('bind-table')!;
  private helpList = document.getElementById('help-list')!;
  private volume = document.getElementById('volume-input') as HTMLInputElement;
  private volumeValue = document.getElementById('volume-value')!;
  private padStatus = document.getElementById('pad-status')!;
  private artRow = document.getElementById('art-row')!;
  private art: SpriteMode = loadArt();
  private leaveButton = document.getElementById('settings-leave')!;
  private controls: Controls;
  private sfx: Sfx;
  private onClose: () => void;

  constructor(
    controls: Controls,
    sfx: Sfx,
    onClose: () => void = () => {},
    onLeave: () => void = () => {},
  ) {
    this.controls = controls;
    this.sfx = sfx;
    this.onClose = onClose;
    this.leaveButton.addEventListener('click', () => {
      this.close();
      onLeave();
    });

    for (const lang of LANGS) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.dataset.lang = lang;
      chip.textContent = lang === 'en' ? 'English' : 'Español';
      chip.addEventListener('click', () => setLang(lang));
      this.langRow.appendChild(chip);
    }

    for (const mode of SPRITE_MODES) {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.dataset.art = mode;
      chip.addEventListener('click', () => {
        this.art = mode;
        try {
          localStorage.setItem(ART_KEY, mode);
        } catch {
          // not persisting is survivable
        }
        this.render();
      });
      this.artRow.appendChild(chip);
    }

    this.volume.value = String(Math.round(sfx.getVolume() * 100));
    this.volumeValue.textContent = this.volume.value;
    this.volume.addEventListener('input', () => {
      const v = Number(this.volume.value);
      this.volumeValue.textContent = String(v);
      sfx.start();
      sfx.setVolume(v / 100);
    });

    document.getElementById('settings-close')!.addEventListener('click', () => this.close());
    document.getElementById('settings-reset')!.addEventListener('click', () => {
      this.controls.setBindings(defaultBindings());
      this.render();
    });

    onLangChange(() => this.render());
    this.render();
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  get spriteMode(): SpriteMode {
    return this.art;
  }

  /** Only offer the way out when there is a pitch to walk off. */
  setInGame(inGame: boolean): void {
    this.leaveButton.classList.toggle('hidden', !inGame);
  }

  show(): void {
    this.render();
    this.root.classList.remove('hidden');
    this.controls.blocked = true;
  }

  close(): void {
    this.controls.cancelCapture();
    this.root.classList.add('hidden');
    this.controls.blocked = false;
    this.onClose();
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  /** Rebuild the language chips, the bindings table and the in-game help list. */
  render(): void {
    applyStatic(this.root);
    for (const chip of this.langRow.querySelectorAll<HTMLElement>('.chip')) {
      chip.classList.toggle('on', chip.dataset.lang === getLang());
    }
    for (const chip of this.artRow.querySelectorAll<HTMLElement>('.chip')) {
      chip.textContent = t(`settings.art.${chip.dataset.art}` as Key);
      chip.classList.toggle('on', chip.dataset.art === this.art);
    }
    this.bindTable.replaceChildren(this.header(), ...ACTIONS.map((a) => this.bindRow(a, true)));
    this.helpList.replaceChildren(this.header(), ...ACTIONS.map((a) => this.bindRow(a, false)));
    this.renderPad();
  }

  /** Say whether a pad is plugged in, and what the browser thinks it is. */
  renderPad(): void {
    const pad = this.controls.pad;
    this.padStatus.textContent = pad.connected
      ? t('settings.pad.found', { name: padName(pad.id) })
      : t('settings.pad.none');
    this.padStatus.classList.toggle('on', pad.connected);
  }

  private header(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bind-row head';
    for (const key of ['settings.action', 'settings.primary', 'settings.secondary', 'settings.pad']) {
      const cell = document.createElement('span');
      cell.textContent = t(key as Key);
      row.appendChild(cell);
    }
    return row;
  }

  private bindRow(action: Action, editable: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bind-row';
    const label = document.createElement('span');
    label.textContent = t(`action.${action}` as Key);
    row.appendChild(label);

    for (let slot = 0; slot < SLOTS; slot++) {
      const key = document.createElement('button');
      key.className = 'bind-key';
      key.textContent = keyLabel(this.controls.bindings[action][slot] ?? '');
      if (editable) key.addEventListener('click', () => this.rebind(action, slot, key));
      else key.tabIndex = -1;
      row.appendChild(key);
    }
    return row;
  }

  /** Listen for the next key or click and bind it here. Esc clears the slot. */
  private rebind(action: Action, slot: number, cell: HTMLElement): void {
    this.bindTable.querySelectorAll('.listening').forEach((el) => el.classList.remove('listening'));
    cell.classList.add('listening');
    cell.textContent = t('settings.listening');
    this.controls.captureNext((key) => {
      const binds = this.controls.bindings;
      // A key can only do one thing: take it off whatever had it.
      if (key) {
        for (const other of ACTIONS) {
          binds[other] = binds[other].map((k) => (k === key ? '' : k));
        }
      }
      binds[action][slot] = key;
      this.controls.setBindings(binds);
      this.render();
    });
  }
}

/**
 * Browsers report a pad as "Xbox Wireless Controller (STANDARD GAMEPAD
 * Vendor: 045e Product: 02fd)". Nobody needs the hex.
 */
function padName(id: string): string {
  return id.replace(/\s*\((?:STANDARD|Vendor|Product).*$/i, '').trim() || id;
}

/** Pretty-print the keys bound to an action, for the tutorial's prompts. */
export function bindingText(controls: Controls, action: Action): string {
  // The pad column is only worth mentioning to someone holding a pad.
  const keys = controls.bindings[action]
    .filter((k, i) => k && (!isPadKey(k) || controls.pad.connected))
    .map(keyLabel);
  return keys.length ? keys.join(' / ') : '—';
}
