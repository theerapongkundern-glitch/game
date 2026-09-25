import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { Bag, instanced, type Placement } from './common';

/** A ring of large backdrop shapes (mountains, islands, skyline) around the whole track. */
export function distantRing(
  bag: Bag,
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
  geo: THREE.BufferGeometry,
  count: number,
  radius: number,
  height: [number, number],
  width: [number, number],
  rng: Rng,
  mat: THREE.Material,
  baseY = -2,
): THREE.InstancedMesh {
  bag.add(geo);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const r0 = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + radius * 0.5;
  const places: Placement[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.range(-0.1, 0.1);
    const r = r0 + rng.range(0, radius * 0.5);
    places.push({ x: cx + Math.cos(a) * r, y: baseY, z: cz + Math.sin(a) * r, rot: rng.range(0, 6.28), scale: 1, dist: r });
  }
  const mesh = instanced(geo, mat, places, {});
  // Non-uniform scale per instance (wide and tall).
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  places.forEach((pl, i) => {
    const w = rng.range(width[0], width[1]);
    const h = rng.range(height[0], height[1]);
    q.setFromEuler(new THREE.Euler(0, pl.rot, 0));
    s.set(w, h, w * rng.range(0.7, 1.2));
    p.set(pl.x, pl.y, pl.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.frustumCulled = false;
  return mesh;
}
