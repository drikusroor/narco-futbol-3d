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

/**
 * Keys are stored lowercased exactly as `KeyboardEvent.key` reports them, plus
 * `mouse0` / `mouse2` for the two mouse buttons the game uses.
 */
export const DEFAULT_BINDINGS: Bindings = {
  up: ['w', 'arrowup'],
  down: ['s', 'arrowdown'],
  left: ['a', 'arrowleft'],
  right: ['d', 'arrowright'],
  sprint: ['shift', ''],
  pass: ['j', 'mouse0'],
  shoot: ['k', 'mouse2'],
  lob: ['l', ''],
  tackle: [' ', ''],
  switch: ['q', ''],
  chat: ['t', ''],
  help: ['h', ''],
  settings: ['escape', ''],
  mute: ['m', ''],
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
      binds[a] = [String(v[0] ?? ''), String(v[1] ?? '')];
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

/** Human-readable name for a bound key, for the settings table. */
export function keyLabel(key: string): string {
  if (!key) return '—';
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
