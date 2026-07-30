/** Tiny math helpers. Plain objects everywhere so state stays snapshot-friendly. */

export interface Vec2 {
  x: number;
  z: number;
}
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const TAU = Math.PI * 2;

export function v2(x = 0, z = 0): Vec2 {
  return { x, z };
}
export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export function len2(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

export function dist2(a: Vec2 | Vec3, b: Vec2 | Vec3): number {
  return len2(a.x - b.x, a.z - b.z);
}

export function dist2Sq(a: Vec2 | Vec3, b: Vec2 | Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function normalize2(x: number, z: number): Vec2 {
  const l = len2(x, z);
  if (l < 1e-6) return { x: 0, z: 0 };
  return { x: x / l, z: z / l };
}

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function approachAngle(from: number, to: number, maxStep: number): number {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

export function headingOf(x: number, z: number): number {
  return Math.atan2(x, z);
}

export function dirFromHeading(h: number): Vec2 {
  return { x: Math.sin(h), z: Math.cos(h) };
}

export function dot2(ax: number, az: number, bx: number, bz: number): number {
  return ax * bx + az * bz;
}

/**
 * Mulberry32 - small, fast, seedable PRNG. The sim keeps its own generator so
 * a match replays identically from the same seed and input log.
 */
export class Rng {
  private s: number;
  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
  get state(): number {
    return this.s;
  }
  set state(v: number) {
    this.s = v >>> 0;
  }
}

/** Signed distance from point p to the infinite line through a in direction d. */
export function pointLineSide(px: number, pz: number, ax: number, az: number, dx: number, dz: number): number {
  return (px - ax) * dz - (pz - az) * dx;
}

/**
 * Closest approach parameter of point p onto segment a->b, clamped to [0,1].
 */
export function projectOnSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-9) return 0;
  return clamp(((px - ax) * dx + (pz - az) * dz) / lenSq, 0, 1);
}
