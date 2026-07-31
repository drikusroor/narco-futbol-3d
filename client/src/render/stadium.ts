import * as THREE from 'three';
import {
  GOAL_DEPTH,
  GOAL_HALF_WIDTH,
  GOAL_HEIGHT,
  HALF_LENGTH,
  HALF_WIDTH,
  PITCH_LENGTH,
  PITCH_WIDTH,
  POST_RADIUS,
  TEAM_INFO,
} from '@shared/constants.js';
import { adBoardTexture, bannerTexture, netTexture, pitchTexture } from './textures.js';

/**
 * The ground: pitch, hoardings, goals, terraces packed with a swaying crowd,
 * floodlights and the hills behind. All boxes and cylinders, all procedural.
 */
export function buildStadium(scene: THREE.Scene): { crowd: THREE.InstancedMesh[]; update(t: number): void } {
  const group = new THREE.Group();
  scene.add(group);

  // --- turf ------------------------------------------------------------------
  const turf = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH_LENGTH, PITCH_WIDTH),
    new THREE.MeshLambertMaterial({ map: pitchTexture() }),
  );
  turf.rotation.x = -Math.PI / 2;
  turf.receiveShadow = true;
  group.add(turf);

  // Surrounding apron of darker grass and running track.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH_LENGTH + 26, PITCH_WIDTH + 26),
    new THREE.MeshLambertMaterial({ color: 0x2c5426 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.05;
  group.add(apron);

  // --- hoardings -------------------------------------------------------------
  const adTex = adBoardTexture();
  const boardMat = new THREE.MeshLambertMaterial({ map: adTex });
  const boardH = 1.5;

  const longBoard = new THREE.PlaneGeometry(PITCH_LENGTH, boardH);
  for (const sign of [-1, 1]) {
    const m = new THREE.Mesh(longBoard, boardMat.clone());
    (m.material as THREE.MeshLambertMaterial).map = adTex.clone();
    (m.material as THREE.MeshLambertMaterial).map!.repeat.set(3, 1);
    (m.material as THREE.MeshLambertMaterial).map!.needsUpdate = true;
    m.position.set(0, boardH / 2, sign * (HALF_WIDTH + 0.4));
    m.rotation.y = sign > 0 ? Math.PI : 0;
    group.add(m);
  }
  const shortBoard = new THREE.PlaneGeometry(PITCH_WIDTH, boardH);
  for (const sign of [-1, 1]) {
    const m = new THREE.Mesh(shortBoard, boardMat.clone());
    (m.material as THREE.MeshLambertMaterial).map = adTex.clone();
    (m.material as THREE.MeshLambertMaterial).map!.repeat.set(2, 1);
    (m.material as THREE.MeshLambertMaterial).map!.needsUpdate = true;
    m.position.set(sign * (HALF_LENGTH + GOAL_DEPTH + 1.5), boardH / 2, 0);
    m.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(m);
  }

  // --- goals -----------------------------------------------------------------
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf3f0e6, roughness: 0.6, metalness: 0.1 });
  const netMat = new THREE.MeshLambertMaterial({
    map: netTexture(),
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  for (const sign of [-1, 1]) {
    const goal = new THREE.Group();
    goal.position.x = sign * HALF_LENGTH;
    const postGeo = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, GOAL_HEIGHT, 10);
    for (const zs of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, frameMat);
      post.position.set(0, GOAL_HEIGHT / 2, zs * GOAL_HALF_WIDTH);
      post.castShadow = true;
      goal.add(post);
    }
    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, GOAL_HALF_WIDTH * 2, 10),
      frameMat,
    );
    bar.rotation.x = Math.PI / 2;
    bar.position.y = GOAL_HEIGHT;
    bar.castShadow = true;
    goal.add(bar);

    // Netting: back, sides and roof.
    const back = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, GOAL_HEIGHT), netMat);
    back.position.set(sign * GOAL_DEPTH, GOAL_HEIGHT / 2, 0);
    back.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
    goal.add(back);
    for (const zs of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_DEPTH, GOAL_HEIGHT), netMat);
      side.position.set((sign * GOAL_DEPTH) / 2, GOAL_HEIGHT / 2, zs * GOAL_HALF_WIDTH);
      goal.add(side);
    }
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_DEPTH, GOAL_HALF_WIDTH * 2), netMat);
    roof.rotation.x = Math.PI / 2;
    roof.position.set((sign * GOAL_DEPTH) / 2, GOAL_HEIGHT, 0);
    goal.add(roof);

    group.add(goal);
  }

  // --- terraces --------------------------------------------------------------
  const crowdMeshes: THREE.InstancedMesh[] = [];
  const standMat = new THREE.MeshLambertMaterial({ color: 0x3a2b26 });
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x5a3b2e });

  const buildStand = (
    length: number,
    rows: number,
    position: THREE.Vector3,
    rotationY: number,
  ): void => {
    const stand = new THREE.Group();
    stand.position.copy(position);
    stand.rotation.y = rotationY;

    const rowDepth = 1.5;
    const rowRise = 0.85;
    for (let r = 0; r < rows; r++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(length, rowRise, rowDepth), standMat);
      step.position.set(0, r * rowRise + rowRise / 2, r * rowDepth);
      step.receiveShadow = true;
      stand.add(step);
    }
    // Front wall so you cannot see under the terrace.
    const front = new THREE.Mesh(new THREE.BoxGeometry(length, 2.2, 0.6), wallMat);
    front.position.set(0, 1.1, -0.5);
    stand.add(front);

    // Crowd: one instanced box per head, coloured at random, swaying in the
    // vertex shader so thousands of them cost nothing.
    const perRow = Math.floor(length / 0.95);
    const count = perRow * rows;
    const geo = new THREE.BoxGeometry(0.55, 1.1, 0.45);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const colour = new THREE.Color();
    const m4 = new THREE.Matrix4();
    const phases = new Float32Array(count);
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let s = 0; s < perRow; s++) {
        const x = -length / 2 + 0.5 + s * 0.95 + (Math.random() - 0.5) * 0.25;
        const y = r * rowRise + rowRise + 0.55;
        const z = r * rowDepth + (Math.random() - 0.5) * 0.3;
        m4.makeTranslation(x, y, z);
        inst.setMatrixAt(i, m4);
        const pick = Math.random();
        if (pick < 0.34) colour.setHex(TEAM_INFO[0].primary);
        else if (pick < 0.68) colour.setHex(TEAM_INFO[1].primary);
        else colour.setHSL(Math.random(), 0.35, 0.35 + Math.random() * 0.3);
        colour.multiplyScalar(0.55 + Math.random() * 0.5);
        inst.setColorAt(i, colour);
        phases[i] = Math.random() * Math.PI * 2;
        i++;
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.userData.phases = phases;

    // Sway + jump, driven by two uniforms the game updates every frame.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uHype = { value: 0 };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           uniform float uHype;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float seed = instanceMatrix[3].x * 3.7 + instanceMatrix[3].z * 11.3;
           float sway = sin(uTime * 2.2 + seed) * 0.12;
           float jump = max(0.0, sin(uTime * 7.0 + seed)) * uHype * 0.55;
           transformed.x += sway;
           transformed.y += jump;`,
        );
      mat.userData.shader = shader;
    };
    stand.add(inst);
    crowdMeshes.push(inst);
    group.add(stand);
  };

  // A stand is built facing its own local -Z, so each one is turned until that
  // points back at the centre circle - otherwise the crowd watches the car park.
  const standGap = 4.5;
  buildStand(PITCH_LENGTH + 12, 12, new THREE.Vector3(0, 0, HALF_WIDTH + standGap), 0);
  buildStand(PITCH_LENGTH + 12, 12, new THREE.Vector3(0, 0, -HALF_WIDTH - standGap), Math.PI);
  buildStand(PITCH_WIDTH + 8, 9, new THREE.Vector3(HALF_LENGTH + standGap + GOAL_DEPTH, 0, 0), Math.PI / 2);
  buildStand(PITCH_WIDTH + 8, 9, new THREE.Vector3(-HALF_LENGTH - standGap - GOAL_DEPTH, 0, 0), -Math.PI / 2);

  // --- banners in the stands --------------------------------------------------
  const banners: [string, string, string, number, number][] = [
    ['LOS DEL SUR', '#8a1f14', '#ffd34d', -22, 1],
    ['BARRIO BRAVO', '#123a22', '#f0f0e0', 18, 1],
    ['AGUANTE EL BARRIO', '#1b2b6b', '#ffd34d', -6, -1],
    ['1988', '#2a1410', '#ff8a2f', 26, -1],
  ];
  for (const [text, bg, fg, x, side] of banners) {
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 2.2),
      new THREE.MeshBasicMaterial({ map: bannerTexture(text, bg, fg), side: THREE.DoubleSide }),
    );
    banner.position.set(x, 4.5, side * (HALF_WIDTH + standGap + 1.2));
    banner.rotation.y = side > 0 ? Math.PI : 0;
    banner.rotation.x = -0.12;
    group.add(banner);
  }

  // --- floodlights ------------------------------------------------------------
  const pylonMat = new THREE.MeshLambertMaterial({ color: 0x2a2320 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3d0 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 30, 6), pylonMat);
      mast.position.set(sx * (HALF_LENGTH + 14), 15, sz * (HALF_WIDTH + 16));
      group.add(mast);
      const rig = new THREE.Mesh(new THREE.BoxGeometry(7, 3.4, 1), pylonMat);
      rig.position.set(mast.position.x, 30, mast.position.z);
      rig.lookAt(0, 0, 0);
      group.add(rig);
      for (let i = 0; i < 6; i++) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 0.3), lampMat);
        lamp.position.set(
          mast.position.x + (i % 3) * 2 - 2,
          29 + Math.floor(i / 3) * 1.5,
          mast.position.z * 0.97,
        );
        lamp.lookAt(0, 0, 0);
        group.add(lamp);
      }
    }
  }

  // --- hills and haze behind the ground ---------------------------------------
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x2b2016 });
  for (let i = 0; i < 14; i++) {
    const r = 90 + Math.random() * 40;
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.2;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(24 + Math.random() * 22, 16 + Math.random() * 22, 5), hillMat);
    hill.position.set(Math.cos(a) * r, -2, Math.sin(a) * r * 0.8);
    hill.rotation.y = Math.random() * Math.PI;
    group.add(hill);
  }

  // Shanties on the hillsides - tiny lit boxes, the city looking in.
  const shackGeo = new THREE.BoxGeometry(2.4, 2, 2.4);
  const shackMat = new THREE.MeshLambertMaterial({ color: 0x6b4a33 });
  const shacks = new THREE.InstancedMesh(shackGeo, shackMat, 120);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  for (let i = 0; i < 120; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 78 + Math.random() * 55;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r * 0.85;
    const y = 2 + Math.random() * 12;
    m.makeTranslation(x, y, z);
    shacks.setMatrixAt(i, m);
    col.setHSL(0.07 + Math.random() * 0.08, 0.4, 0.25 + Math.random() * 0.25);
    shacks.setColorAt(i, col);
  }
  shacks.instanceMatrix.needsUpdate = true;
  group.add(shacks);

  return {
    crowd: crowdMeshes,
    update(t: number) {
      for (const inst of crowdMeshes) {
        const shader = (inst.material as THREE.MeshLambertMaterial).userData.shader;
        if (shader) {
          shader.uniforms.uTime.value = t;
          shader.uniforms.uHype.value = hype;
        }
      }
    },
  };
}

/** 0..1 excitement level; the crowd jumps when it is high. */
let hype = 0;
export function setCrowdHype(v: number): void {
  hype = Math.max(0, Math.min(1, v));
}
export function decayCrowdHype(dt: number): void {
  hype = Math.max(0, hype - dt * 0.55);
}
