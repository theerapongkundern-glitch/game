import * as THREE from 'three';
import type { TrackVisual } from '../TrackBuilder';
import type { Rng } from '../../core/rng';

export interface Placement {
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  /** Distance from the track centre line. */
  dist: number;
}

export interface ScatterOpts {
  /** Minimum clearance beyond the barrier (m). */
  minGap: number;
  /** Maximum distance from the track centre (m). */
  maxDist: number;
  scale: [number, number];
  /** Optional extra acceptance test. */
  accept?: (x: number, z: number, y: number, dist: number) => boolean;
  /** Placement bias: 0 = uniform in the band, 1 = hug the track. */
  hug?: number;
}

/** Scatters objects around the track (outside the barriers) using rejection sampling. */
export function scatter(visual: TrackVisual, rng: Rng, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, count: number, o: ScatterOpts): Placement[] {
  const out: Placement[] = [];
  const pad = o.maxDist;
  let tries = 0;
  while (out.length < count && tries < count * 40) {
    tries++;
    const x = rng.range(bounds.minX - pad, bounds.maxX + pad);
    const z = rng.range(bounds.minZ - pad, bounds.maxZ + pad);
    const d = visual.distanceToTrack(x, z);
    if (d.dist < d.limit + o.minGap || d.dist > o.maxDist) continue;
    if (o.hug && rng.next() < o.hug * Math.min(1, (d.dist - d.limit) / (o.maxDist - d.limit))) continue;
    if (excluded(visual, x, z)) continue;
    const y = visual.terrainHeight(x, z);
    if (o.accept && !o.accept(x, z, y, d.dist)) continue;
    out.push({ x, y, z, rot: rng.range(0, Math.PI * 2), scale: rng.range(o.scale[0], o.scale[1]), dist: d.dist });
  }
  return out;
}

export function excluded(visual: TrackVisual, x: number, z: number): boolean {
  for (const e of visual.exclusions) if ((x - e.x) ** 2 + (z - e.z) ** 2 < e.r * e.r) return true;
  return false;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

/** Builds an InstancedMesh from placements; `yOffset` is in unscaled units. */
export function instanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  places: Placement[],
  opts: { cast?: boolean; receive?: boolean; yOffset?: number; tilt?: number; scaleY?: (p: Placement) => number; color?: (p: Placement, i: number) => THREE.Color | null } = {},
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, places.length));
  mesh.count = places.length;
  for (let i = 0; i < places.length; i++) {
    const p = places[i];
    _e.set(opts.tilt ? Math.sin(p.rot * 3) * opts.tilt : 0, p.rot, opts.tilt ? Math.cos(p.rot * 5) * opts.tilt : 0);
    _q.setFromEuler(_e);
    const sy = opts.scaleY ? opts.scaleY(p) : p.scale;
    _s.set(p.scale, sy, p.scale);
    _p.set(p.x, p.y + (opts.yOffset ?? 0) * sy, p.z);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
    if (opts.color) {
      const c = opts.color(p, i);
      if (c) mesh.setColorAt(i, c);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = opts.cast ?? false;
  mesh.receiveShadow = opts.receive ?? false;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Merges several geometries (with per-part vertex colours) into one. */
export function coloredMerge(parts: { geo: THREE.BufferGeometry; color: string }[]): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const c = new THREE.Color(part.color);
    const n = g.attributes.position.count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geos.push(g);
  }
  // Manual merge (all non-indexed, same attributes).
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    col.set(g.attributes.color.array as Float32Array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

export function translate(g: THREE.BufferGeometry, x: number, y: number, z: number) {
  g.translate(x, y, z);
  return g;
}

export interface SceneryResult {
  group: THREE.Group;
  update(time: number, dt: number, focus?: THREE.Vector3): void;
  dispose(): void;
}

/** Tracks geometries/materials so a scenery set can be disposed in one go. */
export class Bag {
  private items: { dispose(): void }[] = [];
  add<T extends { dispose(): void }>(x: T): T {
    this.items.push(x);
    return x;
  }
  dispose() {
    for (const i of this.items) i.dispose();
    this.items = [];
  }
}

export function vcMat(opts: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, ...opts });
}
