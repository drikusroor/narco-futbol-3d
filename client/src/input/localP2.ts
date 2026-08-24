import { headingOf, len2 } from '@shared/math.js';
import { BTN, emptyInput, type PlayerInput } from '@shared/types.js';
import { Pad } from './gamepad.js';

type P2Action = 'up' | 'down' | 'left' | 'right' | 'sprint' | 'pass' | 'shoot' | 'lob' | 'tackle' | 'switch';

/**
 * Fixed, non-remappable key cluster for a second human on the same keyboard.
 * Player one keeps WASD + JKL + space + Q; this lives in the block player one
 * never touches, keyed by `code` so left and right Shift/Ctrl are distinct.
 */
const KEYMAP: Record<P2Action, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  sprint: 'ShiftRight',
  pass: 'Enter',
  shoot: 'Quote',
  lob: 'Semicolon',
  tackle: 'Slash',
  switch: 'BracketRight',
};

/** Same standard-mapping buttons the default pad bindings use, so any pad works out of the box. */
const PAD_MAP: Record<P2Action, string> = {
  up: 'pad12',
  down: 'pad13',
  left: 'pad14',
  right: 'pad15',
  sprint: 'pad5',
  pass: 'pad0',
  shoot: 'pad1',
  lob: 'pad3',
  tackle: 'pad2',
  switch: 'pad4',
};

function isField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * A second, independent input source for local co-op: its own fixed key
 * cluster plus whichever gamepad isn't already claimed by player one. Kept
 * entirely separate from `Controls` so it never touches the rebindable table.
 */
export class SecondPlayerControls {
  private down = new Set<string>();
  private lastHeading = 0;
  flip = 1;
  readonly pad: Pad;

  constructor() {
    this.pad = new Pad(() => {}, 1);
    window.addEventListener('keydown', (e) => {
      if (isField(e.target)) return;
      if ((Object.values(KEYMAP) as string[]).includes(e.code)) e.preventDefault();
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  poll(): void {
    this.pad.poll();
  }

  private isDown(action: P2Action): boolean {
    return this.down.has(KEYMAP[action]) || this.pad.down.has(PAD_MAP[action]);
  }

  sample(): PlayerInput {
    const input = emptyInput(0);
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

    const pad = this.pad;
    if (pad.lx !== 0 || pad.ly !== 0) {
      x = pad.lx;
      z = pad.ly;
    }

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
    if (len2(pad.rx, pad.ry) > 0.5) {
      this.lastHeading = headingOf(pad.rx * this.flip, pad.ry * this.flip);
    }
    input.aim = this.lastHeading;
    return input;
  }
}
