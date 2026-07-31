import type { Controls } from '../input/controls.js';

/**
 * Driving the front end with a gamepad. Nothing on the menus is bespoke: it
 * walks whatever focusable controls the visible plate happens to contain, so
 * new buttons and fields are navigable the day they are added.
 *
 * Only the menus and the settings modal are handled. Once you are on the pitch
 * the pad is the player's, not the cursor's.
 */

/** Held direction repeats at this rate, after this much of a pause. */
const REPEAT_DELAY = 0.36;
const REPEAT_RATE = 0.11;
/** How far the stick has to go before it counts as a direction press. */
const STICK_GATE = 0.6;

type Dir = 'up' | 'down' | 'left' | 'right' | '';

export class PadNav {
  private controls: Controls;
  private dir: Dir = '';
  private timer = 0;
  /** The plate we were last steering, so focus resets when it changes. */
  private plate: HTMLElement | null = null;

  constructor(controls: Controls) {
    this.controls = controls;
  }

  update(dt: number): void {
    const pad = this.controls.pad;
    // Focus rings are drawn only while a pad is about; a mouse never sees them.
    document.body.classList.toggle('pad-active', pad.connected);
    const plate = visiblePlate();
    if (!pad.connected || !plate) {
      this.plate = null;
      this.dir = '';
      return;
    }

    const items = focusable(plate);
    if (!items.length) return;
    if (plate !== this.plate) {
      this.plate = plate;
      items[0].focus();
    }

    // A rebind is listening for a button; it gets this press, not the menu.
    if (this.controls.capturing) return;

    if (pad.pressed.includes('pad0')) {
      activate(document.activeElement);
      return;
    }
    if (pad.pressed.includes('pad1')) {
      back();
      return;
    }

    const dir = direction(pad.down, pad.lx, pad.ly);
    if (dir !== this.dir) {
      this.dir = dir;
      this.timer = REPEAT_DELAY;
      if (dir) this.step(dir, items);
      return;
    }
    if (!dir) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = REPEAT_RATE;
      this.step(dir, items);
    }
  }

  private step(dir: Dir, items: HTMLElement[]): void {
    const active = document.activeElement as HTMLElement | null;
    // Left and right belong to the field itself when it has options to cycle.
    if ((dir === 'left' || dir === 'right') && active && adjust(active, dir === 'right' ? 1 : -1)) {
      return;
    }
    const at = active ? items.indexOf(active) : -1;
    const delta = dir === 'up' || dir === 'left' ? -1 : 1;
    const next = at < 0 ? 0 : (at + delta + items.length) % items.length;
    items[next].focus();
  }
}

/** The topmost plate the pad should be steering, or null if we are playing. */
function visiblePlate(): HTMLElement | null {
  const settings = document.getElementById('settings')!;
  if (!settings.classList.contains('hidden')) {
    return settings.querySelector<HTMLElement>('.plate');
  }
  const menu = document.getElementById('menu')!;
  if (menu.classList.contains('hidden')) return null;
  return menu.querySelector<HTMLElement>('.plate:not(.hidden)');
}

function focusable(root: HTMLElement): HTMLElement[] {
  const all = root.querySelectorAll<HTMLElement>('button, select, input');
  // offsetParent goes null for anything display:none, which is how the menus
  // hide their halves - so this also skips the plate that is not on screen.
  return [...all].filter((el) => el.offsetParent !== null && !(el as HTMLInputElement).disabled);
}

function activate(el: Element | null): void {
  if (el instanceof HTMLButtonElement) el.click();
  else if (el instanceof HTMLInputElement && el.type !== 'range') el.focus();
}

/** B backs out of wherever we are: the settings modal, then the drill list. */
function back(): void {
  const settings = document.getElementById('settings')!;
  if (!settings.classList.contains('hidden')) {
    document.getElementById('settings-close')!.click();
    return;
  }
  const training = document.getElementById('menu-training')!;
  if (!training.classList.contains('hidden')) document.getElementById('training-back')!.click();
}

/** Nudge a dropdown or a slider. Returns false if this is not that kind of field. */
function adjust(el: HTMLElement, delta: number): boolean {
  if (el instanceof HTMLSelectElement) {
    const next = el.selectedIndex + delta;
    if (next >= 0 && next < el.options.length) {
      el.selectedIndex = next;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }
  if (el instanceof HTMLInputElement && el.type === 'range') {
    const step = Number(el.step) || 1;
    el.value = String(Number(el.value) + delta * step * 5);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  return false;
}

function direction(down: Set<string>, lx: number, ly: number): Dir {
  if (down.has('pad12') || ly < -STICK_GATE) return 'up';
  if (down.has('pad13') || ly > STICK_GATE) return 'down';
  if (down.has('pad14') || lx < -STICK_GATE) return 'left';
  if (down.has('pad15') || lx > STICK_GATE) return 'right';
  return '';
}
