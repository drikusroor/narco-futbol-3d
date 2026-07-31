/**
 * One gamepad, read once a frame and reduced to the same vocabulary the
 * keyboard uses: a set of held "keys" (`pad0`…`pad16`) plus two analog sticks.
 * Everything above this only sees bindings, so a pad button can be bound to any
 * action exactly like a letter.
 *
 * Buttons follow the W3C standard mapping, which is what browsers report for
 * every Xbox, PlayStation and Switch Pro controller worth having.
 */

/** Sticks report a little noise at rest; ignore anything inside this circle. */
const DEADZONE = 0.22;
/** Analog triggers count as pressed past here. */
const TRIGGER = 0.35;

export class Pad {
  /** Buttons currently held, in binding notation. */
  down = new Set<string>();
  /** Buttons that went down on this poll, drained by whoever cares. */
  pressed: string[] = [];
  /** Left stick, deadzoned, +x right and +y down (screen sense). */
  lx = 0;
  ly = 0;
  /** Right stick, same convention. */
  rx = 0;
  ry = 0;
  /** What the browser calls it, for the settings screen. */
  id = '';

  private index = -1;
  private onChange: () => void;

  constructor(onChange: () => void = () => {}) {
    this.onChange = onChange;
    // Chrome only starts reporting a pad after it has been touched, so the
    // events are the reliable way to notice one arriving.
    window.addEventListener('gamepadconnected', () => this.onChange());
    window.addEventListener('gamepaddisconnected', () => {
      this.reset();
      this.onChange();
    });
  }

  get connected(): boolean {
    return this.index >= 0;
  }

  private reset(): void {
    this.index = -1;
    this.id = '';
    this.down.clear();
    this.pressed.length = 0;
    this.lx = this.ly = this.rx = this.ry = 0;
  }

  /** Read the hardware. Safe to call when no pad has ever been plugged in. */
  poll(): void {
    this.pressed.length = 0;
    const pads = navigator.getGamepads?.() ?? [];
    // Stay with the pad we were using; otherwise adopt the first live one.
    let pad = this.index >= 0 ? pads[this.index] : null;
    if (!pad?.connected) {
      pad = pads.find((p) => p?.connected) ?? null;
      const found = pad ? pad.index : -1;
      if (found !== this.index) {
        this.reset();
        this.index = found;
        if (pad) {
          this.id = pad.id;
          this.onChange();
        }
      }
    }
    if (!pad) return;
    this.id = pad.id;

    for (let i = 0; i < pad.buttons.length && i < 17; i++) {
      const b = pad.buttons[i];
      const held = b.pressed || b.value > TRIGGER;
      const key = `pad${i}`;
      if (held && !this.down.has(key)) this.pressed.push(key);
      if (held) this.down.add(key);
      else this.down.delete(key);
    }

    [this.lx, this.ly] = stick(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    [this.rx, this.ry] = stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
  }

  /**
   * A short jolt, where the hardware allows it. Failures are ignored on
   * purpose: rumble is decoration and half the pads out there cannot do it.
   */
  rumble(strength: number, ms: number): void {
    const pad = (navigator.getGamepads?.() ?? [])[this.index];
    const actuator = pad?.vibrationActuator;
    if (!actuator) return;
    try {
      void actuator.playEffect('dual-rumble', {
        duration: ms,
        strongMagnitude: strength,
        weakMagnitude: strength * 0.7,
      });
    } catch {
      // Older Chrome exposes the actuator but not this effect.
    }
  }
}

/** Radial deadzone, rescaled so the stick still reaches 1 at the rim. */
function stick(x: number, y: number): [number, number] {
  const mag = Math.hypot(x, y);
  if (mag < DEADZONE) return [0, 0];
  const scaled = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE)) / mag;
  return [x * scaled, y * scaled];
}
