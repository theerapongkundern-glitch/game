import * as THREE from 'three';
import type { Track } from '../Track';
import type { TrackVisual } from '../TrackBuilder';
import { Rng } from '../../core/rng';
import { Bag, instanced, scatter, vcMat, type Placement, type SceneryResult } from './common';
import { balloonGeometry, cactusGeometry, mesaGeometry, mountainGeometry, rockGeometry } from './props';
import { distantRing } from './distant';

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

  const rock = bag.add(rockGeometry('#c9774d'));
  group.add(instanced(rock, mat, scatter(visual, rng, b, Math.floor(160 * density) + 20, { minGap: 3, maxDist: 220, scale: [0.8, 4.5] }), { tilt: 0.35, cast: shadows }));

  // Mesas: big layered buttes around the canyon.
  const mesa = bag.add(mesaGeometry());
  const mesaPlaces = scatter(visual, rng, b, 26, { minGap: 30, maxDist: 520, scale: [1, 1] });
  const mesaMesh = instanced(mesa, mat, mesaPlaces);
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
  const arch = new THREE.Mesh(bag.add(new THREE.TorusGeometry(hw, 3.2, 7, 18, Math.PI)), bag.add(new THREE.MeshStandardMaterial({ color: '#c46a3f', roughness: 1, flatShading: true })));
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

  const dummy = new THREE.Object3D();
  return {
    group,
    update(time) {
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
