import * as THREE from 'three';

/**
 * Cheap particle bursts: one pooled points cloud for everything. Turf sprays,
 * kick puffs, confetti on goals.
 */
const MAX_PARTICLES = 900;

interface Particle {
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  size: number;
}

export class Effects {
  private points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private pool: Particle[] = [];
  private next = 0;
  private tmp = new THREE.Color();
  /** Screen shake amount, read by the camera each frame. */
  shake = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.sizes = new Float32Array(MAX_PARTICLES);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    const mat = new THREE.PointsMaterial({
      size: 0.28,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push({ life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, gravity: 12, size: 1 });
      this.positions[i * 3 + 1] = -50; // park unused particles under the pitch
    }
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    colour: number,
    life: number,
    gravity = 12,
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PARTICLES;
    const p = this.pool[i];
    p.life = life;
    p.maxLife = life;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.gravity = gravity;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.tmp.setHex(colour);
    this.colors[i * 3] = this.tmp.r;
    this.colors[i * 3 + 1] = this.tmp.g;
    this.colors[i * 3 + 2] = this.tmp.b;
  }

  /** Turf kicked up by a boot or a slide. */
  turf(x: number, z: number, amount = 10, colour = 0x4c7a38): void {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 3.5;
      this.spawn(
        x + Math.cos(a) * 0.3,
        0.12,
        z + Math.sin(a) * 0.3,
        Math.cos(a) * s,
        1.6 + Math.random() * 2.6,
        Math.sin(a) * s,
        colour,
        0.4 + Math.random() * 0.35,
      );
    }
  }

  /** Dust ring where the ball smacks the ground. */
  dust(x: number, y: number, z: number, power: number): void {
    const n = Math.min(14, 3 + Math.round(power));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.7 + Math.random() * power * 0.22;
      this.spawn(x, y, z, Math.cos(a) * s, Math.random() * 1.2, Math.sin(a) * s, 0xa08b62, 0.35, 6);
    }
  }

  /** Goal celebration: confetti and ticker tape in the scoring team's colours. */
  confetti(x: number, z: number, colour: number, second: number): void {
    for (let i = 0; i < 220; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 9;
      this.spawn(
        x + (Math.random() - 0.5) * 10,
        2 + Math.random() * 9,
        z + (Math.random() - 0.5) * 10,
        Math.cos(a) * s * 0.35,
        4 + Math.random() * 7,
        Math.sin(a) * s * 0.35,
        Math.random() < 0.5 ? colour : second,
        2.2 + Math.random() * 1.6,
        5.5,
      );
    }
    this.shake = Math.min(1, this.shake + 0.7);
  }

  /** Sparks off the woodwork. */
  sparks(x: number, z: number): void {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(
        x,
        1.6 + Math.random(),
        z,
        Math.cos(a) * 4,
        2 + Math.random() * 3,
        Math.sin(a) * 4,
        0xffd97a,
        0.4,
        14,
      );
    }
    this.shake = Math.min(1, this.shake + 0.25);
  }

  update(dt: number): void {
    const pos = this.positions;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.pool[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        pos[i * 3 + 1] = -50;
        continue;
      }
      p.vy -= p.gravity * dt;
      pos[i * 3] += p.vx * dt;
      pos[i * 3 + 1] += p.vy * dt;
      pos[i * 3 + 2] += p.vz * dt;
      if (pos[i * 3 + 1] < 0.05) {
        pos[i * 3 + 1] = 0.05;
        p.vy *= -0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      // Fade by shrinking toward the ground rather than per-particle alpha.
      const k = p.life / p.maxLife;
      this.colors[i * 3] *= 0.999;
      this.sizes[i] = k;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.shake = Math.max(0, this.shake - dt * 1.6);
  }
}

/** Fading streak behind a struck ball. */
export class BallTrail {
  private line: THREE.Line;
  private positions: Float32Array;
  private count = 0;
  private readonly max = 24;

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(this.max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setDrawRange(0, 0);
    this.line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.35 }),
    );
    this.line.frustumCulled = false;
    scene.add(this.line);
  }

  update(x: number, y: number, z: number, speed: number): void {
    const visible = speed > 13;
    this.line.visible = visible;
    if (!visible) {
      this.count = 0;
      this.line.geometry.setDrawRange(0, 0);
      return;
    }
    // Shift the buffer back one point and push the new head on.
    for (let i = Math.min(this.count, this.max - 1); i > 0; i--) {
      this.positions[i * 3] = this.positions[(i - 1) * 3];
      this.positions[i * 3 + 1] = this.positions[(i - 1) * 3 + 1];
      this.positions[i * 3 + 2] = this.positions[(i - 1) * 3 + 2];
    }
    this.positions[0] = x;
    this.positions[1] = y;
    this.positions[2] = z;
    this.count = Math.min(this.count + 1, this.max);
    this.line.geometry.setDrawRange(0, this.count);
    (this.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.line.material as THREE.LineBasicMaterial).opacity = Math.min(0.5, (speed - 13) / 40);
  }
}
