import * as THREE from 'three';
import type { Track } from '../Track';
import type { TrackVisual } from '../TrackBuilder';
import { Rng } from '../../core/rng';
import { Bag, instanced, scatter, vcMat, type SceneryResult } from './common';
import { cabinGeometry, leafyTreeGeometry, logGeometry, mountainGeometry, mushroomGeometry, pineGeometry, rockGeometry } from './props';
import { distantRing } from './distant';
import { findSpot } from './beach';
import { softDotTexture } from '../textures';

/** Pinecrest Ridge: dense pines, autumn trees, giant mushrooms, a cabin, snowy peaks, fireflies. */
export function buildForestScenery(track: Track, visual: TrackVisual, density: number, shadows: boolean): SceneryResult {
  const group = new THREE.Group();
  const bag = new Bag();
  const rng = new Rng(track.def.seed);
  const b = track.bounds;
  const mat = bag.add(vcMat({ flatShading: true }));
  const water = -5;
  const dry = (_x: number, _z: number, y: number) => y > water + 0.6;

  const pine = bag.add(pineGeometry());
  const pines = scatter(visual, rng, b, Math.floor(900 * density) + 100, { minGap: 2.5, maxDist: 260, scale: [0.8, 1.9], hug: 0.55, accept: dry });
  group.add(instanced(pine, mat, pines, { cast: shadows, scaleY: (p) => p.scale * rng.range(0.9, 1.25) }));

  const leafy = bag.add(leafyTreeGeometry());
  const leafies = scatter(visual, rng, b, Math.floor(220 * density) + 30, { minGap: 3, maxDist: 160, scale: [0.9, 1.5], accept: dry });
  const autumn = ['#f08a3c', '#ffb13d', '#e8683a', '#ffd23f', '#d9534f'].map((c) => new THREE.Color(c));
  group.add(instanced(leafy, mat, leafies, { cast: shadows, color: (_p, i) => (i % 3 === 0 ? autumn[i % autumn.length] : null) }));

  const rock = bag.add(rockGeometry('#8c8f99'));
  group.add(instanced(rock, mat, scatter(visual, rng, b, Math.floor(120 * density), { minGap: 2, maxDist: 200, scale: [0.6, 3] }), { tilt: 0.4 }));

  const mush = bag.add(mushroomGeometry());
  group.add(instanced(mush, mat, scatter(visual, rng, b, 24, { minGap: 2, maxDist: 30, scale: [1, 2.2], accept: dry })));

  const log = bag.add(logGeometry());
  group.add(instanced(log, mat, scatter(visual, rng, b, Math.floor(40 * density), { minGap: 2, maxDist: 60, scale: [0.7, 1.2], accept: dry })));

  const cabin = new THREE.Mesh(bag.add(cabinGeometry()), mat);
  const spot = findSpot(visual, rng, b, 14, 40, () => true);
  cabin.position.set(spot.x, spot.y, spot.z);
  cabin.rotation.y = rng.range(0, 6.28);
  cabin.castShadow = shadows;
  group.add(cabin);

  group.add(distantRing(bag, b, mountainGeometry('#ffffff', '#4a6a8a', '#6a7fa8'), 22, 1000, [220, 420], [200, 360], rng, mat, -10));

  // Fireflies drifting near the road.
  const count = Math.floor(260 * density);
  const geo = bag.add(new THREE.BufferGeometry());
  const pos = new Float32Array(count * 3);
  const base = new Float32Array(count * 3);
  const main = track.main;
  for (let i = 0; i < count; i++) {
    const k = rng.int(0, main.n - 1);
    const side = rng.chance(0.5) ? 1 : -1;
    const lat = (main.limitL[k] + rng.range(1, 20)) * side;
    base[i * 3] = main.px[k] + main.nx[k] * lat;
    base[i * 3 + 1] = main.py[k] + rng.range(0.5, 4);
    base[i * 3 + 2] = main.pz[k] + main.nz[k] * lat;
  }
  pos.set(base);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const fmat = bag.add(
    new THREE.PointsMaterial({ color: new THREE.Color(2.2, 2.0, 0.8), size: 0.45, map: softDotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
  );
  const flies = new THREE.Points(geo, fmat);
  flies.frustumCulled = false;
  group.add(flies);

  return {
    group,
    update(time) {
      for (let i = 0; i < count; i++) {
        const o = i * 1.7;
        pos[i * 3] = base[i * 3] + Math.sin(time * 0.6 + o) * 1.2;
        pos[i * 3 + 1] = base[i * 3 + 1] + Math.sin(time * 0.9 + o * 2) * 0.6;
        pos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(time * 0.5 + o) * 1.2;
      }
      (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      fmat.opacity = 0.6 + Math.sin(time * 3) * 0.2;
    },
    dispose: () => bag.dispose(),
  };
}
