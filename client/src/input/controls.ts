import { headingOf, len2 } from '@shared/math.js';
import { BTN, emptyInput, type PlayerInput } from '@shared/types.js';
import {
  loadBindings,
  saveBindings,
  shouldSwallow,
  type Action,
  type Bindings,
} from './bindings.js';
import { Pad } from './gamepad.js';

/** Is this keystroke going into something the player is typing in? */
function isField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

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

  /** The gamepad, if there is one. Polled here, read by the menu navigator. */
  readonly pad: Pad;

  private onAction: (action: Action) => void;
  private onRawKey: (key: string) => void;

  constructor(
    target: HTMLElement,
    onAction: (action: Action) => void = () => {},
    onRawKey: (key: string) => void = () => {},
    onPadChange: () => void = () => {},
  ) {
    this.onAction = onAction;
    this.onRawKey = onRawKey;
    this.pad = new Pad(onPadChange);

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
      // Somebody is filling in a form - their name, the room, a dropdown. The
      // letters are theirs, not the game's; only Esc still means Esc.
      if (k !== 'escape' && isField(e.target)) return;
      // A key that does something in the game does nothing else: without this,
      // the T that opens the chat box also arrives as the first letter typed
      // into it, because focus moves while the keystroke is still in flight.
      if (shouldSwallow(k) || this.bound(k)) e.preventDefault();
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

  /** Is anything at all listening for this key? */
  private bound(key: string): boolean {
    for (const keys of Object.values(this.binds)) {
      if (keys.includes(key)) return true;
    }
    return false;
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

  /** Swallow the next key, click or pad button and hand it to `cb`. Esc clears. */
  captureNext(cb: (key: string) => void): void {
    this.capture = cb;
  }

  /** True while a rebind is waiting, so the menu ignores the same button. */
  get capturing(): boolean {
    return this.capture !== null;
  }

  cancelCapture(): void {
    this.capture = null;
  }

  /** Is any key bound to this action currently held? */
  isDown(action: Action): boolean {
    for (const k of this.binds[action]) {
      if (k && (this.down.has(k) || this.pad.down.has(k))) return true;
    }
    return false;
  }

  /**
   * Read the gamepad. Called once per rendered frame, not once per simulation
   * tick, so a button is announced exactly once however many ticks the frame
   * has to catch up on.
   */
  poll(): void {
    this.pad.poll();
    for (const key of this.pad.pressed) {
      if (this.capture) {
        const cb = this.capture;
        this.capture = null;
        cb(key);
        return;
      }
      if (!this.typing) this.press(key);
    }
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

    // The left stick wins whenever it is actually being pushed, so a pad player
    // gets analog speed while the keys stay all-or-nothing.
    const pad = this.pad;
    if (pad.lx !== 0 || pad.ly !== 0) {
      x = pad.lx;
      z = pad.ly;
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
    // The right stick aims independently: hold a run one way, pass the other.
    if (len2(pad.rx, pad.ry) > 0.5) {
      this.lastHeading = headingOf(pad.rx * this.flip, pad.ry * this.flip);
    }
    input.aim = this.lastHeading;
    return input;
  }
}
