import type { Sfx } from '../audio/sfx.js';
import { ACTIONS, defaultBindings, keyLabel, type Action } from '../input/bindings.js';
import type { Controls } from '../input/controls.js';
import { LANGS, applyStatic, getLang, onLangChange, setLang, t, type Key } from '../i18n.js';

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
    this.bindTable.replaceChildren(...ACTIONS.map((a) => this.bindRow(a, true)));
    this.helpList.replaceChildren(...ACTIONS.map((a) => this.bindRow(a, false)));
  }

  private bindRow(action: Action, editable: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bind-row';
    const label = document.createElement('span');
    label.textContent = t(`action.${action}` as Key);
    row.appendChild(label);

    for (const slot of [0, 1]) {
      const key = document.createElement('div');
      key.className = 'bind-key';
      key.textContent = keyLabel(this.controls.bindings[action][slot] ?? '');
      if (editable) {
        key.addEventListener('click', () => this.rebind(action, slot, key));
      }
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

/** Pretty-print the keys bound to an action, for the tutorial's prompts. */
export function bindingText(controls: Controls, action: Action): string {
  const keys = controls.bindings[action].filter(Boolean).map(keyLabel);
  return keys.length ? keys.join(' / ') : '—';
}
