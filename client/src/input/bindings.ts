/**
 * Every key the game listens to lives here, as a named action bound to one or
 * more physical keys. Nothing else in the client hard-codes a key, so the
 * settings screen can rebind anything without the game noticing.
 */

export type Action =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'sprint'
  | 'pass'
  | 'shoot'
  | 'lob'
  | 'tackle'
  | 'switch'
  | 'chat'
  | 'help'
  | 'settings'
  | 'mute';

/** Order the settings screen lists them in. */
export const ACTIONS: Action[] = [
  'up',
  'down',
  'left',
  'right',
  'sprint',
  'pass',
  'shoot',
  'lob',
  'tackle',
  'switch',
  'chat',
  'help',
  'settings',
  'mute',
];

/** Actions that fire once on the press rather than being held. */
export const TAP_ACTIONS: Action[] = ['chat', 'help', 'settings', 'mute', 'switch'];

export type Bindings = Record<Action, string[]>;

/** Key, alternative, gamepad button. The settings table is these three columns. */
export const SLOTS = 3;

/**
 * Keys are stored lowercased exactly as `KeyboardEvent.key` reports them, plus
 * `mouse0` / `mouse2` for the two mouse buttons the game uses and `pad0`…`pad16`
 * for gamepad buttons in the browser's standard mapping.
 */
export const DEFAULT_BINDINGS: Bindings = {
  up: ['w', 'arrowup', 'pad12'],
  down: ['s', 'arrowdown', 'pad13'],
  left: ['a', 'arrowleft', 'pad14'],
  right: ['d', 'arrowright', 'pad15'],
  sprint: ['shift', '', 'pad5'],
  pass: ['j', 'mouse0', 'pad0'],
  shoot: ['k', 'mouse2', 'pad1'],
  lob: ['l', '', 'pad3'],
  tackle: [' ', '', 'pad2'],
  switch: ['q', '', 'pad4'],
  chat: ['t', '', ''],
  help: ['h', '', 'pad8'],
  settings: ['escape', '', 'pad9'],
  mute: ['m', '', ''],
};

const STORAGE_KEY = 'nf.binds';

export function defaultBindings(): Bindings {
  const out = {} as Bindings;
  for (const a of ACTIONS) out[a] = [...DEFAULT_BINDINGS[a]];
  return out;
}

export function loadBindings(): Bindings {
  const binds = defaultBindings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return binds;
    const saved = JSON.parse(raw) as Partial<Record<Action, unknown>>;
    for (const a of ACTIONS) {
      const v = saved[a];
      if (!Array.isArray(v)) continue;
      // Bindings saved before the pad column existed are two long; keep the
      // keys the player chose and let the pad default fill the gap.
      binds[a] = binds[a].map((fallback, i) => (i < v.length ? String(v[i] ?? '') : fallback));
    }
  } catch {
    // A corrupt blob in storage is not worth refusing to start over.
  }
  return binds;
}

export function saveBindings(binds: Bindings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(binds));
  } catch {
    // Private browsing; the bindings simply do not persist.
  }
}

/**
 * Standard-mapping button names. Xbox lettering, because it is what most pads
 * are printed with and what the browser's mapping is modelled on; a PlayStation
 * pad reports the same indices, so A is ✕, B is ◯, X is ▢ and Y is △.
 */
const PAD_LABELS: string[] = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'Back',
  'Start',
  'L3',
  'R3',
  'Pad ↑',
  'Pad ↓',
  'Pad ←',
  'Pad →',
  'Guide',
];

export function isPadKey(key: string): boolean {
  return key.startsWith('pad');
}

/** Human-readable name for a bound key, for the settings table. */
export function keyLabel(key: string): string {
  if (!key) return '—';
  if (isPadKey(key)) return PAD_LABELS[Number(key.slice(3))] ?? key.toUpperCase();
  const named: Record<string, string> = {
    ' ': 'Space',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    escape: 'Esc',
    shift: 'Shift',
    control: 'Ctrl',
    alt: 'Alt',
    tab: 'Tab',
    enter: 'Enter',
    backspace: 'Backspace',
    mouse0: 'Left click',
    mouse1: 'Middle click',
    mouse2: 'Right click',
  };
  return named[key] ?? key.toUpperCase();
}

/** Keys the browser would otherwise act on (scrolling, quick find). */
export function shouldSwallow(key: string): boolean {
  return key === ' ' || key.startsWith('arrow') || key === '/' || key === "'";
}
