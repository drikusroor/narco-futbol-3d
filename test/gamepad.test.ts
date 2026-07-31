import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * The pad layer is browser code, but the parts worth getting wrong - deadzones,
 * press edges, and not losing someone's old key bindings when a column is added
 * to the table - are plain logic. Stub the two globals it touches and drive it.
 */

interface FakeButton {
  pressed: boolean;
  value: number;
}

const pads: (unknown | null)[] = [null];

function stub(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const store = new Map<string, string>();
stub('window', { addEventListener: () => {} });
stub('navigator', { getGamepads: () => pads, language: 'en' });
stub('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

const { Pad } = await import('../client/src/input/gamepad.js');
const { loadBindings, keyLabel, DEFAULT_BINDINGS } = await import(
  '../client/src/input/bindings.js'
);

/** A standard-mapping pad with everything at rest unless said otherwise. */
function fakePad(opts: { down?: number[]; axes?: number[] } = {}) {
  const buttons: FakeButton[] = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  for (const i of opts.down ?? []) buttons[i] = { pressed: true, value: 1 };
  return { index: 0, connected: true, id: 'Fake Pad (STANDARD GAMEPAD)', buttons, axes: opts.axes ?? [0, 0, 0, 0] };
}

test('a button is announced once, then just stays down', () => {
  const pad = new Pad();
  pads[0] = fakePad({ down: [0] });

  pad.poll();
  assert.deepEqual(pad.pressed, ['pad0'], 'the press edge');
  assert.ok(pad.down.has('pad0'));

  pad.poll();
  assert.deepEqual(pad.pressed, [], 'held, not pressed again');
  assert.ok(pad.down.has('pad0'));

  pads[0] = fakePad();
  pad.poll();
  assert.ok(!pad.down.has('pad0'), 'and released');
});

test('analog triggers count as buttons once they are meaningfully pulled', () => {
  const pad = new Pad();
  const light = fakePad();
  light.buttons[7] = { pressed: false, value: 0.2 };
  pads[0] = light;
  pad.poll();
  assert.ok(!pad.down.has('pad7'), 'a resting trigger is not a press');

  const pulled = fakePad();
  pulled.buttons[7] = { pressed: false, value: 0.8 };
  pads[0] = pulled;
  pad.poll();
  assert.ok(pad.down.has('pad7'), 'a pulled trigger is');
});

test('stick noise is ignored but the full range still reaches 1', () => {
  const pad = new Pad();
  pads[0] = fakePad({ axes: [0.1, -0.08, 0, 0] });
  pad.poll();
  assert.equal(pad.lx, 0, 'drift inside the deadzone is nothing');
  assert.equal(pad.ly, 0);

  pads[0] = fakePad({ axes: [1, 0, 0, -1] });
  pad.poll();
  assert.ok(Math.abs(pad.lx - 1) < 1e-6, `pushed hard should be 1, got ${pad.lx}`);
  assert.ok(Math.abs(pad.ry + 1) < 1e-6, 'and so should the right stick');

  // Just past the deadzone the stick barely moves, rather than jumping to 0.22.
  pads[0] = fakePad({ axes: [0.24, 0, 0, 0] });
  pad.poll();
  assert.ok(pad.lx > 0 && pad.lx < 0.05, `should ease in, got ${pad.lx}`);
});

test('the pad is dropped when it is unplugged and picked up again', () => {
  const pad = new Pad();
  pads[0] = fakePad({ down: [1] });
  pad.poll();
  assert.ok(pad.connected);

  pads[0] = null;
  pad.poll();
  assert.ok(!pad.connected, 'gone');
  assert.equal(pad.down.size, 0, 'and nothing left held down');

  pads[0] = fakePad({ down: [1] });
  pad.poll();
  assert.ok(pad.connected);
  assert.deepEqual(pad.pressed, ['pad1'], 'a fresh press, not a stale one');
});

test('bindings saved before the pad column keep their keys and gain the default', () => {
  store.set('nf.binds', JSON.stringify({ pass: ['p', 'mouse1'], shoot: ['o', ''] }));
  const binds = loadBindings();
  assert.deepEqual(binds.pass, ['p', 'mouse1', DEFAULT_BINDINGS.pass[2]]);
  assert.deepEqual(binds.shoot, ['o', '', DEFAULT_BINDINGS.shoot[2]]);
  assert.deepEqual(binds.tackle, DEFAULT_BINDINGS.tackle, 'untouched actions stay default');
  store.clear();
});

test('pad buttons print as the letters on the pad', () => {
  assert.equal(keyLabel('pad0'), 'A');
  assert.equal(keyLabel('pad5'), 'RB');
  assert.equal(keyLabel('pad13'), 'Pad ↓');
  assert.equal(keyLabel('mouse0'), 'Left click');
  assert.equal(keyLabel(''), '—');
});
