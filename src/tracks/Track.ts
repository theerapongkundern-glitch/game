import * as THREE from 'three';
import { SURFACES, type SurfaceType } from './Surfaces';
import type { TrackDef, TrackPoint } from './types';
import { clamp, mod, smoothstep } from '../core/math';
import type { Ground, GroundInfo } from '../vehicles/VehiclePhysics';

/** Sample spacing along every path, in metres. */
export const SAMPLE_SPACING = 2;

interface Zone {
  s0: number;
  s1: number;
  lat0: number;
  lat1: number;
  type: SurfaceType;
}

interface Ramp {
  s0: number;
  s1: number;
  lat0: number;
  lat1: number;
  height: number;
}

/**
 * A sampled centre line (the main loop or a shortcut). Stored as flat typed arrays
 * so per-step queries for many cars stay allocation-free.
 */
export class TrackPath {
  readonly n: number;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  /** Normalised 3D tangent. */
  readonly tx: Float32Array;
  readonly ty: Float32Array;
  readonly tz: Float32Array;
  /** Horizontal left normal. */
  readonly nx: Float32Array;
  readonly nz: Float32Array;
  /** Half road width. */
  readonly hw: Float32Array;
  /** Bank angle in radians (positive = left edge up). */
  readonly bank: Float32Array;
  /** Signed curvature (1/m), positive = turning left. */
  readonly curv: Float32Array;
  /** Control-point parameter at each sample. */
  readonly u: Float32Array;
  readonly length: number;
  /** Barrier distance from centre line per side. */
  readonly limitL: Float32Array;
  readonly limitR: Float32Array;
  /** 1 where the barrier is open (junction to another path). */
  readonly gapL: Uint8Array;
  readonly gapR: Uint8Array;
  zones: Zone[] = [];
  ramps: Ramp[] = [];

  constructor(
    readonly id: number,
    readonly closed: boolean,
    readonly roadSurface: SurfaceType,
    readonly shoulderSurface: SurfaceType,
    readonly shoulder: number,
    samples: { p: THREE.Vector3; w: number; bank: number; u: number }[],
    /** For shortcuts: the main-loop distance at start and end. */
    readonly mainFrom = 0,
    readonly mainSpan = 0,
  ) {
    const n = samples.length;
    this.n = n;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.tx = new Float32Array(n);
    this.ty = new Float32Array(n);
    this.tz = new Float32Array(n);
    this.nx = new Float32Array(n);
    this.nz = new Float32Array(n);
    this.hw = new Float32Array(n);
    this.bank = new Float32Array(n);
    this.curv = new Float32Array(n);
    this.u = new Float32Array(n);
    this.limitL = new Float32Array(n);
    this.limitR = new Float32Array(n);
    this.gapL = new Uint8Array(n);
    this.gapR = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      this.px[i] = s.p.x;
      this.py[i] = s.p.y;
      this.pz[i] = s.p.z;
      this.hw[i] = s.w / 2;
      this.bank[i] = s.bank;
      this.u[i] = s.u;
      this.limitL[i] = s.w / 2 + shoulder;
      this.limitR[i] = s.w / 2 + shoulder;
    }
    for (let i = 0; i < n; i++) {
      const a = this.idx(i - 1);
      const b = this.idx(i + 1);
      let dx = this.px[b] - this.px[a];
      let dy = this.py[b] - this.py[a];
      let dz = this.pz[b] - this.pz[a];
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      this.tx[i] = dx;
      this.ty[i] = dy;
      this.tz[i] = dz;
      const hl = Math.hypot(dx, dz) || 1;
      // left = up × tangent (Y-up, right handed): (tz, 0, -tx)
      this.nx[i] = dz / hl;
      this.nz[i] = -dx / hl;
    }
    // Signed curvature from heading change.
    for (let i = 0; i < n; i++) {
      const a = this.idx(i - 2);
      const b = this.idx(i + 2);
      const ha = Math.atan2(this.tx[a], this.tz[a]);
      const hb = Math.atan2(this.tx[b], this.tz[b]);
      let dh = hb - ha;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      this.curv[i] = dh / (4 * SAMPLE_SPACING);
    }
    this.length = closed ? n * SAMPLE_SPACING : (n - 1) * SAMPLE_SPACING;
  }

  idx(i: number): number {
    return this.closed ? mod(i, this.n) : clamp(i, 0, this.n - 1);
  }

  /** Converts a distance along this path into main-loop progress distance. */
  toMainS(s: number, mainLength: number): number {
    if (this.id === 0) return s;
    return mod(this.mainFrom + (s / this.length) * this.mainSpan, mainLength);
  }

  surfaceAt(s: number, lateral: number): SurfaceType {
    const zones = this.zones;
    for (let k = 0; k < zones.length; k++) {
      const z = zones[k];
      if (lateral < z.lat0 || lateral > z.lat1) continue;
      if (z.s0 <= z.s1 ? s >= z.s0 && s <= z.s1 : s >= z.s0 || s <= z.s1) return z.type;
    }
    return this.roadSurface;
  }

  rampHeight(s: number, lateral: number): number {
    const ramps = this.ramps;
    for (let k = 0; k < ramps.length; k++) {
      const r = ramps[k];
      if (s < r.s0 || s > r.s1 || lateral < r.lat0 || lateral > r.lat1) continue;
      const t = (s - r.s0) / (r.s1 - r.s0);
      // Slightly curved kicker: gentle start, steeper lip.
      return r.height * (0.35 * t + 0.65 * t * t);
    }
    return 0;
  }

  /** Position/frame along the path at distance s (interpolated). */
  frameAt(s: number, out: PathFrame): PathFrame {
    const f = this.closed ? mod(s, this.length) / SAMPLE_SPACING : clamp(s / SAMPLE_SPACING, 0, this.n - 1.0001);
    const i = Math.floor(f);
    const t = f - i;
    const j = this.idx(i + 1);
    const ii = this.idx(i);
    out.x = this.px[ii] + (this.px[j] - this.px[ii]) * t;
    out.y = this.py[ii] + (this.py[j] - this.py[ii]) * t;
    out.z = this.pz[ii] + (this.pz[j] - this.pz[ii]) * t;
    out.tx = this.tx[ii] + (this.tx[j] - this.tx[ii]) * t;
    out.tz = this.tz[ii] + (this.tz[j] - this.tz[ii]) * t;
    const tl = Math.hypot(out.tx, out.tz) || 1;
    out.tx /= tl;
    out.tz /= tl;
    out.nx = out.tz;
    out.nz = -out.tx;
    out.hw = this.hw[ii] + (this.hw[j] - this.hw[ii]) * t;
    out.bank = this.bank[ii] + (this.bank[j] - this.bank[ii]) * t;
    out.heading = Math.atan2(out.tx, out.tz);
    out.index = ii;
    return out;
  }
}

export interface PathFrame {
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  hw: number;
  bank: number;
  heading: number;
  index: number;
}

export function makeFrame(): PathFrame {
  return { x: 0, y: 0, z: 0, tx: 0, tz: 1, nx: 1, nz: 0, hw: 5, bank: 0, heading: 0, index: 0 };
}

/** Result of a track query for a world position. Reused per car to avoid allocations. */
export interface TrackQuery {
  path: number;
  index: number;
  /** Distance along the chosen path. */
  s: number;
  /** Progress distance along the main loop. */
  mainS: number;
  /** Signed lateral offset, left-positive. */
  lateral: number;
  halfWidth: number;
  limitL: number;
  limitR: number;
  ground: number;
  /** Ground normal. */
  nx: number;
  ny: number;
  nz: number;
  /** Horizontal tangent of the path. */
  tx: number;
  tz: number;
  surface: SurfaceType;
  onRoad: boolean;
  /** True if the car is outside the barriers of every nearby path. */
  outside: boolean;
  /** How far outside the barrier (positive = penetrating), and which side (+1 left, -1 right). */
  penetration: number;
  wallSide: number;
  /** Outward horizontal wall normal. */
  wallNx: number;
  wallNz: number;
  /** Search hints per path. */
  hints: Int32Array;
}

export function makeQuery(pathCount: number): TrackQuery {
  return {
    path: 0,
    index: 0,
    s: 0,
    mainS: 0,
    lateral: 0,
    halfWidth: 5,
    limitL: 8,
    limitR: 8,
    ground: 0,
    nx: 0,
    ny: 1,
    nz: 0,
    tx: 0,
    tz: 1,
    surface: 'asphalt',
    onRoad: true,
    outside: false,
    penetration: 0,
    wallSide: 0,
    wallNx: 0,
    wallNz: 0,
    hints: new Int32Array(pathCount).fill(-1),
  };
}

interface Candidate {
  index: number;
  frac: number;
  dist2: number;
  lateral: number;
}

function sampleSpline(points: TrackPoint[], closed: boolean, defaultWidth: number, uOffset = 0) {
  const vecs = points.map((p) => new THREE.Vector3(p.x, p.y ?? 0, p.z));
  const curve = new THREE.CatmullRomCurve3(vecs, closed, 'centripetal', 0.5);
  const segs = closed ? points.length : points.length - 1;
  // Dense arc-length table.
  const dense = segs * 80;
  const lengths = new Float64Array(dense + 1);
  const tmp = new THREE.Vector3();
  const prev = curve.getPoint(0);
  for (let i = 1; i <= dense; i++) {
    curve.getPoint(i / dense, tmp);
    lengths[i] = lengths[i - 1] + tmp.distanceTo(prev);
    prev.copy(tmp);
  }
  const total = lengths[dense];
  const count = closed ? Math.max(8, Math.round(total / SAMPLE_SPACING)) : Math.max(2, Math.round(total / SAMPLE_SPACING) + 1);
  const spacing = closed ? total / count : total / (count - 1);
  const out: { p: THREE.Vector3; w: number; bank: number; u: number }[] = [];
  let j = 0;
  const scalar = (u: number, get: (p: TrackPoint) => number) => {
    const n = points.length;
    const i0 = Math.floor(u);
    const f = u - i0;
    const a = get(points[closed ? mod(i0, n) : clamp(i0, 0, n - 1)]);
    const b = get(points[closed ? mod(i0 + 1, n) : clamp(i0 + 1, 0, n - 1)]);
    return a + (b - a) * smoothstep(0, 1, f);
  };
  for (let k = 0; k < count; k++) {
    const target = k * spacing;
    while (j < dense - 1 && lengths[j + 1] < target) j++;
    const segLen = lengths[j + 1] - lengths[j] || 1;
    const t = (j + (target - lengths[j]) / segLen) / dense;
    const p = curve.getPoint(Math.min(t, 1));
    const u = t * segs;
    out.push({
      p,
      w: scalar(u, (pt) => pt.w ?? defaultWidth),
      bank: (scalar(u, (pt) => pt.bank ?? 0) * Math.PI) / 180,
      u: u + uOffset,
    });
  }
  return { samples: out, spacing, total };
}

/**
 * A complete track: main loop + optional shortcuts, with fast spatial queries used by
 * physics, AI, race progress and the renderer.
 */
export class Track {
  readonly paths: TrackPath[] = [];
  readonly main: TrackPath;
  readonly length: number;
  readonly bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };

  readonly def: TrackDef;

  constructor(source: TrackDef) {
    // Apply the authoring scale once so everything downstream works in world metres.
    const k = source.scale ?? 1;
    const sc = (p: TrackPoint): TrackPoint => ({ ...p, x: p.x * k, z: p.z * k });
    const def: TrackDef = (this.def = {
      ...source,
      points: source.points.map(sc),
      shortcuts: source.shortcuts?.map((s) => ({ ...s, via: s.via.map(sc) })),
    });
    const mainSampled = sampleSpline(def.points, true, def.width);
    // Resample exactly on SAMPLE_SPACING by treating spacing as nominal: we keep the
    // real spacing (very close to 2 m) but store length = n * SAMPLE_SPACING for indexing.
    this.main = new TrackPath(0, true, 'asphalt', def.shoulderSurface, def.shoulder, mainSampled.samples);
    this.paths.push(this.main);
    this.length = this.main.length;

    for (const sc of def.shortcuts ?? []) {
      const fromS = this.sAtU(sc.from);
      const toS = this.sAtU(sc.to);
      const a = this.main.frameAt(fromS, makeFrame());
      const b = this.main.frameAt(toS, makeFrame());
      const lead = 10;
      const pts: TrackPoint[] = [
        { x: a.x, z: a.z, y: a.y, w: sc.width ?? def.width * 0.8 },
        { x: a.x + a.tx * lead, z: a.z + a.tz * lead, y: a.y, w: sc.width ?? def.width * 0.8 },
        ...sc.via.map((p) => ({ ...p, w: p.w ?? sc.width ?? def.width * 0.8 })),
        { x: b.x - b.tx * lead, z: b.z - b.tz * lead, y: b.y, w: sc.width ?? def.width * 0.8 },
        { x: b.x, z: b.z, y: b.y, w: sc.width ?? def.width * 0.8 },
      ];
      const sampled = sampleSpline(pts, false, sc.width ?? def.width * 0.8);
      const span = mod(toS - fromS, this.length);
      const path = new TrackPath(this.paths.length, false, sc.surface, def.shoulderSurface, Math.min(def.shoulder, 3), sampled.samples, fromS, span);
      this.paths.push(path);
    }

    // Surface zones.
    for (const z of def.surfaces ?? []) {
      const path = z.shortcut !== undefined ? this.paths[z.shortcut + 1] : this.main;
      const s0 = this.sAtUOnPath(path, z.from);
      const s1 = this.sAtUOnPath(path, z.to);
      path.zones.push({ s0, s1, lat0: z.lat?.[0] ?? -999, lat1: z.lat?.[1] ?? 999, type: z.type });
    }
    for (const bp of def.boostPads ?? []) {
      const path = bp.shortcut !== undefined ? this.paths[bp.shortcut + 1] : this.main;
      const s0 = this.sAtUOnPath(path, bp.at);
      const len = bp.length ?? 8;
      const w = bp.width ?? 3.2;
      const off = bp.offset ?? 0;
      path.zones.unshift({ s0, s1: s0 + len, lat0: off - w / 2, lat1: off + w / 2, type: 'boost' });
    }
    for (const r of def.ramps ?? []) {
      const path = r.shortcut !== undefined ? this.paths[r.shortcut + 1] : this.main;
      const s0 = this.sAtUOnPath(path, r.at);
      const idx = path.idx(Math.round(s0 / SAMPLE_SPACING));
      const w = r.width ?? path.hw[idx] * 2 * 0.7;
      const off = r.offset ?? 0;
      path.ramps.push({ s0, s1: s0 + r.length, lat0: off - w / 2, lat1: off + w / 2, height: r.height });
    }

    this.computeGaps();

    for (const p of this.paths) {
      for (let i = 0; i < p.n; i++) {
        const lim = Math.max(p.limitL[i], p.limitR[i]) + 20;
        this.bounds.minX = Math.min(this.bounds.minX, p.px[i] - lim);
        this.bounds.maxX = Math.max(this.bounds.maxX, p.px[i] + lim);
        this.bounds.minZ = Math.min(this.bounds.minZ, p.pz[i] - lim);
        this.bounds.maxZ = Math.max(this.bounds.maxZ, p.pz[i] + lim);
      }
    }
  }

  /** Distance along the main loop at a control-point parameter. */
  sAtU(u: number): number {
    return this.sAtUOnPath(this.main, u);
  }

  /**
   * Main loop: `u` is a control-point index. Shortcuts: `u` is a 0..1 fraction of the
   * shortcut's length (more intuitive when authoring).
   */
  sAtUOnPath(path: TrackPath, u: number): number {
    if (path.id !== 0) return clamp(u, 0, 1) * path.length;
    const target = mod(u, this.def.points.length);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < path.n; i++) {
      const d = Math.abs(path.u[i] - target);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best * SAMPLE_SPACING;
  }

  /** Opens the barriers where a path's corridor overlaps another path's corridor. */
  private computeGaps() {
    if (this.paths.length < 2) return;
    const q = makeQuery(this.paths.length);
    const cand: Candidate = { index: 0, frac: 0, dist2: 0, lateral: 0 };
    for (const p of this.paths) {
      for (let i = 0; i < p.n; i++) {
        for (const side of [1, -1]) {
          const lim = side > 0 ? p.limitL[i] : p.limitR[i];
          const x = p.px[i] + p.nx[i] * lim * side;
          const z = p.pz[i] + p.nz[i] * lim * side;
          for (const other of this.paths) {
            if (other === p) continue;
            q.hints[other.id] = -1;
            this.nearestOnPath(other, x, z, q, cand);
            const oLim = cand.lateral >= 0 ? other.limitL[cand.index] : other.limitR[cand.index];
            if (Math.abs(cand.lateral) < oLim - 0.5 && cand.dist2 < (oLim + 2) ** 2) {
              if (side > 0) p.gapL[i] = 1;
              else p.gapR[i] = 1;
            }
          }
        }
      }
    }
  }

  private nearestOnPath(path: TrackPath, x: number, z: number, q: TrackQuery, out: Candidate): Candidate {
    let hint = q.hints[path.id];
    let best = -1;
    let bestD = Infinity;
    if (hint >= 0) {
      const W = 10;
      for (let k = -W; k <= W; k++) {
        const i = path.idx(hint + k);
        const dx = path.px[i] - x;
        const dz = path.pz[i] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      // If the best is at the edge of the window we may be tracking badly; fall back.
      if (bestD > 60 * 60) best = -1;
    }
    if (best < 0) {
      bestD = Infinity;
      for (let i = 0; i < path.n; i++) {
        const dx = path.px[i] - x;
        const dz = path.pz[i] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    q.hints[path.id] = best;
    // Project onto the neighbouring segment (i -> i+1 or i-1 -> i).
    const i0 = best;
    let a = i0;
    let b = path.idx(i0 + 1);
    if (!path.closed && i0 === path.n - 1) {
      a = i0 - 1;
      b = i0;
    }
    let ax = path.px[a];
    let az = path.pz[a];
    let sx = path.px[b] - ax;
    let sz = path.pz[b] - az;
    let t = ((x - ax) * sx + (z - az) * sz) / (sx * sx + sz * sz || 1);
    if (t < 0 && (path.closed || a > 0)) {
      b = a;
      a = path.idx(a - 1);
      ax = path.px[a];
      az = path.pz[a];
      sx = path.px[b] - ax;
      sz = path.pz[b] - az;
      t = ((x - ax) * sx + (z - az) * sz) / (sx * sx + sz * sz || 1);
    }
    t = clamp(t, 0, 1);
    const cx = ax + sx * t;
    const cz = az + sz * t;
    const nx = path.nx[a] + (path.nx[b] - path.nx[a]) * t;
    const nz = path.nz[a] + (path.nz[b] - path.nz[a]) * t;
    out.index = a;
    out.frac = t;
    out.dist2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
    out.lateral = (x - cx) * nx + (z - cz) * nz;
    return out;
  }

  private readonly cands: Candidate[] = [];

  /**
   * Finds where a world position is relative to the track. Chooses the path whose road
   * contains the point (main preferred), computes ground height, surface and barriers.
   */
  query(x: number, z: number, q: TrackQuery, radius = 0): TrackQuery {
    const paths = this.paths;
    while (this.cands.length < paths.length) this.cands.push({ index: 0, frac: 0, dist2: 0, lateral: 0 });
    let chosen = -1;
    let chosenScore = Infinity;
    let inside = false;
    for (let p = 0; p < paths.length; p++) {
      const path = paths[p];
      const c = this.nearestOnPath(path, x, z, q, this.cands[p]);
      const hw = path.hw[c.index];
      const lim = c.lateral >= 0 ? path.limitL[c.index] : path.limitR[c.index];
      const absLat = Math.abs(c.lateral);
      // Is this candidate plausible (the projection is roughly perpendicular)?
      const perpendicular = c.dist2 <= (absLat + 0.8) * (absLat + 0.8) + 4;
      if (!perpendicular && p > 0) continue;
      if (absLat + radius <= lim) inside = true;
      // Score: road containment first, then distance from road edge.
      const score = (absLat <= hw ? 0 : 1000 + (absLat - hw)) + p * 0.01;
      if (score < chosenScore) {
        chosenScore = score;
        chosen = p;
      }
    }
    if (chosen < 0) chosen = 0;
    const path = paths[chosen];
    const c = this.cands[chosen];
    const i = c.index;
    const j = path.idx(i + 1);
    const t = c.frac;
    const s = (i + t) * SAMPLE_SPACING;
    const lateral = c.lateral;
    const bank = path.bank[i] + (path.bank[j] - path.bank[i]) * t;
    const baseY = path.py[i] + (path.py[j] - path.py[i]) * t;
    const hw = path.hw[i] + (path.hw[j] - path.hw[i]) * t;
    q.path = chosen;
    q.index = i;
    q.s = s;
    q.mainS = path.toMainS(s, this.length);
    q.lateral = lateral;
    q.halfWidth = hw;
    q.limitL = path.limitL[i];
    q.limitR = path.limitR[i];
    q.ground = baseY + Math.tan(bank) * lateral + path.rampHeight(s, lateral);
    // Horizontal tangent from the left normal: left = (tz, -tx)  =>  tx = -nz, tz = nx.
    const tx = -path.nz[i];
    const tz = path.nx[i];
    q.tx = tx;
    q.tz = tz;
    // up = T × L with the banked left vector.
    const ty = path.ty[i];
    const hl = Math.sqrt(Math.max(0, 1 - ty * ty));
    const cb = Math.cos(bank);
    const sb = Math.sin(bank);
    const Lx = path.nx[i] * cb;
    const Ly = sb;
    const Lz = path.nz[i] * cb;
    const Tx = tx * hl;
    const Ty = ty;
    const Tz = tz * hl;
    let ux = Ty * Lz - Tz * Ly;
    let uy = Tz * Lx - Tx * Lz;
    let uz = Tx * Ly - Ty * Lx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    if (uy < 0) {
      ux = -ux;
      uy = -uy;
      uz = -uz;
    }
    q.nx = ux;
    q.ny = uy;
    q.nz = uz;
    const absLat = Math.abs(lateral);
    q.onRoad = absLat <= hw;
    q.surface = q.onRoad ? path.surfaceAt(s, lateral) : path.shoulderSurface;
    q.outside = !inside;
    const lim = lateral >= 0 ? q.limitL : q.limitR;
    q.penetration = inside ? -1 : absLat + radius - lim;
    q.wallSide = lateral >= 0 ? 1 : -1;
    q.wallNx = path.nx[i] * q.wallSide;
    q.wallNz = path.nz[i] * q.wallSide;
    return q;
  }

  surfaceProps(type: SurfaceType) {
    return SURFACES[type];
  }
}

/** Adapts a Track to the vehicle physics `Ground` interface, keeping a per-car query cache. */
export class TrackGround implements Ground {
  readonly q: TrackQuery;

  constructor(readonly track: Track) {
    this.q = makeQuery(track.paths.length);
  }

  sample(x: number, z: number, radius: number, out: GroundInfo): GroundInfo {
    const q = this.track.query(x, z, this.q, radius);
    out.ground = q.ground;
    out.nx = q.nx;
    out.ny = q.ny;
    out.nz = q.nz;
    out.surface = q.surface;
    out.onRoad = q.onRoad;
    out.penetration = q.penetration;
    out.wallNx = q.wallNx;
    out.wallNz = q.wallNz;
    out.tx = q.tx;
    out.tz = q.tz;
    return out;
  }

  /** Forget cached indices (after teleporting). */
  reset() {
    this.q.hints.fill(-1);
  }
}
