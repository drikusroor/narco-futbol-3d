import * as THREE from 'three';
import type { DrillMarker } from '@shared/types.js';

/**
 * Cones and chalk circles for the training drills. Rebuilt whenever the server
 * sends a new set, which is only when a rep changes, so this can be simple.
 */
export class DrillMarkers {
  private group = new THREE.Group();
  private live: { marker: DrillMarker; node: THREE.Object3D }[] = [];
  private coneGeo = new THREE.ConeGeometry(0.28, 0.62, 8);
  private ringGeo = new THREE.RingGeometry(0.86, 1, 40);
  private signature = '';

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** Replace the markers on the pitch, skipping the rebuild if nothing moved. */
  set(markers: DrillMarker[]): void {
    const sig = markers.map((m) => `${m.id}:${m.kind}:${m.x.toFixed(1)}:${m.z.toFixed(1)}:${m.active}`).join('|');
    if (sig === this.signature) return;
    this.signature = sig;
    this.group.clear();
    this.live = [];
    for (const m of markers) this.live.push({ marker: m, node: this.build(m) });
  }

  clear(): void {
    this.signature = '';
    this.group.clear();
    this.live = [];
  }

  /** Built around the origin and moved into place, so it can pulse in one piece. */
  private build(m: DrillMarker): THREE.Object3D {
    const colour = m.active ? 0xffd34d : 0x8a6a4a;
    const node = new THREE.Group();
    node.position.set(m.x, 0, m.z);
    if (m.kind === 'gate') {
      const mat = new THREE.MeshLambertMaterial({ color: m.active ? 0xff7a2f : 0x7a4a2a });
      for (const side of [-1, 1]) {
        const cone = new THREE.Mesh(this.coneGeo, mat);
        cone.position.set(0, 0.31, side * m.r);
        node.add(cone);
      }
    } else {
      const ring = new THREE.Mesh(
        this.ringGeo,
        new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      ring.scale.setScalar(m.r);
      node.add(ring);

      if (m.kind === 'target') {
        const disc = new THREE.Mesh(
          new THREE.CircleGeometry(m.r * 0.94, 32),
          new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.14 }),
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = 0.02;
        node.add(disc);
      }
    }
    this.group.add(node);
    return node;
  }

  /** Breathe the active markers so the eye finds them. */
  update(time: number): void {
    for (const { marker, node } of this.live) {
      if (!marker.active) continue;
      const pulse = 1 + Math.sin(time * 4) * 0.07;
      node.scale.setScalar(pulse);
    }
  }
}
