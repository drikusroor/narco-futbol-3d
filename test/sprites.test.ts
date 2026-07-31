import assert from 'node:assert/strict';
import test from 'node:test';

import { PlayerAct } from '@shared/types.js';
import { RUN_SPEED } from '@shared/constants.js';

/**
 * The sprite sheets are baked on a GPU, which node has not got. What node can
 * check is the bookkeeping either side of the bake: which still a given state
 * asks for, and that every clip lands inside the sheet it says it does.
 */

Object.defineProperty(globalThis, 'performance', {
  value: { now: () => 0 },
  configurable: true,
  writable: true,
});

const { CLIPS, frameFor } = await import('../client/src/render/sprites.js');

/** The manifest bakeAtlas would produce, without needing a GPU to produce it. */
function manifest(azimuths = 16, elevations = [0.35, 0.6, 0.87]) {
  const clips: Record<string, { row: number; frames: number }> = {};
  let totalFrames = 0;
  for (const clip of CLIPS) {
    clips[clip.name] = { row: totalFrames, frames: clip.frames };
    totalFrames += clip.frames;
  }
  const columns = azimuths / 2 + 1;
  return {
    tile: 64,
    azimuths,
    columns,
    elevations,
    clips,
    totalFrames,
    width: 64 * columns,
    height: 64 * totalFrames * elevations.length,
    worldSize: 2.6,
    centreY: 1.15,
  };
}

test('every clip fits inside the sheet, back to back and in order', () => {
  const m = manifest();
  let expected = 0;
  for (const clip of CLIPS) {
    assert.equal(m.clips[clip.name].row, expected, `${clip.name} starts where the last one ended`);
    expected += clip.frames;
  }
  assert.equal(expected, m.totalFrames);
  // The last row of the last frame at the deepest elevation must still be on it.
  const lastRow = (m.totalFrames - 1) * m.elevations.length + (m.elevations.length - 1);
  assert.equal((lastRow + 1) * m.tile, m.height);
});

test('standing still asks for the idle still, running asks for the run cycle', () => {
  const m = manifest();
  assert.equal(frameFor(m, PlayerAct.Run, 0, 0, 0), m.clips.idle.row, 'a stopped player idles');

  const run = m.clips.run;
  const seen = new Set<number>();
  for (let i = 0; i < run.frames; i++) {
    const phase = ((i + 0.5) / run.frames) * Math.PI * 2;
    const frame = frameFor(m, PlayerAct.Run, 0, RUN_SPEED, phase);
    assert.ok(frame >= run.row && frame < run.row + run.frames, `frame ${frame} is in the run clip`);
    seen.add(frame);
  }
  assert.equal(seen.size, run.frames, 'the whole cycle is used, not just some of it');
});

test('the stride phase wraps rather than running off the end of the clip', () => {
  const m = manifest();
  const run = m.clips.run;
  // Stride accumulates for as long as a player is on the pitch.
  for (const phase of [-31.4, -0.2, 0, 6.28, 400]) {
    const frame = frameFor(m, PlayerAct.Run, 0, RUN_SPEED, phase);
    assert.ok(frame >= run.row && frame < run.row + run.frames, `phase ${phase} gave ${frame}`);
  }
});

test('a kick plays through its frames as the timer runs down', () => {
  const m = manifest();
  const kick = m.clips.kick;
  const first = frameFor(m, PlayerAct.Kick, 0.22, 0, 0);
  const last = frameFor(m, PlayerAct.Kick, 0, 0, 0);
  assert.equal(first, kick.row, 'the wind-up is the first frame');
  assert.equal(last, kick.row + kick.frames - 1, 'the follow-through is the last');
  assert.ok(first < last);
});

test('every action has a still of its own', () => {
  const m = manifest();
  const acts = [
    PlayerAct.Slide,
    PlayerAct.Dive,
    PlayerAct.Stunned,
    PlayerAct.Tackle,
    PlayerAct.Celebrate,
  ];
  const frames = acts.map((a) => frameFor(m, a, 0, 0, 0));
  assert.equal(new Set(frames).size, acts.length, 'and they are not all the same still');
  for (const f of frames) assert.ok(f >= 0 && f < m.totalFrames);
});

test('mirroring halves the sheet without losing a facing', () => {
  const m = manifest(16);
  assert.equal(m.columns, 9, 'nine renders cover sixteen headings');
  const covered = new Set<string>();
  for (let heading = 0; heading < m.azimuths; heading++) {
    const mirror = heading >= m.columns;
    const col = mirror ? m.azimuths - heading : heading;
    assert.ok(col >= 0 && col < m.columns, `heading ${heading} lands on column ${col}`);
    // Straight at the camera and straight away are their own mirror image, and
    // must come off the sheet unflipped or they would be flipped for nothing.
    if (heading === 0 || heading === m.azimuths / 2) assert.ok(!mirror, `heading ${heading}`);
    covered.add(`${col}:${mirror}`);
  }
  assert.equal(covered.size, m.azimuths, 'each heading gets its own column-and-flip');
});
