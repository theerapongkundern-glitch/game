import * as THREE from 'three';
import { SAMPLE_SPACING, type Track, type TrackPath } from './Track';
import { THEMES, type ThemeStyle } from './themes';
import {
  bannerTexture,
  checkerTexture,
  chevronTexture,
  noiseTexture,
  roadTexture,
  stripeTexture,
} from './textures';
import { fbm2 } from '../core/rng';
import { clamp, smoothstep } from '../core/math';
import type { SurfaceType } from './Surfaces';

/** Accumulates a triangle-strip style ribbon into indexed BufferGeometry. */
class GeoBuilder {
  pos: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  col: number[] | null = null;

  get count() {
    return this.pos.length / 3;
  }

  vert(x: number, y: number, z: number, u: number, v: number) {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    return this.count - 1;
  }

  quad(a: number, b: number, c: number, d: number) {
    // a-b is the previous row, c-d the next row.
    this.idx.push(a, c, b, b, c, d);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

type LatFn = (i: number) => number;

interface RibbonOpts {
  i0: number;
  count: number;
  lat0: LatFn;
  lat1: LatFn;
  y: number;
  cols: number;
  /** UV: 'unit' maps u 0..1 across; otherwise u = lat / tile. */
  uTile?: number;
  vTile: number;
  heightFn?: (i: number, lat: number, k: number) => number;
}

function addRibbon(gb: GeoBuilder, path: TrackPath, o: RibbonOpts) {
  let prevRow = -1;
  for (let k = 0; k <= o.count; k++) {
    const i = path.idx(o.i0 + k);
    if (!path.closed && o.i0 + k > path.n - 1) break;
    const l0 = o.lat0(i);
    const l1 = o.lat1(i);
    const rowStart = gb.count;
    const s = (o.i0 + k) * SAMPLE_SPACING;
    for (let c = 0; c <= o.cols; c++) {
      const lat = l0 + ((l1 - l0) * c) / o.cols;
      const x = path.px[i] + path.nx[i] * lat;
      const z = path.pz[i] + path.nz[i] * lat;
      const y = path.py[i] + Math.tan(path.bank[i]) * lat + o.y + (o.heightFn ? o.heightFn(i, lat, k) : 0);
      const u = o.uTile ? lat / o.uTile : c / o.cols;
      gb.vert(x, y, z, u, s / o.vTile);
    }
    if (prevRow >= 0) {
      for (let c = 0; c < o.cols; c++) gb.quad(prevRow + c, prevRow + c + 1, rowStart + c, rowStart + c + 1);
    }
    prevRow = rowStart;
  }
}

/** Wall ribbon along one side (lateral function), vertical inner face + top. */
function addWall(gb: GeoBuilder, path: TrackPath, i0: number, count: number, side: 1 | -1, height: number, lat: LatFn, thickness: number, heightFn?: (i: number, k: number) => number) {
  let prev = -1;
  for (let k = 0; k <= count; k++) {
    if (!path.closed && i0 + k > path.n - 1) break;
    const i = path.idx(i0 + k);
    const l = lat(i) * side;
    const nx = path.nx[i] * side;
    const nz = path.nz[i] * side;
    const baseY = path.py[i] + Math.tan(path.bank[i]) * lat(i) * side;
    const h = heightFn ? heightFn(i, k) : height;
    const x = path.px[i] + path.nx[i] * l;
    const z = path.pz[i] + path.nz[i] * l;
    const s = (i0 + k) * SAMPLE_SPACING;
    const row = gb.count;
    gb.vert(x, baseY - 0.6, z, 0, s / 4);
    gb.vert(x, baseY + h, z, 1, s / 4);
    gb.vert(x + nx * thickness, baseY + h, z + nz * thickness, 1, s / 4);
    gb.vert(x + nx * thickness, baseY - 0.6, z + nz * thickness, 0, s / 4);
    if (prev >= 0) {
      if (side > 0) {
        gb.quad(prev, prev + 1, row, row + 1);
        gb.quad(prev + 1, prev + 2, row + 1, row + 2);
        gb.quad(prev + 2, prev + 3, row + 2, row + 3);
      } else {
        gb.quad(prev + 1, prev, row + 1, row);
        gb.quad(prev + 2, prev + 1, row + 2, row + 1);
        gb.quad(prev + 3, prev + 2, row + 3, row + 2);
      }
    }
    prev = row;
  }
}

/** Iterates contiguous runs of samples where `pred` is true. Handles closed-loop wrap. */
function runs(path: TrackPath, pred: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  const n = path.n;
  let start = -1;
  for (let i = 0; i < n; i++) {
    const ok = pred(i);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      out.push([start, i - start]);
      start = -1;
    }
  }
  if (start >= 0) {
    if (path.closed && out.length > 0 && out[0][0] === 0) {
      // Merge the wrap-around run.
      const first = out.shift()!;
      out.push([start, n - start + first[1]]);
    } else out.push([start, path.closed && start === 0 ? n : n - 1 - start]);
  }
  return out;
}

export interface TrackVisual {
  group: THREE.Group;
  /** Called every frame for animated materials (boost pads, water). */
  update(time: number): void;
  /** Terrain height lookup (for scenery placement). */
  terrainHeight(x: number, z: number): number;
  /** Distance from the main centre line (approximate, for scenery placement). */
  distanceToTrack(x: number, z: number): { dist: number; y: number; limit: number };
  dispose(): void;
}

export function surfaceMaterial(type: SurfaceType, theme: ThemeStyle): THREE.MeshStandardMaterial {
  switch (type) {
    case 'wet':
      return new THREE.MeshStandardMaterial({
        color: '#2f3a52',
        roughness: 0.08,
        metalness: 0.35,
        transparent: true,
        opacity: 0.72,
        envMapIntensity: 1.6,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    case 'sand':
      return new THREE.MeshStandardMaterial({ map: noiseTexture('sand-' + theme.sand.base, theme.sand.base, theme.sand.specks, 5), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    case 'dirt':
      return new THREE.MeshStandardMaterial({ map: noiseTexture('dirt-' + theme.dirt.base, theme.dirt.base, theme.dirt.specks, 6), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    case 'grass':
      return new THREE.MeshStandardMaterial({ map: noiseTexture('grass-' + theme.shoulder.base, theme.shoulder.base, theme.shoulder.specks, 7, true), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    default:
      return new THREE.MeshStandardMaterial({ color: '#555', roughness: 0.9 });
  }
}

export function buildTrackVisual(track: Track, lowDetail: boolean): TrackVisual {
  const theme = THEMES[track.def.theme];
  const group = new THREE.Group();
  group.name = 'track';
  const disposables: { dispose(): void }[] = [];
  const animated: ((t: number) => void)[] = [];
  const main = track.main;

  const track2mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, receive = true, cast = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = receive;
    m.castShadow = cast;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    group.add(m);
    disposables.push(geo, mat);
    return m;
  };

  // --- Road surfaces ---------------------------------------------------------------------
  const roadTex = roadTexture(theme.road);
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: theme.roadRoughness, metalness: 0.02 });
  const shoulderTex = noiseTexture('shoulder-' + track.def.theme, theme.shoulder.base, theme.shoulder.specks, 3, theme.shoulder.blades);
  const shoulderMat = new THREE.MeshStandardMaterial({ map: shoulderTex, roughness: 1 });

  for (const path of track.paths) {
    const count = path.closed ? path.n : path.n - 1;
    const isMain = path.id === 0;
    const gb = new GeoBuilder();
    addRibbon(gb, path, {
      i0: 0,
      count,
      lat0: (i) => -path.hw[i],
      lat1: (i) => path.hw[i],
      y: isMain ? 0.0 : -0.015,
      cols: 4,
      vTile: 12,
    });
    const mat = isMain || path.roadSurface === 'asphalt' ? roadMat : surfaceMaterial(path.roadSurface, theme);
    const mesh = track2mesh(gb.build(), mat);
    if (!isMain) {
      const m = mat as THREE.MeshStandardMaterial;
      m.polygonOffset = true;
      m.polygonOffsetFactor = 2;
      m.polygonOffsetUnits = 2;
      mesh.renderOrder = -1;
    }
    // Shoulders (both sides), extending under the barrier.
    const sb = new GeoBuilder();
    addRibbon(sb, path, { i0: 0, count, lat0: (i) => path.hw[i], lat1: (i) => path.limitL[i] + 1.2, y: -0.03, cols: 2, uTile: 6, vTile: 6 });
    addRibbon(sb, path, { i0: 0, count, lat0: (i) => -path.limitR[i] - 1.2, lat1: (i) => -path.hw[i], y: -0.03, cols: 2, uTile: 6, vTile: 6 });
    const sm = track2mesh(sb.build(), shoulderMat);
    if (!isMain) sm.position.y = -0.02;
    sm.updateMatrix();

    // Surface zone overlays.
    for (const z of path.zones) {
      if (z.type === 'boost') continue;
      const i0 = Math.floor(z.s0 / SAMPLE_SPACING);
      const len = z.s1 >= z.s0 ? z.s1 - z.s0 : path.length - z.s0 + z.s1;
      const cnt = Math.max(1, Math.round(len / SAMPLE_SPACING));
      const zb = new GeoBuilder();
      addRibbon(zb, path, {
        i0,
        count: cnt,
        lat0: (i) => clamp(z.lat0, -path.hw[i], path.hw[i]),
        lat1: (i) => clamp(z.lat1, -path.hw[i], path.hw[i]),
        y: 0.02,
        cols: 2,
        uTile: 6,
        vTile: 6,
      });
      track2mesh(zb.build(), surfaceMaterial(z.type, theme));
    }

    // Curbs on curvy sections of the main road.
    if (isMain) {
      const curbTex = stripeTexture('curb-' + theme.curb.join(), theme.curb[0], theme.curb[1]);
      const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7 });
      const cb = new GeoBuilder();
      const curvy = (i: number) => {
        for (let k = -3; k <= 3; k++) if (Math.abs(path.curv[path.idx(i + k)]) > 0.011) return true;
        return false;
      };
      for (const [i0, cnt] of runs(path, curvy)) {
        if (cnt < 3) continue;
        addRibbon(cb, path, { i0, count: cnt, lat0: (i) => path.hw[i] - 0.25, lat1: (i) => path.hw[i] + 0.9, y: 0.035, cols: 1, vTile: 2 });
        addRibbon(cb, path, { i0, count: cnt, lat0: (i) => -path.hw[i] - 0.9, lat1: (i) => -path.hw[i] + 0.25, y: 0.035, cols: 1, vTile: 2 });
      }
      if (cb.count > 0) track2mesh(cb.build(), curbMat);
    }

    // Barriers.
    buildBarriers(path, theme, track2mesh, animated);

    // Ramps.
    for (const r of path.ramps) {
      const i0 = Math.floor(r.s0 / SAMPLE_SPACING);
      const cnt = Math.max(2, Math.round((r.s1 - r.s0) / SAMPLE_SPACING));
      const rb = new GeoBuilder();
      const hAt = (k: number) => {
        const t = clamp(k / cnt, 0, 1);
        return r.height * (0.35 * t + 0.65 * t * t);
      };
      addRibbon(rb, path, { i0, count: cnt, lat0: () => r.lat0, lat1: () => r.lat1, y: 0.01, cols: 2, uTile: 2, vTile: 1.5, heightFn: (_i, _l, k) => hAt(k) });
      // Sides.
      addWall(rb, path, i0, cnt, 1, 0, () => r.lat1, 0.05, (_i, k) => hAt(k));
      addWall(rb, path, i0, cnt, -1, 0, () => -r.lat0, 0.05, (_i, k) => hAt(k));
      const rampMat = new THREE.MeshStandardMaterial({ map: stripeTexture('ramp', '#ffb13d', '#fff3e0', 4), roughness: 0.6 });
      track2mesh(rb.build(), rampMat, true, true);
      // Lip face.
      const li = path.idx(i0 + cnt);
      const h = r.height;
      const lip = new GeoBuilder();
      const lx0 = path.px[li] + path.nx[li] * r.lat0;
      const lz0 = path.pz[li] + path.nz[li] * r.lat0;
      const lx1 = path.px[li] + path.nx[li] * r.lat1;
      const lz1 = path.pz[li] + path.nz[li] * r.lat1;
      const y0 = path.py[li];
      const a = lip.vert(lx0, y0 - 0.2, lz0, 0, 0);
      const b = lip.vert(lx1, y0 - 0.2, lz1, 1, 0);
      const c = lip.vert(lx0, y0 + h, lz0, 0, 1);
      const d = lip.vert(lx1, y0 + h, lz1, 1, 1);
      lip.idx.push(a, b, c, b, d, c, a, c, b, b, c, d);
      track2mesh(lip.build(), new THREE.MeshStandardMaterial({ color: '#ff6f59', roughness: 0.8, side: THREE.DoubleSide }));
    }

    // Boost pads.
    for (const z of path.zones) {
      if (z.type !== 'boost') continue;
      const i0 = Math.floor(z.s0 / SAMPLE_SPACING);
      const cnt = Math.max(2, Math.round((z.s1 - z.s0) / SAMPLE_SPACING));
      const bb = new GeoBuilder();
      addRibbon(bb, path, { i0, count: cnt, lat0: () => z.lat0, lat1: () => z.lat1, y: 0.03, cols: 1, vTile: 4 });
      const tex = chevronTexture().clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 1.3, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      track2mesh(bb.build(), mat);
      disposables.push(tex);
      animated.push((t) => {
        tex.offset.y = -t * 1.6;
      });
    }
  }

  // --- Start / finish line & gantry --------------------------------------------------------
  {
    const cb = new GeoBuilder();
    addRibbon(cb, main, { i0: main.n - 1, count: 2, lat0: (i) => -main.hw[i], lat1: (i) => main.hw[i], y: 0.025, cols: 1, vTile: 4 });
    const checker = checkerTexture().clone();
    checker.needsUpdate = true;
    checker.wrapS = checker.wrapT = THREE.RepeatWrapping;
    checker.repeat.set(1, 1);
    const cm = new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    track2mesh(cb.build(), cm);
    disposables.push(checker);
    const hw = main.hw[0];
    const pillarMat = new THREE.MeshStandardMaterial({ color: theme.gantry.pillar, roughness: 0.5, metalness: 0.2 });
    const pillarGeo = new THREE.BoxGeometry(1.2, 8, 1.2);
    for (const side of [1, -1]) {
      const lat = (hw + 2.2) * side;
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(main.px[0] + main.nx[0] * lat, main.py[0] + 4, main.pz[0] + main.nz[0] * lat);
      p.castShadow = true;
      p.receiveShadow = true;
      group.add(p);
    }
    const bannerTex = bannerTexture('PRISM RUSH', theme.gantry.banner, theme.gantry.text);
    const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex, emissiveMap: bannerTex, emissive: '#ffffff', emissiveIntensity: 0.35, roughness: 0.6 });
    const banner = new THREE.Mesh(new THREE.BoxGeometry((hw + 2.8) * 2, 2.2, 0.6), [pillarMat, pillarMat, pillarMat, pillarMat, bannerMat, bannerMat]);
    banner.position.set(main.px[0], main.py[0] + 7.2, main.pz[0]);
    banner.rotation.y = Math.atan2(main.tx[0], main.tz[0]);
    banner.castShadow = true;
    group.add(banner);
    disposables.push(pillarGeo, pillarMat, bannerMat, banner.geometry);
  }

  // --- Terrain -------------------------------------------------------------------------------
  const field = buildDistanceField(track);
  const sea = track.def.sea;
  const terrainHeight = (x: number, z: number) => {
    const d = field.sample(x, z);
    const away = smoothstep(d.limit + 3, d.limit + 70, d.dist);
    const f = fbm2(x * theme.hillScale, z * theme.hillScale, 4, track.def.seed);
    const n = theme.hills > 0 ? (theme.signedHills ? f * 1.4 : f * 0.5 + 0.5) * theme.hills : 0;
    let h = d.y - 0.12 - 0.4 * smoothstep(d.limit, d.limit + 4, d.dist) + away * n;
    if (sea) {
      const along = x * sea.dir[0] + z * sea.dir[1];
      h -= smoothstep(sea.start, sea.start + 70, along) * 14 * smoothstep(d.limit + 2, d.limit + 25, d.dist);
    }
    return h;
  };
  {
    const b = track.bounds;
    const margin = 420;
    const minX = b.minX - margin;
    const maxX = b.maxX + margin;
    const minZ = b.minZ - margin;
    const maxZ = b.maxZ + margin;
    const seg = lowDetail ? 90 : 150;
    const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, terrainHeight(x, z));
      uv.setXY(i, x / 14, z / 14);
    }
    geo.computeVertexNormals();
    const tex = noiseTexture('ground-' + track.def.theme, theme.ground.base, theme.ground.specks, 9, theme.ground.blades);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, color: theme.groundTint });
    const terrain = track2mesh(geo, mat, true, false);
    terrain.name = 'terrain';
  }

  // --- Water -----------------------------------------------------------------------------
  if (theme.water) {
    const water = buildWater(track, theme.water.color, theme.water.deep, theme.water.level);
    group.add(water.mesh);
    disposables.push(water);
    animated.push(water.update);
  }

  return {
    group,
    update(time: number) {
      for (const a of animated) a(time);
    },
    terrainHeight,
    distanceToTrack: (x, z) => field.sample(x, z),
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

function buildBarriers(
  path: TrackPath,
  theme: ThemeStyle,
  addMesh: (g: THREE.BufferGeometry, m: THREE.Material, receive?: boolean, cast?: boolean) => THREE.Mesh,
  animated: ((t: number) => void)[],
) {
  const kind = theme.barrier.kind;
  const wb = new GeoBuilder();
  const count = path.closed ? path.n : path.n - 1;
  const height = theme.barrier.height;
  for (const side of [1, -1] as const) {
    const gap = side > 0 ? path.gapL : path.gapR;
    const lim = side > 0 ? path.limitL : path.limitR;
    for (const [i0, cnt] of runs(path, (i) => !gap[i])) {
      if (cnt < 2) continue;
      const hf =
        kind === 'rock'
          ? (i: number) => height + (Math.sin(i * 0.37) * 0.5 + 0.5) * 3 + (Math.sin(i * 0.11 + 2) * 0.5 + 0.5) * 4
          : undefined;
      addWall(wb, path, i0, Math.min(cnt, count), side, height, (i) => lim[i] + 0.05, kind === 'rock' ? 2.5 : 0.45, hf);
    }
  }
  if (wb.count === 0) return;
  let mat: THREE.Material;
  switch (kind) {
    case 'neon': {
      mat = new THREE.MeshStandardMaterial({ color: '#181530', emissive: theme.barrier.a, emissiveIntensity: 0.9, emissiveMap: stripeTexture('neon-glow', '#000000', '#ffffff', 6), roughness: 0.4, metalness: 0.4 });
      animated.push((t) => {
        (mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + Math.sin(t * 3) * 0.15;
      });
      break;
    }
    case 'wood':
      mat = new THREE.MeshStandardMaterial({ map: stripeTexture('wood', theme.barrier.a, '#8a5530', 8), roughness: 0.9 });
      break;
    case 'rock':
      mat = new THREE.MeshStandardMaterial({ map: noiseTexture('rock', theme.barrier.a, [theme.barrier.b, '#b0603a', '#d98a5a'], 21), roughness: 1, flatShading: true });
      break;
    case 'tires':
    case 'foam':
    default:
      mat = new THREE.MeshStandardMaterial({ map: stripeTexture('foam-' + theme.barrier.a, theme.barrier.a, theme.barrier.b, 2), roughness: 0.75 });
      break;
  }
  addMesh(wb.build(), mat, true, false);
}

/** Coarse grid of distances to the main centre line for terrain & scenery placement. */
function buildDistanceField(track: Track) {
  const b = track.bounds;
  const margin = 440;
  const cell = 8;
  const minX = b.minX - margin;
  const minZ = b.minZ - margin;
  const w = Math.ceil((b.maxX + margin - minX) / cell) + 1;
  const h = Math.ceil((b.maxZ + margin - minZ) / cell) + 1;
  const dist = new Float32Array(w * h).fill(1e9);
  const ys = new Float32Array(w * h);
  const lims = new Float32Array(w * h).fill(8);
  // Splat each sample outward within a radius, keeping the nearest (brute force but bounded).
  const R = 120;
  const rc = Math.ceil(R / cell);
  for (const path of track.paths) {
    for (let i = 0; i < path.n; i += 2) {
      const cx = Math.round((path.px[i] - minX) / cell);
      const cz = Math.round((path.pz[i] - minZ) / cell);
      const lim = Math.max(path.limitL[i], path.limitR[i]);
      for (let dz = -rc; dz <= rc; dz++) {
        const gz = cz + dz;
        if (gz < 0 || gz >= h) continue;
        for (let dx = -rc; dx <= rc; dx++) {
          const gx = cx + dx;
          if (gx < 0 || gx >= w) continue;
          const wx = minX + gx * cell;
          const wz = minZ + gz * cell;
          const d = Math.hypot(wx - path.px[i], wz - path.pz[i]);
          const k = gz * w + gx;
          if (d < dist[k]) {
            dist[k] = d;
            ys[k] = path.py[i];
            lims[k] = lim;
          }
        }
      }
    }
  }
  // Cells far from any sample: propagate y from nearest known (simple sweep).
  for (let pass = 0; pass < 2; pass++) {
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const k = z * w + x;
        if (dist[k] < 1e8) continue;
        const nb = [k - 1, k + 1, k - w, k + w].filter((j) => j >= 0 && j < w * h && dist[j] < 1e8);
        if (nb.length) {
          ys[k] = ys[nb[0]];
          lims[k] = lims[nb[0]];
        }
      }
    }
  }
  const sample = (x: number, z: number) => {
    const fx = clamp((x - minX) / cell, 0, w - 1.001);
    const fz = clamp((z - minZ) / cell, 0, h - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const k = iz * w + ix;
    const bil = (arr: Float32Array) =>
      arr[k] * (1 - tx) * (1 - tz) + arr[k + 1] * tx * (1 - tz) + arr[k + w] * (1 - tx) * tz + arr[k + w + 1] * tx * tz;
    const d = Math.min(bil(dist), 1e4);
    return { dist: d, y: bil(ys), limit: bil(lims) };
  };
  return { sample };
}

function buildWater(track: Track, color: string, deep: string, level: number) {
  const b = track.bounds;
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 2400;
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const uniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(color) },
    uDeep: { value: new THREE.Color(deep) },
  };
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.92, envMapIntensity: 1.2 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uDeep = uniforms.uDeep;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uTime;\nuniform vec3 uDeep;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float w1 = sin(vWPos.x * 0.08 + uTime * 1.2) * sin(vWPos.z * 0.07 - uTime * 0.9);
        float w2 = sin(vWPos.x * 0.21 - uTime * 1.7 + vWPos.z * 0.13);
        float waves = w1 * 0.5 + w2 * 0.25;
        diffuseColor.rgb = mix(diffuseColor.rgb, uDeep, 0.35 + waves * 0.15);
        diffuseColor.rgb += vec3(smoothstep(0.62, 0.75, waves)) * 0.35;`,
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  mesh.position.set(cx, level, cz);
  mesh.receiveShadow = false;
  return {
    mesh,
    update: (t: number) => {
      uniforms.uTime.value = t;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
