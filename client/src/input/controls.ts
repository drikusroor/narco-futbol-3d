import { headingOf, len2 } from '@shared/math.js';
import { BTN, emptyInput, type PlayerInput } from '@shared/types.js';

/**
 * Keyboard, mouse and gamepad, folded into the one input struct the simulation
 * understands. The view flips for the away side, and so do the controls, so
 * "up" on the stick is always toward the goal you are attacking.
 */
export class Controls {
  private keys = new Set<string>();
  private mouseButtons = 0;
  private lastHeading = 0;
  /** +1 home, -1 away: mirrors movement to match the flipped camera. */
  flip = 1;
  /** Set while the chat box has focus so typing does not move the player. */
  typing = false;

  private onKeyExtra: (key: string) => void;

  constructor(target: HTMLElement, onKeyExtra: (key: string) => void = () => {}) {
    this.onKeyExtra = onKeyExtra;

    window.addEventListener('keydown', (e) => {
      if (this.typing) {
        if (e.key === 'Escape' || e.key === 'Enter') this.onKeyExtra(e.key);
        return;
      }
      const k = e.key.toLowerCase();
      if (BLOCKED.has(k) || BLOCKED.has(e.code)) e.preventDefault();
      if (!this.keys.has(k)) this.onKeyExtra(k);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons = 0;
    });

    target.addEventListener('mousedown', (e) => {
      if (this.typing) return;
      this.mouseButtons |= 1 << e.button;
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseButtons &= ~(1 << e.button);
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private held(...names: string[]): boolean {
    for (const n of names) if (this.keys.has(n)) return true;
    return false;
  }

  /** Read every device and produce one tick of input. */
  sample(): PlayerInput {
    const input = emptyInput(0);
    if (this.typing) {
      input.aim = this.lastHeading;
      return input;
    }

    let x = 0;
    let z = 0;
    if (this.held('a', 'arrowleft')) x -= 1;
    if (this.held('d', 'arrowright')) x += 1;
    if (this.held('w', 'arrowup')) z -= 1;
    if (this.held('s', 'arrowdown')) z += 1;

    let buttons = 0;
    if (this.held('shift')) buttons |= BTN.SPRINT;
    if (this.held('j') || this.mouseButtons & 1) buttons |= BTN.PASS;
    if (this.held('k') || this.mouseButtons & 2) buttons |= BTN.SHOOT;
    if (this.held('l')) buttons |= BTN.LOB;
    if (this.held(' ')) buttons |= BTN.TACKLE;
    if (this.held('q')) buttons |= BTN.SWITCH;

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

/** Keys we swallow so the browser does not scroll the page mid-match. */
const BLOCKED = new Set([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'Space']);
