import * as THREE from 'three';
import type { Track } from '../Track';
import type { TrackVisual } from '../TrackBuilder';
import { Rng } from '../../core/rng';
import { Bag, instanced, scatter, vcMat, type Placement, type SceneryResult } from './common';
import { hutGeometry, lighthouseGeometry, mountainGeometry, palmGeometry, rockGeometry, sailboatGeometry, umbrellaGeometry } from './props';
import { distantRing } from './distant';

const BRIGHT = ['#ff5a36', '#ffd23f', '#3db4ff', '#ff4fa3', '#2ec27e', '#b44dff', '#ff8a3d'];

/** Coconut Coast: palms, beach huts, umbrellas, a lighthouse, sailboats and islands. */
export function buildBeachScenery(track: Track, visual: TrackVisual, density: number, shadows: boolean): SceneryResult {
  const group = new THREE.Group();
  const bag = new Bag();
  const rng = new Rng(track.def.seed);
  const b = track.bounds;
  const mat = bag.add(vcMat({ flatShading: true }));
  const matDS = bag.add(vcMat({ flatShading: true, side: THREE.DoubleSide }));
  const water = -1.6;
  const dry = (_x: number, _z: number, y: number) => y > water + 0.5;

  const palm = bag.add(palmGeometry());
  const palms = scatter(visual, rng, b, Math.floor(420 * density), { minGap: 2, maxDist: 150, scale: [0.8, 1.35], hug: 0.75, accept: dry });
  group.add(instanced(palm, matDS, palms, { cast: shadows }));

  const hut = bag.add(hutGeometry());
  const huts = scatter(visual, rng, b, 18, { minGap: 6, maxDist: 60, scale: [0.9, 1.2], accept: dry });
  const hutCols = huts.map(() => new THREE.Color(rng.pick(BRIGHT)));
  group.add(instanced(hut, mat, huts, { cast: shadows, color: (_p, i) => hutCols[i] }));

  const umb = bag.add(umbrellaGeometry());
  const umbs = scatter(visual, rng, b, Math.floor(60 * density), { minGap: 3, maxDist: 70, scale: [0.9, 1.1], accept: (x, z, y) => dry(x, z, y) && y < water + 3 });
  group.add(instanced(umb, matDS, umbs, { color: () => new THREE.Color(rng.pick(BRIGHT)) }));

  const rock = bag.add(rockGeometry('#b9a58e'));
  const rocks = scatter(visual, rng, b, Math.floor(70 * density), { minGap: 3, maxDist: 220, scale: [0.8, 3.2] });
  group.add(instanced(rock, mat, rocks, { tilt: 0.3 }));

  // Lighthouse near the western hairpin.
  const lh = bag.add(lighthouseGeometry());
  const lighthouse = new THREE.Mesh(lh, mat);
  const lhSpot = findSpot(visual, rng, b, 20, 60, (x, z) => x < b.minX + (b.maxX - b.minX) * 0.3 && z > (b.minZ + b.maxZ) / 2);
  lighthouse.position.set(lhSpot.x, lhSpot.y, lhSpot.z);
  lighthouse.castShadow = shadows;
  group.add(lighthouse);

  // Sailboats bobbing on the sea.
  const boat = bag.add(sailboatGeometry());
  const boats: Placement[] = [];
  for (let i = 0; i < 12; i++) {
    const x = rng.range(b.minX - 200, b.maxX + 200);
    const z = b.minZ - rng.range(90, 420);
    boats.push({ x, y: water, z, rot: rng.range(0, Math.PI * 2), scale: rng.range(1.2, 2), dist: 0 });
  }
  const boatMesh = instanced(boat, matDS, boats, { color: () => new THREE.Color(rng.pick(BRIGHT)) });
  group.add(boatMesh);

  // Distant islands on the horizon.
  group.add(distantRing(bag, b, mountainGeometry(null, '#f3d9a0', '#3fbf5a'), 16, 900, [35, 80], [110, 240], rng, mat, water - 1));

  const dummy = new THREE.Object3D();
  return {
    group,
    update(time) {
      for (let i = 0; i < boats.length; i++) {
        const bt = boats[i];
        dummy.position.set(bt.x + Math.sin(time * 0.05 + i) * 20, water + Math.sin(time * 1.3 + i) * 0.25, bt.z);
        dummy.rotation.set(Math.sin(time * 1.1 + i) * 0.06, bt.rot + time * 0.01, Math.cos(time * 0.9 + i) * 0.08);
        dummy.scale.setScalar(bt.scale);
        dummy.updateMatrix();
        boatMesh.setMatrixAt(i, dummy.matrix);
      }
      boatMesh.instanceMatrix.needsUpdate = true;
    },
    dispose: () => bag.dispose(),
  };
}

export function findSpot(
  visual: TrackVisual,
  rng: Rng,
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
  minGap: number,
  maxGap: number,
  pred: (x: number, z: number) => boolean,
): { x: number; y: number; z: number } {
  for (let i = 0; i < 4000; i++) {
    const x = rng.range(b.minX - 60, b.maxX + 60);
    const z = rng.range(b.minZ - 60, b.maxZ + 60);
    const d = visual.distanceToTrack(x, z);
    if (d.dist < d.limit + minGap || d.dist > d.limit + maxGap) continue;
    if (!pred(x, z)) continue;
    return { x, y: visual.terrainHeight(x, z), z };
  }
  return { x: b.minX - 40, y: 0, z: b.minZ - 40 };
}
