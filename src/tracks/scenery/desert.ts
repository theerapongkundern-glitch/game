import * as THREE from 'three';
import type { Track } from '../Track';
import type { TrackVisual } from '../TrackBuilder';
import { Rng } from '../../core/rng';
import { Bag, instanced, scatter, vcMat, type Placement, type SceneryResult } from './common';
import { balloonGeometry, cactusGeometry, mesaGeometry, mountainGeometry, rockGeometry } from './props';
import { distantRing } from './distant';
import { stratify } from '../strata';
import { ParticleSystem } from '../../core/Particles';

const BALLOON = ['#ff4fa3', '#ffd23f', '#3db4ff', '#a4e635', '#b44dff', '#ff8a3d', '#3de0ff'];

/** Sunstone Canyon: mesas, cacti, boulders, a natural rock arch and hot-air balloons. */
export function buildDesertScenery(track: Track, visual: TrackVisual, density: number, shadows: boolean): SceneryResult {
  const group = new THREE.Group();
  const bag = new Bag();
  const rng = new Rng(track.def.seed);
  const b = track.bounds;
  const mat = bag.add(vcMat({ flatShading: true }));

  const cactus = bag.add(cactusGeometry());
  group.add(instanced(cactus, mat, scatter(visual, rng, b, Math.floor(220 * density) + 30, { minGap: 3, maxDist: 180, scale: [0.7, 1.4], hug: 0.5 }), { cast: shadows }));

  // Canyon rock: banded sandstone on boulders, mesas and the arch.
  const PALETTE: [string, string, string, string] = ['#c9744a', '#e0935c', '#a4502f', '#f2c48e'];
  const rockMat = bag.add(stratify(new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), PALETTE, 0.5));
  const cliffMat = bag.add(stratify(new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), PALETTE, 0.16));
  const rock = bag.add(rockGeometry('#c9774d'));
  group.add(instanced(rock, rockMat, scatter(visual, rng, b, Math.floor(160 * density) + 20, { minGap: 3, maxDist: 220, scale: [0.8, 4.5] }), { tilt: 0.35, cast: shadows }));

  // Mesas: big layered buttes around the canyon.
  const mesa = bag.add(mesaGeometry());
  const mesaPlaces = scatter(visual, rng, b, 26, { minGap: 30, maxDist: 520, scale: [1, 1] });
  const mesaMesh = instanced(mesa, cliffMat, mesaPlaces);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  mesaPlaces.forEach((mp, i) => {
    const w = rng.range(25, 70);
    s.set(w, rng.range(40, 110), w * rng.range(0.6, 1.3));
    q.setFromEuler(new THREE.Euler(0, mp.rot, 0));
    p.set(mp.x, mp.y - 2, mp.z);
    m.compose(p, q, s);
    mesaMesh.setMatrixAt(i, m);
  });
  mesaMesh.instanceMatrix.needsUpdate = true;
  mesaMesh.computeBoundingSphere();
  group.add(mesaMesh);

  // A natural stone arch spanning the road on the back straight.
  const main = track.main;
  const ai = Math.floor(main.n * 0.52);
  const hw = Math.max(main.limitL[ai], main.limitR[ai]) + 3;
  const arch = new THREE.Mesh(bag.add(new THREE.TorusGeometry(hw, 3.2, 7, 18, Math.PI)), rockMat);
  arch.position.set(main.px[ai], main.py[ai] - 1, main.pz[ai]);
  arch.rotation.y = Math.atan2(main.tx[ai], main.tz[ai]) + Math.PI / 2;
  arch.scale.set(1, 1.35, 1);
  arch.castShadow = shadows;
  group.add(arch);

  group.add(distantRing(bag, b, mountainGeometry(null, '#b8603a', '#d98652'), 24, 1000, [90, 220], [180, 320], rng, mat, -6));

  // Hot-air balloons drifting in the sky.
  const balloon = bag.add(balloonGeometry());
  const balloons: Placement[] = [];
  for (let i = 0; i < 9; i++) {
    balloons.push({ x: rng.range(b.minX, b.maxX), y: rng.range(45, 110), z: rng.range(b.minZ, b.maxZ), rot: rng.range(0, 6.28), scale: rng.range(2, 3.2), dist: 0 });
  }
  const bmesh = instanced(balloon, mat, balloons, { color: (_p, i) => new THREE.Color(BALLOON[i % BALLOON.length]) });
  bmesh.frustumCulled = false;
  group.add(bmesh);

  // --- Tumbleweeds bouncing across the desert on the breeze ---------------------------------
  const wind = new THREE.Vector2(1, 0.35).normalize();
  const weedGeo = bag.add(tumbleweedGeometry());
  const weedMat = bag.add(new THREE.MeshStandardMaterial({ color: '#b08a55', roughness: 1 }));
  const WEEDS = 12;
  const weeds = new THREE.InstancedMesh(weedGeo, weedMat, WEEDS);
  weeds.castShadow = shadows;
  weeds.frustumCulled = false;
  group.add(weeds);
  const weedState: { x: number; z: number; speed: number; r: number; spin: number; ph: number; age: number }[] = [];
  const spawnWeed = (w?: (typeof weedState)[number]) => {
    const k = rng.int(0, main.n - 1);
    const lat = rng.range(-40, 40);
    const st = w ?? { x: 0, z: 0, speed: 0, r: 0, spin: 0, ph: 0, age: 0 };
    st.x = main.px[k] + main.nx[k] * lat - wind.x * 40;
    st.z = main.pz[k] + main.nz[k] * lat - wind.y * 40;
    st.speed = rng.range(3, 6.5);
    st.r = rng.range(0.45, 0.8);
    st.spin = 0;
    st.ph = rng.range(0, 6.28);
    st.age = 0;
    return st;
  };
  for (let i = 0; i < WEEDS; i++) {
    const w = spawnWeed();
    w.age = rng.range(0, 20);
    w.x += wind.x * w.age * w.speed * 0.5;
    w.z += wind.y * w.age * w.speed * 0.5;
    weedState.push(w);
  }
  const rollAxis = new THREE.Vector3(wind.y, 0, -wind.x);

  // --- Dust devils: slow, swirling sand columns out in the flats --------------------------
  const dust = new ParticleSystem(Math.floor(700 * Math.max(0.4, density)), 'soft');
  bag.add(dust);
  group.add(dust.points);
  const devils = scatter(visual, rng, b, 3, { minGap: 25, maxDist: 150, scale: [1, 1] }).map((d) => ({ x: d.x, z: d.z, ox: d.x, oz: d.z, ph: rng.range(0, 6.28) }));
  let dustAcc = 0;

  const dummy = new THREE.Object3D();
  const q2 = new THREE.Quaternion();
  return {
    group,
    update(time, dt) {
      for (let i = 0; i < WEEDS; i++) {
        const w = weedState[i];
        w.age += dt;
        w.x += wind.x * w.speed * dt;
        w.z += wind.y * w.speed * dt;
        w.spin += (w.speed / w.r) * dt;
        if (w.age > 30) spawnWeed(w);
        const ground = visual.terrainHeight(w.x, w.z);
        const hop = Math.abs(Math.sin(time * (w.speed * 0.9) + w.ph)) * 0.7 * Math.min(1, w.speed / 4);
        dummy.position.set(w.x, ground + w.r + hop, w.z);
        q2.setFromAxisAngle(rollAxis, w.spin);
        dummy.quaternion.copy(q2);
        dummy.scale.setScalar(w.r);
        dummy.updateMatrix();
        weeds.setMatrixAt(i, dummy.matrix);
      }
      weeds.instanceMatrix.needsUpdate = true;
      dustAcc += dt;
      while (dustAcc > 1 / 60) {
        dustAcc -= 1 / 60;
        for (const d of devils) {
          const a = dust.random() * Math.PI * 2;
          const h = dust.random();
          const rad = 0.8 + h * 4;
          dust.emit({ x: d.x + Math.cos(a) * rad, y: visual.terrainHeight(d.x, d.z) + 0.3, z: d.z + Math.sin(a) * rad, vx: -Math.sin(a) * 6 + (dust.random() - 0.5), vy: 3 + dust.random() * 5, vz: Math.cos(a) * 6 + (dust.random() - 0.5), life: 2.6, size: 1.5, endSize: 5, r: 0.93, g: 0.74, b: 0.52, alpha: 0.16, drag: 0.5 });
        }
      }
      for (const d of devils) {
        d.x = d.ox + Math.sin(time * 0.07 + d.ph) * 30;
        d.z = d.oz + Math.cos(time * 0.05 + d.ph * 2) * 30;
      }
      dust.update(dt);
      for (let i = 0; i < balloons.length; i++) {
        const bl = balloons[i];
        dummy.position.set(bl.x + Math.sin(time * 0.03 + i) * 40, bl.y + Math.sin(time * 0.4 + i * 2) * 3, bl.z + Math.cos(time * 0.025 + i) * 40);
        dummy.rotation.set(0, bl.rot + time * 0.05, 0);
        dummy.scale.setScalar(bl.scale);
        dummy.updateMatrix();
        bmesh.setMatrixAt(i, dummy.matrix);
      }
      bmesh.instanceMatrix.needsUpdate = true;
    },
    dispose: () => bag.dispose(),
  };
}

/** Tangled ball of thin twigs. */
function tumbleweedGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const g = new THREE.CylinderGeometry(0.025, 0.025, 1.7, 3, 1);
    g.rotateX(rnd() * Math.PI);
    g.rotateY(rnd() * Math.PI * 2);
    g.rotateZ(rnd() * Math.PI);
    g.translate((rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4);
    parts.push(g.toNonIndexed());
    g.dispose();
  }
  const ring = new THREE.TorusGeometry(0.8, 0.03, 3, 12);
  parts.push(ring.toNonIndexed(), ring.clone().rotateY(Math.PI / 2).toNonIndexed(), ring.clone().rotateX(Math.PI / 2).toNonIndexed());
  ring.dispose();
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const P = new Float32Array(total * 3);
  const N = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    P.set(g.attributes.position.array as Float32Array, o * 3);
    N.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  return out;
}
