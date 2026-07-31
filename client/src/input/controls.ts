import { headingOf, len2 } from '@shared/math.js';
import { BTN, emptyInput, type PlayerInput } from '@shared/types.js';
import {
  loadBindings,
  saveBindings,
  shouldSwallow,
  type Action,
  type Bindings,
} from './bindings.js';

/**
 * Keyboard, mouse and gamepad, folded into the one input struct the simulation
 * understands. The view flips for the away side, and so do the controls, so
 * "up" on the stick is always toward the goal you are attacking.
 *
 * Nothing here knows which key does what: it asks the bindings, which the
 * settings screen owns.
 */
export class Controls {
  /** Pressed keys and mouse buttons, in binding notation. */
  private down = new Set<string>();
  private lastHeading = 0;
  private binds: Bindings = loadBindings();
  private capture: ((key: string) => void) | null = null;
  /** +1 home, -1 away: mirrors movement to match the flipped camera. */
  flip = 1;
  /** Set while the chat box has focus so typing does not move the player. */
  typing = false;
  /** Set while a modal (settings, tutorial pause) owns the keyboard. */
  blocked = false;

  private onAction: (action: Action) => void;
  private onRawKey: (key: string) => void;

  constructor(
    target: HTMLElement,
    onAction: (action: Action) => void = () => {},
    onRawKey: (key: string) => void = () => {},
  ) {
    this.onAction = onAction;
    this.onRawKey = onRawKey;

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(k === 'escape' ? '' : k);
        return;
      }
      if (this.typing) {
        if (k === 'escape' || k === 'enter') this.onRawKey(k);
        return;
      }
      if (shouldSwallow(k)) e.preventDefault();
      if (!this.down.has(k)) this.press(k);
      this.down.add(k);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.down.clear());

    target.addEventListener('mousedown', (e) => {
      const k = `mouse${e.button}`;
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(k);
        return;
      }
      if (this.typing) return;
      e.preventDefault();
      if (!this.down.has(k)) this.press(k);
      this.down.add(k);
    });
    window.addEventListener('mouseup', (e) => this.down.delete(`mouse${e.button}`));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Announce whichever actions this key triggers, plus the raw key. */
  private press(key: string): void {
    this.onRawKey(key);
    for (const [action, keys] of Object.entries(this.binds) as [Action, string[]][]) {
      if (keys.includes(key)) this.onAction(action);
    }
  }

  get bindings(): Bindings {
    return this.binds;
  }

  setBindings(binds: Bindings): void {
    this.binds = binds;
    saveBindings(binds);
  }

  /** Swallow the next key or mouse press and hand it to `cb`. Esc clears. */
  captureNext(cb: (key: string) => void): void {
    this.capture = cb;
  }

  cancelCapture(): void {
    this.capture = null;
  }

  /** Is any key bound to this action currently held? */
  isDown(action: Action): boolean {
    for (const k of this.binds[action]) {
      if (k && this.down.has(k)) return true;
    }
    return false;
  }

  /** Read every device and produce one tick of input. */
  sample(): PlayerInput {
    const input = emptyInput(0);
    if (this.typing || this.blocked) {
      input.aim = this.lastHeading;
      return input;
    }

    let x = 0;
    let z = 0;
    if (this.isDown('left')) x -= 1;
    if (this.isDown('right')) x += 1;
    if (this.isDown('up')) z -= 1;
    if (this.isDown('down')) z += 1;

    let buttons = 0;
    if (this.isDown('sprint')) buttons |= BTN.SPRINT;
    if (this.isDown('pass')) buttons |= BTN.PASS;
    if (this.isDown('shoot')) buttons |= BTN.SHOOT;
    if (this.isDown('lob')) buttons |= BTN.LOB;
    if (this.isDown('tackle')) buttons |= BTN.TACKLE;
    if (this.isDown('switch')) buttons |= BTN.SWITCH;

    // Gamepad, if one is plugged in, wins on the axes when it is being pushed.
    const pad = navigator.getGamepads?.().find((p) => p && p.connected) ?? null;
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const az = pad.axes[1] ?? 0;
      if (Math.abs(ax) > 0.18 || Math.abs(az) > 0.18) {
        x = ax;
        z = az;
      }
      const b = pad.buttons;
      if (b[0]?.pressed) buttons |= BTN.PASS;
      if (b[1]?.pressed) buttons |= BTN.SHOOT;
      if (b[3]?.pressed) buttons |= BTN.LOB;
      if (b[2]?.pressed) buttons |= BTN.TACKLE;
      if (b[5]?.pressed || (b[7]?.value ?? 0) > 0.4) buttons |= BTN.SPRINT;
      if (b[4]?.pressed) buttons |= BTN.SWITCH;
    }

    // Flip to match the camera so the away side is not playing in a mirror.
    x *= this.flip;
    z *= this.flip;

    const mag = len2(x, z);
    if (mag > 1) {
      x /= mag;
      z /= mag;
    }
    input.moveX = x;
    input.moveZ = z;
    input.buttons = buttons;
    if (mag > 0.12) this.lastHeading = headingOf(x, z);
    input.aim = this.lastHeading;
    return input;
  }
}
