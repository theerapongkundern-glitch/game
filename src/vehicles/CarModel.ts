import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BodyStyle, CarDef, CarShape, RimStyle } from './CarDefs';
import { softDotTexture } from '../tracks/textures';
import type { Quality } from '../core/Renderer';
import { ATLAS, detailAtlas, tyreNormalMap, type AtlasRegion } from './carTextures';

export interface WheelVisual {
  /** Steering pivot (rotates around Y). */
  pivot: THREE.Group;
  /** Spinning part (rotates around X). */
  spin: THREE.Group;
  front: boolean;
  left: boolean;
}

export interface CarVisual {
  root: THREE.Group;
  /** Body group that pitches/rolls with suspension. */
  body: THREE.Group;
  wheels: WheelVisual[];
  paint: THREE.MeshStandardMaterial;
  tailLights: THREE.MeshStandardMaterial;
  headLights: THREE.MeshStandardMaterial;
  flames: THREE.Mesh[];
  flameMat: THREE.MeshBasicMaterial;
  /** Rear exhaust positions in body space (for particles). */
  exhausts: THREE.Vector3[];
  /** Rear wheel contact points in root space (for smoke). */
  rearContacts: THREE.Vector3[];
  shape: CarShape;
  /** Colour of the painted-on stripes (shader uniform; set it to hide them). */
  accentStripe: THREE.Color;
  setColor(color: string): void;
  setOpacity(opacity: number): void;
  dispose(): void;
}

/*
 * Cars are built procedurally from CarShape:
 *  - the body is a loft: ~30 cross-sections along the length, each a rounded "car section"
 *    (flat floor, tucked rocker, flank, rounded shoulder, crowned hood) whose height follows the
 *    side profile and whose width is rounded at the corners in plan view;
 *  - wheel arches are carved into the sections and the fenders rise and flare over the tyres;
 *  - the greenhouse is a second loft split into glass, pillars and roof;
 *  - lights, grille vents and skirts are "decals" that follow the analytic body surface.
 * Parts are merged per material so a car costs about 20 draw calls.
 */

type Detail = 'low' | 'high' | 'ultra';

const DETAIL = {
  low: { stations: 14, arch: 5, rocker: 1, side: 1, shoulder: 3, top: 3, gh: 8, ghSide: 2, ghCorner: 2, ghRoof: 2, tyre: 14, rim: 14, decal: 4 },
  high: { stations: 28, arch: 9, rocker: 3, side: 3, shoulder: 6, top: 5, gh: 16, ghSide: 3, ghCorner: 4, ghRoof: 3, tyre: 28, rim: 24, decal: 8 },
  ultra: { stations: 40, arch: 13, rocker: 4, side: 4, shoulder: 9, top: 7, gh: 24, ghSide: 4, ghCorner: 6, ghRoof: 4, tyre: 40, rim: 32, decal: 12 },
} as const;

type Counts = { rocker: number; side: number; shoulder: number; top: number };
const DECAL_COUNTS: Counts = { rocker: 6, side: 10, shoulder: 28, top: 20 };

interface StyleTune {
  /** Plan-view corner radius front / rear. */
  rcF: number;
  rcR: number;
  /** Shoulder radius (horizontal / vertical) and its superellipse exponent. */
  rs: number;
  rsv: number;
  n: number;
  crown: number;
  /** Greenhouse top width relative to its base. */
  tumble: number;
  doors: 2 | 4;
  /** Solid C-pillar (fastback) instead of rear side glass. */
  fastback: boolean;
}

const STYLE: Record<BodyStyle, StyleTune> = {
  coupe: { rcF: 0.36, rcR: 0.3, rs: 0.16, rsv: 0.11, n: 2.6, crown: 0.025, tumble: 0.8, doors: 2, fastback: true },
  hatch: { rcF: 0.3, rcR: 0.22, rs: 0.13, rsv: 0.1, n: 2.8, crown: 0.02, tumble: 0.86, doors: 2, fastback: false },
  bubble: { rcF: 0.5, rcR: 0.42, rs: 0.22, rsv: 0.16, n: 2.2, crown: 0.04, tumble: 0.78, doors: 2, fastback: false },
  drift: { rcF: 0.3, rcR: 0.26, rs: 0.12, rsv: 0.09, n: 3, crown: 0.02, tumble: 0.8, doors: 2, fastback: true },
  wagon: { rcF: 0.26, rcR: 0.2, rs: 0.1, rsv: 0.08, n: 3.2, crown: 0.015, tumble: 0.88, doors: 4, fastback: false },
  hyper: { rcF: 0.45, rcR: 0.34, rs: 0.2, rsv: 0.1, n: 2.4, crown: 0.03, tumble: 0.72, doors: 2, fastback: true },
};

const DARK = 0.06;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Superellipse quarter: 1 at u = 0, 0 at u = 1. */
const se = (u: number, p: number) => Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.max(0, u)), p)), 1 / p);

// --- Geometry helpers -------------------------------------------------------------------------

const tmpMatrix = new THREE.Matrix4();
const tmpEuler = new THREE.Euler();

function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  tmpEuler.set(rx, ry, rz);
  tmpMatrix.makeRotationFromEuler(tmpEuler);
  tmpMatrix.setPosition(x, y, z);
  g.applyMatrix4(tmpMatrix);
  return g;
}

function strip(g: THREE.BufferGeometry, keep: string[]): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) g.dispose();
  for (const name of Object.keys(ng.attributes)) if (!keep.includes(name)) ng.deleteAttribute(name);
  if (!ng.attributes.normal) ng.computeVertexNormals();
  ng.clearGroups();
  return ng;
}

/** Paint parts: position + normal + colour (white unless the part carries its own shading). */
function forPaint(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = strip(g, ['position', 'normal', 'color']);
  if (!ng.attributes.color) {
    const n = ng.attributes.position.count;
    ng.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  }
  return ng;
}

function forPlain(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return strip(g, ['position', 'normal']);
}

/** Detail-atlas parts: UVs point at the centre of a region, or map a planar projection into it. */
function forDetail(g: THREE.BufferGeometry, r: AtlasRegion, planar?: 'xy' | 'zy' | 'xz', flipU = false): THREE.BufferGeometry {
  const ng = strip(g, ['position', 'normal']);
  const pos = ng.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  if (!planar) {
    const cu = (r.u0 + r.u1) / 2;
    const cv = (r.v0 + r.v1) / 2;
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = cu;
      uv[i * 2 + 1] = cv;
    }
  } else {
    ng.computeBoundingBox();
    const b = ng.boundingBox!;
    const ax = planar === 'zy' ? 'z' : 'x';
    const ay = planar === 'xz' ? 'z' : 'y';
    const get = (i: number, a: 'x' | 'y' | 'z') => (a === 'x' ? pos.getX(i) : a === 'y' ? pos.getY(i) : pos.getZ(i));
    const w = Math.max(1e-6, b.max[ax] - b.min[ax]);
    const h = Math.max(1e-6, b.max[ay] - b.min[ay]);
    const pad = 0.01;
    for (let i = 0; i < pos.count; i++) {
      const u0 = (get(i, ax) - b.min[ax]) / w;
      const u = flipU ? 1 - u0 : u0;
      const v = (get(i, ay) - b.min[ay]) / h;
      uv[i * 2] = lerp(r.u0 + pad, r.u1 - pad, u);
      uv[i * 2 + 1] = lerp(r.v0 + pad, r.v1 - pad, v);
    }
  }
  ng.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return ng;
}

function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  m.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  // Flip the winding so faces still point outwards.
  const p = m.attributes.position.array as Float32Array;
  const n = m.attributes.normal?.array as Float32Array | undefined;
  const c = m.attributes.color?.array as Float32Array | undefined;
  const u = m.attributes.uv?.array as Float32Array | undefined;
  const swap = (a: Float32Array, i: number, j: number, k: number) => {
    for (let q = 0; q < k; q++) {
      const t = a[i * k + q];
      a[i * k + q] = a[j * k + q];
      a[j * k + q] = t;
    }
  };
  for (let i = 0; i < m.attributes.position.count; i += 3) {
    swap(p, i + 1, i + 2, 3);
    if (n) swap(n, i + 1, i + 2, 3);
    if (c) swap(c, i + 1, i + 2, 3);
    if (u) swap(u, i + 1, i + 2, 2);
  }
  return m;
}

/** A rounded rectangle shape centred on the origin. */
function roundRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Flat panel from a 2D shape, facing +z (front) or -z (rear), sitting at depth z. */
function panel(shape: THREE.Shape, x: number, y: number, z: number, facing: 1 | -1, depth = 0.012): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -depth);
  if (facing < 0) g.rotateY(Math.PI);
  g.translate(x, y, z);
  return g;
}

function tube(r: number, len: number, seg = 10): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, len, seg, 1);
}

// --- Body field: an analytic description of the body surface ---------------------------------

interface Section {
  z: number;
  yb: number;
  hood: number;
  crown: number;
  rise: number;
  xf0: number;
  xf1: number;
  xs: number;
  rs: number;
  rsv: number;
  hw: number;
  ys: number;
  tuck: number;
  rr: number;
  xin: number;
  ya: number;
  n: number;
}

interface Outline {
  x: number[];
  y: number[];
  dark: number[];
  /** Index of the widest point (flank/shoulder junction). */
  widest: number;
  /** Index of the first rocker point (bottom outer edge). */
  rocker: number;
}

class BodyField {
  readonly L: number;
  readonly W: number;
  readonly yb: number;
  readonly top: number;
  readonly r: number;
  readonly Ra: number;
  readonly axles: number[];
  readonly tune: StyleTune;
  private readonly prof: Float32Array;
  /** Hood lift at the front / rear axle so big wheels don't leave the hood in a valley. */
  private readonly liftF: number;
  private readonly liftR: number;

  constructor(readonly s: CarShape) {
    this.L = s.length;
    this.W = s.width;
    this.yb = s.clearance;
    this.top = s.bodyHeight;
    this.r = s.wheelRadius;
    this.Ra = s.wheelRadius + 0.055;
    this.axles = [s.wheelbase / 2, -s.wheelbase / 2];
    this.tune = STYLE[s.style];
    this.prof = BodyField.sampleProfile(s.profile);
    const liftAt = (zw: number) => {
      const hood = this.hoodAt((this.L / 2 - zw) / this.L);
      const rsv = Math.min(this.tune.rsv, (hood - this.yb) * 0.35);
      return 0.6 * Math.max(0, this.r + this.Ra + 0.035 + rsv - hood);
    };
    this.liftF = liftAt(this.axles[0]);
    this.liftR = liftAt(this.axles[1]);
  }

  /** Smooth plateau between the axles, easing off towards the bumpers. */
  private hoodLift(z: number): number {
    const [zF, zR] = this.axles;
    if (z >= zF) return this.liftF * (1 - 0.7 * smooth(0, 1, (z - zF) / (this.L / 2 - zF)));
    if (z <= zR) return this.liftR * (1 - 0.7 * smooth(0, 1, (zR - z) / (zR + this.L / 2)));
    return lerp(this.liftR, this.liftF, smooth(0, 1, (z - zR) / (zF - zR)));
  }

  /** Upper envelope of the side profile, sampled into 256 bins over the length. */
  private static sampleProfile(points: [number, number][]): Float32Array {
    const BINS = 256;
    const out = new Float32Array(BINS).fill(-1);
    const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'centripetal');
    for (const p of curve.getPoints(600)) {
      const b = Math.min(BINS - 1, Math.max(0, Math.round(p.x * (BINS - 1))));
      out[b] = Math.max(out[b], p.y);
    }
    // Fill empty bins from neighbours.
    for (let i = 0; i < BINS; i++) {
      if (out[i] >= 0) continue;
      let a = i - 1;
      while (a >= 0 && out[a] < 0) a--;
      let b = i + 1;
      while (b < BINS && out[b] < 0) b++;
      out[i] = a >= 0 && b < BINS ? lerp(out[a], out[b], (i - a) / (b - a)) : a >= 0 ? out[a] : out[b];
    }
    const sm = new Float32Array(BINS);
    for (let i = 0; i < BINS; i++) sm[i] = (out[Math.max(0, i - 1)] + out[i] * 2 + out[Math.min(BINS - 1, i + 1)]) / 4;
    return sm;
  }

  /** Hood/deck height at a fraction t of the length (0 = front bumper). */
  hoodAt(t: number): number {
    const f = Math.min(1, Math.max(0, t)) * (this.prof.length - 1);
    const i = Math.floor(f);
    const k = f - i;
    const v = lerp(this.prof[i], this.prof[Math.min(this.prof.length - 1, i + 1)], k);
    return this.yb + Math.max(0.36, v) * (this.top - this.yb);
  }

  section(z: number): Section {
    const { L, W, yb, r, Ra, tune, s } = this;
    const dF = L / 2 - z;
    const dR = z + L / 2;
    let hw = W / 2;
    if (dF < tune.rcF) hw = W / 2 - tune.rcF + tune.rcF * se(1 - dF / tune.rcF, 2.2);
    if (dR < tune.rcR) hw = Math.min(hw, W / 2 - tune.rcR + tune.rcR * se(1 - dR / tune.rcR, 2.2));
    const hood = this.hoodAt(dF / L) + this.hoodLift(z);
    const rsv = Math.min(tune.rsv, (hood - yb) * 0.35);
    let ya = yb;
    let need = 0;
    let bump = 0;
    for (const zw of this.axles) {
      const dz = Math.abs(z - zw);
      if (dz <= Ra + 1e-6) ya = Math.max(ya, r + Math.sqrt(Math.max(0, Ra * Ra - dz * dz)));
      const span = Ra + 0.3;
      if (dz < span) {
        const dome = r + Ra * Math.sqrt(Math.max(0, 1 - (dz / span) ** 2));
        need = Math.max(need, dome + 0.035 + rsv - hood);
        bump = Math.max(bump, 0.5 + 0.5 * Math.cos((Math.PI * dz) / span));
      }
    }
    hw += s.flare * bump;
    const rise = Math.max(0, need) + s.flare * 0.35 * bump;
    const rs = Math.min(tune.rs, hw * 0.3);
    const rr = Math.min(0.05, (hood - yb) * 0.15);
    const tuck = 0.035;
    const xinNominal = W / 2 - s.wheelWidth * 0.85 - 0.045;
    const xin = Math.min(xinNominal, hw - tuck - rr - 0.03);
    const xs = hw - rs;
    const xf1 = Math.min(xin + 0.04, xs - 0.01);
    const xf0 = Math.min(xin - 0.2, xf1 - 0.05);
    const sec: Section = { z, yb, hood, crown: tune.crown, rise, xf0, xf1, xs, rs, rsv, hw, ys: 0, tuck, rr, xin, ya, n: tune.n };
    sec.ys = this.topY(sec, xs) - rsv;
    return sec;
  }

  /** Height of the upper surface at |x| <= xs. */
  topY(c: Section, x: number): number {
    const ax = Math.min(Math.abs(x), c.xs);
    return c.hood + c.crown * (1 - (ax / c.xs) ** 2) + c.rise * smooth(c.xf0, c.xf1, ax);
  }

  /** Right half of the cross-section, from bottom centre to top centre. */
  outline(c: Section, k: Counts): Outline {
    const x: number[] = [];
    const y: number[] = [];
    const dark: number[] = [];
    const push = (px: number, py: number, d: number) => {
      x.push(px);
      y.push(py);
      dark.push(d);
    };
    push(0, c.yb, 1);
    push(c.xin, c.yb, 1);
    push(c.xin + 0.003, c.yb, 1);
    const rocker = x.length;
    const hwLow = c.hw - c.tuck;
    const cx = hwLow - c.rr;
    const cy = c.yb + c.rr;
    for (let i = 0; i <= k.rocker; i++) {
      const a = (i / k.rocker) * (Math.PI / 2);
      push(cx + c.rr * Math.sin(a), cy - c.rr * Math.cos(a), i === 0 ? 1 : 0);
    }
    for (let i = 1; i <= k.side; i++) {
      const u = i / k.side;
      push(c.hw - c.tuck * (1 - u) ** 2, lerp(cy, c.ys, u), 0);
    }
    const widest = x.length - 1;
    const yTopS = this.topY(c, c.xs);
    for (let i = 1; i <= k.shoulder; i++) {
      const a = (i / k.shoulder) * (Math.PI / 2);
      const cs = Math.pow(Math.cos(a), 2 / c.n);
      const sn = Math.pow(Math.sin(a), 2 / c.n);
      push(c.xs + c.rs * cs, c.ys + (yTopS - c.ys) * sn, 0);
    }
    for (let i = 1; i <= k.top; i++) {
      const px = c.xs * (1 - i / k.top);
      push(px, this.topY(c, px), 0);
    }
    // Carve the wheel arch: everything outboard of the well is lifted to the arch line.
    for (let i = 2; i <= widest; i++) {
      if (x[i] > c.xin + 0.001 && y[i] < c.ya) {
        y[i] = c.ya;
        dark[i] = 1;
      }
    }
    return { x, y, dark, widest, rocker };
  }
}

// --- Body loft ------------------------------------------------------------------------------------

interface Station {
  z: number;
  /** The quad strip to the next station is a vertical wheel-arch wall. */
  crease: boolean;
}

function bodyStations(f: BodyField, d: (typeof DETAIL)[Detail]): Station[] {
  const { L, Ra } = f;
  const list: Station[] = [];
  const inArch = (z: number) => f.axles.some((zw) => Math.abs(z - zw) < Ra + 0.04);
  for (let k = 0; k <= d.stations; k++) {
    const t = 0.5 - 0.5 * Math.cos((Math.PI * k) / d.stations);
    const z = L / 2 - t * L;
    if (!inArch(z)) list.push({ z, crease: false });
  }
  for (const zw of f.axles) {
    list.push({ z: zw + Ra + 0.002, crease: true });
    for (let k = 0; k <= d.arch; k++) list.push({ z: zw + Ra * Math.cos((Math.PI * k) / d.arch), crease: k === d.arch });
    list.push({ z: zw - Ra - 0.002, crease: false });
  }
  list.sort((a, b) => b.z - a.z);
  return list;
}

function buildBody(f: BodyField, d: (typeof DETAIL)[Detail]): { body: THREE.BufferGeometry; walls: THREE.BufferGeometry } {
  const stations = bodyStations(f, d);
  const counts: Counts = { rocker: d.rocker, side: d.side, shoulder: d.shoulder, top: d.top };
  const rings: { x: number[]; y: number[]; dark: number[] }[] = [];
  for (const st of stations) {
    const o = f.outline(f.section(st.z), counts);
    const M = o.x.length;
    const x = o.x.slice();
    const y = o.y.slice();
    const dk = o.dark.slice();
    for (let j = M - 2; j >= 1; j--) {
      x.push(-o.x[j]);
      y.push(o.y[j]);
      dk.push(o.dark[j]);
    }
    rings.push({ x, y, dark: dk });
  }
  const RS = rings[0].x.length;
  const pos: number[] = [];
  const col: number[] = [];
  stations.forEach((st, i) => {
    const r = rings[i];
    for (let j = 0; j < RS; j++) {
      pos.push(r.x[j], r.y[j], st.z);
      const c = r.dark[j] ? DARK : 1;
      col.push(c, c, c);
    }
  });
  const index: number[] = [];
  const wallPos: number[] = [];
  const P = (i: number, j: number) => [pos[(i * RS + j) * 3], pos[(i * RS + j) * 3 + 1], pos[(i * RS + j) * 3 + 2]];
  for (let i = 0; i < stations.length - 1; i++) {
    for (let j = 0; j < RS; j++) {
      const j2 = (j + 1) % RS;
      const a = i * RS + j;
      const b = i * RS + j2;
      const c = (i + 1) * RS + j;
      const e = (i + 1) * RS + j2;
      if (stations[i].crease) {
        const ra = rings[i];
        const rb = rings[i + 1];
        const moved = Math.abs(ra.y[j] - rb.y[j]) > 0.003 || Math.abs(ra.y[j2] - rb.y[j2]) > 0.003;
        if (moved) {
          wallPos.push(...P(i, j), ...P(i + 1, j), ...P(i, j2), ...P(i, j2), ...P(i + 1, j), ...P(i + 1, j2));
          continue;
        }
      }
      index.push(a, c, b, b, c, e);
    }
  }
  // End caps (bumper faces), fanned from the centroid.
  const cap = (i: number, sign: 1 | -1) => {
    const r = rings[i];
    const z = stations[i].z;
    let cx = 0;
    let cy = 0;
    for (let j = 0; j < RS; j++) {
      cx += r.x[j];
      cy += r.y[j];
    }
    cx /= RS;
    cy /= RS;
    for (let j = 0; j < RS; j++) {
      const j2 = (j + 1) % RS;
      const tri = [r.x[j], r.y[j], z, cx, cy, z, r.x[j2], r.y[j2], z];
      if (sign < 0) wallPos.push(...tri);
      else wallPos.push(tri[0], tri[1], tri[2], tri[6], tri[7], tri[8], tri[3], tri[4], tri[5]);
    }
  };
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  body.setIndex(index);
  body.computeVertexNormals();
  // Make sure the faces point outwards (check the widest point of the first full-width ring).
  const mid = Math.floor(stations.length / 2) * RS + f.outline(f.section(stations[Math.floor(stations.length / 2)].z), counts).widest;
  if (body.attributes.normal.getX(mid) < 0) {
    const idx = body.index!.array as Uint32Array | Uint16Array;
    for (let t = 0; t < idx.length; t += 3) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
    body.index!.needsUpdate = true;
    body.computeVertexNormals();
    // Walls were emitted with the same (reversed) convention.
    for (let t = 0; t < wallPos.length; t += 9) {
      for (let q = 0; q < 3; q++) {
        const tmp = wallPos[t + 3 + q];
        wallPos[t + 3 + q] = wallPos[t + 6 + q];
        wallPos[t + 6 + q] = tmp;
      }
    }
  }
  cap(0, 1);
  cap(stations.length - 1, -1);
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  walls.computeVertexNormals();
  // Arch walls are dark; caps are painted. Colour by facing: caps face ±z and sit at the ends.
  const wc = new Float32Array(wallPos.length);
  for (let v = 0; v < wallPos.length / 3; v++) {
    const z = wallPos[v * 3 + 2];
    const atEnd = Math.abs(Math.abs(z) - f.L / 2) < 1e-4;
    const c = atEnd ? 1 : DARK;
    wc[v * 3] = wc[v * 3 + 1] = wc[v * 3 + 2] = c;
  }
  walls.setAttribute('color', new THREE.BufferAttribute(wc, 3));
  return { body, walls };
}

// --- Decals that hug the body --------------------------------------------------------------------

interface DecalSpec {
  from: 'front' | 'rear';
  /** Distance range from that end of the car. */
  d0: number;
  d1: number;
  /** Arc-length range (m) measured from the anchor point, positive = upwards around the section. */
  a0: number;
  a1: number;
  /** Extra arc offset at d1 (lets a light sweep up the fender). */
  sweep?: number;
  /** Superellipse exponent that rounds the ends (2 = ellipse, large = rectangle). */
  round?: number;
  offset: number;
  anchor?: 'widest' | 'rocker';
  nu?: number;
  nv?: number;
}

function decal(f: BodyField, spec: DecalSpec, res: number): THREE.BufferGeometry {
  const nu = spec.nu ?? res;
  const nv = spec.nv ?? Math.max(2, Math.round(res / 2));
  const p = spec.round ?? 6;
  const grid: THREE.Vector3[][] = [];
  for (let iu = 0; iu <= nu; iu++) {
    const u = iu / nu;
    const d = lerp(spec.d0, spec.d1, u);
    const z = spec.from === 'front' ? f.L / 2 - d : -f.L / 2 + d;
    const o = f.outline(f.section(z), DECAL_COUNTS);
    const cum: number[] = [0];
    for (let i = 1; i < o.x.length; i++) cum.push(cum[i - 1] + Math.hypot(o.x[i] - o.x[i - 1], o.y[i] - o.y[i - 1]));
    const base = cum[spec.anchor === 'rocker' ? o.rocker : o.widest];
    const um = u * 2 - 1;
    const half = Math.max(0.002, ((spec.a1 - spec.a0) / 2) * se(Math.abs(um), p));
    const ac = (spec.a0 + spec.a1) / 2 + (spec.sweep ?? 0) * u;
    const row: THREE.Vector3[] = [];
    for (let iv = 0; iv <= nv; iv++) {
      const a = base + ac - half + (2 * half * iv) / nv;
      const s = Math.min(cum[cum.length - 1], Math.max(0, a));
      let k = 1;
      while (k < cum.length - 1 && cum[k] < s) k++;
      const t = (s - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
      row.push(new THREE.Vector3(lerp(o.x[k - 1], o.x[k], t), lerp(o.y[k - 1], o.y[k], t), z));
    }
    grid.push(row);
  }
  // Normals from the grid (du x dv points outwards when z decreases with u).
  const flip = spec.from === 'rear' ? -1 : 1;
  const nrm: THREE.Vector3[][] = grid.map((row, iu) =>
    row.map((_, iv) => {
      const a = grid[Math.min(nu, iu + 1)][iv].clone().sub(grid[Math.max(0, iu - 1)][iv]);
      const b = grid[iu][Math.min(nv, iv + 1)].clone().sub(grid[iu][Math.max(0, iv - 1)]);
      const n = a.cross(b).multiplyScalar(flip);
      if (n.lengthSq() < 1e-12) n.set(1, 0, 0);
      return n.normalize();
    }),
  );
  const pos: number[] = [];
  const nor: number[] = [];
  const vtx = (iu: number, iv: number) => {
    const q = grid[iu][iv];
    const n = nrm[iu][iv];
    pos.push(q.x + n.x * spec.offset, q.y + n.y * spec.offset, q.z + n.z * spec.offset);
    nor.push(n.x, n.y, n.z);
  };
  for (let iu = 0; iu < nu; iu++) {
    for (let iv = 0; iv < nv; iv++) {
      if (flip > 0) {
        vtx(iu, iv), vtx(iu + 1, iv), vtx(iu, iv + 1);
        vtx(iu, iv + 1), vtx(iu + 1, iv), vtx(iu + 1, iv + 1);
      } else {
        vtx(iu, iv), vtx(iu, iv + 1), vtx(iu + 1, iv);
        vtx(iu, iv + 1), vtx(iu + 1, iv + 1), vtx(iu + 1, iv);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const both = mergeGeometries([g, mirrorX(g)], false)!;
  g.dispose();
  return both;
}

// --- Greenhouse -------------------------------------------------------------------------------

interface Greenhouse {
  glass: THREE.BufferGeometry;
  paint: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  seal: THREE.BufferGeometry;
  /** Cabin base line (for mirrors). */
  baseAt: (z: number) => { y: number; hw: number };
  cf: number;
  ct: number;
  slopeF: number;
  slopeR: number;
}

function buildGreenhouse(f: BodyField, d: (typeof DETAIL)[Detail]): Greenhouse {
  const s = f.s;
  const L = f.L;
  const tune = f.tune;
  const cf = L / 2 - s.cabinFrom * L;
  const ct = L / 2 - s.cabinTo * L;
  const cabinLen = cf - ct;
  const slopeF = cabinLen * (s.style === 'hyper' ? 0.42 : s.style === 'bubble' ? 0.34 : 0.3);
  const slopeR = cabinLen * (s.style === 'wagon' || s.style === 'hatch' ? 0.08 : s.style === 'hyper' ? 0.38 : s.style === 'bubble' ? 0.24 : 0.28);
  const roofY = s.roofHeight;
  const cw = (f.W * s.cabinWidth) / 2;
  const baseAt = (z: number) => {
    const c = f.section(z);
    const hw = Math.min(cw, c.xs + 0.01);
    return { y: f.topY(c, hw) - 0.008, hw };
  };
  // Stations: windshield, roof and rear window get their share, with exact region boundaries.
  const nW = Math.max(3, Math.round(d.gh * 0.35));
  const nB = Math.max(2, Math.round(d.gh * 0.25));
  const nR = Math.max(2, d.gh - nW - nB);
  const zs: number[] = [];
  const zW = cf - slopeF;
  const zB = ct + slopeR;
  for (let i = 0; i < nW; i++) zs.push(lerp(cf, zW, i / nW));
  for (let i = 0; i < nR; i++) zs.push(lerp(zW, zB, i / nR));
  for (let i = 0; i <= nB; i++) zs.push(lerp(zB, ct, i / nB));
  const heightAt = (z: number, base: number) => {
    if (z > zW) {
      const u = (cf - z) / slopeF;
      return base + (roofY - base) * (1 - Math.pow(1 - u, 1.3));
    }
    if (z >= zB) return roofY + 0.015 * Math.sin((Math.PI * (zW - z)) / Math.max(0.01, zW - zB));
    const u = (z - ct) / slopeR;
    return base + (roofY - base) * (1 - Math.pow(1 - u, 1.35));
  };
  const KS = d.ghSide;
  const KC = d.ghCorner;
  const KR = d.ghRoof;
  const M = 1 + KS + KC + KR; // right half incl. base and centre
  const rows: THREE.Vector3[][] = [];
  for (const z of zs) {
    const b = baseAt(z);
    const h = Math.max(b.y, heightAt(z, b.y));
    const H = h - b.y;
    const tw = b.hw * tune.tumble;
    const rr = Math.min(0.11, H * 0.45, tw * 0.4);
    const right: THREE.Vector3[] = [];
    for (let k = 0; k <= KS; k++) {
      const v = k / KS;
      right.push(new THREE.Vector3(lerp(b.hw, tw, Math.pow(v, 1.25)), b.y + (H - rr) * v, z));
    }
    for (let k = 1; k <= KC; k++) {
      const a = (k / KC) * (Math.PI / 2);
      right.push(new THREE.Vector3(tw - rr + rr * Math.cos(a), b.y + H - rr + rr * Math.sin(a), z));
    }
    for (let k = 1; k <= KR; k++) {
      const x = (tw - rr) * (1 - k / KR);
      right.push(new THREE.Vector3(x, h + 0.01 * (1 - (x / Math.max(0.01, tw)) ** 2) * Math.min(1, H * 4), z));
    }
    const row: THREE.Vector3[] = [];
    for (let k = 0; k < M - 1; k++) row.push(new THREE.Vector3(-right[k].x, right[k].y, z));
    for (let k = M - 1; k >= 0; k--) row.push(right[k]);
    rows.push(row);
  }
  const RS = 2 * M - 1;
  const pos: number[] = [];
  for (const row of rows) for (const p of row) pos.push(p.x, p.y, p.z);
  type Kind = 'glass' | 'paint' | 'roof' | 'seal';
  const quads: { a: number; b: number; c: number; e: number; kind: Kind }[] = [];
  const all: number[] = [];
  const zPillarB = lerp(zW, zB, s.style === 'wagon' ? 0.45 : 0.62);
  for (let i = 0; i < rows.length - 1; i++) {
    const zc = (zs[i] + zs[i + 1]) / 2;
    for (let j = 0; j < RS - 1; j++) {
      // Right-half segment index (segment k joins points k and k+1), mirror-symmetric.
      const k = j < M - 1 ? j : 2 * M - 3 - j;
      const part = k < KS ? 'side' : k < KS + KC ? 'corner' : 'roof';
      let kind: Kind = 'glass';
      if (k === 0) kind = 'seal';
      else if (zc > zW) kind = part === 'corner' ? 'paint' : 'glass';
      else if (zc >= zB) {
        if (part !== 'side') kind = 'roof';
        else if (s.style !== 'hyper' && Math.abs(zc - zPillarB) < 0.045) kind = 'seal';
        else if (tune.doors === 4 && Math.abs(zc - lerp(zW, zB, 0.9)) < 0.03) kind = 'seal';
      } else if (part === 'corner' || (part === 'side' && tune.fastback)) kind = 'paint';
      // Rows run front to back and each row goes left -> right over the roof, so (a, b, c)
      // winds outwards.
      const a = i * RS + j;
      const b = i * RS + j + 1;
      const c = (i + 1) * RS + j;
      const e = (i + 1) * RS + j + 1;
      all.push(a, b, c, b, e, c);
      quads.push({ a, b, c, e, kind });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(all);
  g.computeVertexNormals();
  const P = g.attributes.position;
  const N = g.attributes.normal;
  const make = (kind: Kind, inset: number) => {
    const out: number[] = [];
    const nor: number[] = [];
    const v = (idx: number) => {
      const nx = N.getX(idx);
      const ny = N.getY(idx);
      const nz = N.getZ(idx);
      out.push(P.getX(idx) - nx * inset, P.getY(idx) - ny * inset, P.getZ(idx) - nz * inset);
      nor.push(nx, ny, nz);
    };
    for (const q of quads) {
      if (q.kind !== kind) continue;
      v(q.a), v(q.b), v(q.c), v(q.b), v(q.e), v(q.c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return geo;
  };
  const res = { glass: make('glass', 0.009), paint: make('paint', 0), roof: make('roof', 0), seal: make('seal', 0.002), baseAt, cf, ct, slopeF, slopeR };
  g.dispose();
  return res;
}

// --- Wheels -----------------------------------------------------------------------------------

function tyreGeometry(r: number, ww: number, segs: number): THREE.BufferGeometry {
  const rimR = r * 0.68;
  const pts = [
    [rimR * 0.98, -ww * 0.46],
    [r * 0.84, -ww * 0.5],
    [r * 0.95, -ww * 0.47],
    [r * 0.995, -ww * 0.4],
    [r, -ww * 0.3],
    [r, 0],
    [r, ww * 0.3],
    [r * 0.995, ww * 0.4],
    [r * 0.95, ww * 0.47],
    [r * 0.84, ww * 0.5],
    [rimR * 0.98, ww * 0.46],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  const g = new THREE.LatheGeometry(pts, segs);
  // Lathe axis is Y; wheels spin around X.
  g.rotateZ(-Math.PI / 2);
  return g;
}

function spokeShape(style: RimStyle, rimR: number, i: number, count: number): THREE.Shape[] {
  const hub = rimR * 0.3;
  const out = rimR * 0.97;
  const ang = (i / count) * Math.PI * 2;
  const shapes: THREE.Shape[] = [];
  const quad = (a: number, w0: number, w1: number, bend = 0) => {
    const s = new THREE.Shape();
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const P = (rad: number, off: number) => new THREE.Vector2(c * rad - sn * off, sn * rad + c * off);
    const p0 = P(hub, -w0 / 2);
    const p1 = P(out, -w1 / 2 + bend);
    const p2 = P(out, w1 / 2 + bend);
    const p3 = P(hub, w0 / 2);
    s.moveTo(p0.x, p0.y);
    if (bend) {
      const m = P((hub + out) / 2, bend * 0.2 - w0 / 2);
      s.quadraticCurveTo(m.x, m.y, p1.x, p1.y);
    } else s.lineTo(p1.x, p1.y);
    s.lineTo(p2.x, p2.y);
    if (bend) {
      const m = P((hub + out) / 2, bend * 0.2 + w0 / 2);
      s.quadraticCurveTo(m.x, m.y, p3.x, p3.y);
    } else s.lineTo(p3.x, p3.y);
    s.closePath();
    return s;
  };
  switch (style) {
    case 'five':
      shapes.push(quad(ang, rimR * 0.3, rimR * 0.2));
      break;
    case 'multi':
      shapes.push(quad(ang, rimR * 0.13, rimR * 0.1));
      break;
    case 'mesh':
      shapes.push(quad(ang - 0.14, rimR * 0.08, rimR * 0.07), quad(ang + 0.14, rimR * 0.08, rimR * 0.07));
      break;
    case 'turbine':
      shapes.push(quad(ang, rimR * 0.12, rimR * 0.16, rimR * 0.22));
      break;
    default:
      break;
  }
  return shapes;
}

function rimGeometry(style: RimStyle, r: number, ww: number, segs: number, detail: Detail): THREE.BufferGeometry {
  const rimR = r * 0.68;
  const parts: THREE.BufferGeometry[] = [];
  const face = ww * 0.3;
  // Barrel (seen through the spokes) and outer lip.
  const barrel = new THREE.CylinderGeometry(rimR * 0.97, rimR * 0.97, ww * 0.8, segs, 1, true);
  barrel.rotateZ(Math.PI / 2);
  parts.push(barrel);
  const lip = new THREE.TorusGeometry(rimR * 0.985, 0.014, 5, segs);
  lip.rotateY(Math.PI / 2);
  lip.translate(face + 0.02, 0, 0);
  parts.push(lip);
  const faceDepth = 0.035;
  const addShape = (sh: THREE.Shape) => {
    const g = new THREE.ExtrudeGeometry(sh, { depth: faceDepth, bevelEnabled: detail !== 'low', bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1, curveSegments: detail === 'low' ? 4 : 8 });
    // Shape plane (x, y) -> wheel plane (z, y); extrusion -> +x (outwards).
    g.rotateY(Math.PI / 2);
    g.translate(face - faceDepth / 2, 0, 0);
    parts.push(g);
  };
  const count = style === 'five' ? 5 : style === 'multi' ? 10 : style === 'mesh' ? 8 : style === 'turbine' ? 14 : 0;
  if (style === 'dish') {
    const disc = new THREE.Shape();
    disc.absarc(0, 0, rimR * 0.95, 0, Math.PI * 2, false);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const h = new THREE.Path();
      h.absarc(Math.cos(a) * rimR * 0.6, Math.sin(a) * rimR * 0.6, rimR * 0.17, 0, Math.PI * 2, true);
      disc.holes.push(h);
    }
    addShape(disc);
  } else {
    for (let i = 0; i < count; i++) for (const sh of spokeShape(style, rimR, i, count)) addShape(sh);
  }
  // Hub + centre cap.
  const hub = new THREE.CylinderGeometry(rimR * 0.3, rimR * 0.32, 0.05, Math.max(10, segs / 2));
  hub.rotateZ(Math.PI / 2);
  hub.translate(face, 0, 0);
  parts.push(hub);
  const cap = new THREE.CylinderGeometry(rimR * 0.12, rimR * 0.14, 0.03, 10);
  cap.rotateZ(Math.PI / 2);
  cap.translate(face + 0.035, 0, 0);
  parts.push(cap);
  if (detail === 'ultra') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const nut = new THREE.CylinderGeometry(0.011, 0.011, 0.03, 6);
      nut.rotateZ(Math.PI / 2);
      nut.translate(face + 0.03, Math.cos(a) * rimR * 0.2, Math.sin(a) * rimR * 0.2);
      parts.push(nut);
    }
  }
  const merged = mergeGeometries(parts.map((p) => forPlain(p)), false)!;
  return merged;
}

/** Brake disc + caliper, mounted on the steering pivot (they don't spin). Vertex-coloured. */
function brakeGeometry(r: number, ww: number, segs: number, caliper: string): THREE.BufferGeometry {
  const rimR = r * 0.68;
  const colour = (g: THREE.BufferGeometry, c: THREE.Color) => {
    const ng = forPlain(g);
    const n = ng.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(a, i * 3);
    ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return ng;
  };
  const disc = new THREE.CylinderGeometry(rimR * 0.8, rimR * 0.8, 0.026, segs, 1);
  disc.rotateZ(Math.PI / 2);
  disc.translate(ww * 0.05, 0, 0);
  const hat = new THREE.CylinderGeometry(rimR * 0.36, rimR * 0.36, 0.05, 12, 1);
  hat.rotateZ(Math.PI / 2);
  hat.translate(ww * 0.08, 0, 0);
  const sh = new THREE.Shape();
  // Shape x maps to -z after the rotation below, so these angles put the caliper at the rear-top.
  const a0 = Math.PI * 0.05;
  const a1 = Math.PI * 0.38;
  sh.absarc(0, 0, rimR * 0.9, a0, a1, false);
  sh.absarc(0, 0, rimR * 0.58, a1, a0, true);
  const cal = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: false, curveSegments: 6 });
  // Shape (x, y) -> wheel plane (z, y); angles are measured from +z (forward) towards +y (up).
  cal.rotateY(Math.PI / 2);
  cal.translate(ww * 0.05 - 0.035, 0, 0);
  const g = mergeGeometries([colour(disc, new THREE.Color('#8b8f98')), colour(hat, new THREE.Color('#5a5e66')), colour(cal, new THREE.Color(caliper))], false)!;
  return g;
}

// --- Paint shader: painted stripes + panel seams ------------------------------------------------

interface PaintUniforms {
  uAccent: { value: THREE.Color };
  uStripe: { value: THREE.Vector4 };
  uSeams: { value: THREE.Vector4 };
  uBelt: { value: THREE.Vector2 };
}

function decoratePaint(mat: THREE.MeshStandardMaterial, u: PaintUniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCarP;\nvarying vec3 vCarN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarP = position;\nvCarN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
varying vec3 vCarP;
varying vec3 vCarN;
uniform vec3 uAccent;
uniform vec4 uStripe;
uniform vec4 uSeams;
uniform vec2 uBelt;
float carBand(float x, float c, float w) {
  float f = fwidth(x) + 1e-4;
  return 1.0 - smoothstep(w - f, w + f, abs(x - c));
}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
{
  vec3 cn = normalize(vCarN);
  float st = 0.0;
  if (uStripe.x > 0.5 && uStripe.x < 1.5) {
    st = (carBand(vCarP.x, uStripe.z + uStripe.y * 0.5, uStripe.y * 0.5) + carBand(vCarP.x, -uStripe.z - uStripe.y * 0.5, uStripe.y * 0.5)) * smoothstep(0.3, 0.5, cn.y);
  } else if (uStripe.x > 1.5 && uStripe.x < 2.5) {
    st = carBand(vCarP.x, 0.0, uStripe.y * 0.5) * smoothstep(0.3, 0.5, cn.y);
  } else if (uStripe.x > 2.5) {
    st = carBand(vCarP.y, uStripe.w, uStripe.y * 0.5) * smoothstep(0.55, 0.75, abs(cn.x));
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, uAccent * vColor.rgb, clamp(st, 0.0, 1.0));
  float onSide = smoothstep(0.55, 0.8, abs(cn.x)) * step(uBelt.x, vCarP.y) * step(vCarP.y, uBelt.y);
  float seam = (carBand(vCarP.z, uSeams.x, 0.0035) + carBand(vCarP.z, uSeams.y, 0.0035)) * onSide;
  seam += carBand(vCarP.z, uSeams.z, 0.0035) * smoothstep(0.6, 0.85, cn.y) * step(abs(vCarP.x), uSeams.w);
  diffuseColor.rgb *= 1.0 - 0.65 * clamp(seam, 0.0, 1.0);
}`,
      );
  };
  mat.customProgramCacheKey = () => 'prism-car-paint-1';
}

// --- The car ----------------------------------------------------------------------------------

export function buildCarModel(def: CarDef, color: string, quality: Quality = 'high'): CarVisual {
  const s = def.shape;
  const detail: Detail = quality === 'low' ? 'low' : quality === 'ultra' ? 'ultra' : 'high';
  const D = DETAIL[detail];
  const pbr = quality !== 'low';
  const L = s.length;
  const W = s.width;
  const f = new BodyField(s);
  const root = new THREE.Group();
  root.name = def.id;
  const body = new THREE.Group();
  root.add(body);

  // Materials.
  const atlas = detailAtlas();
  const paint: THREE.MeshStandardMaterial = pbr
    ? new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.3, vertexColors: true })
    : new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.3, envMapIntensity: 1.25, vertexColors: true });
  const paintU: PaintUniforms = {
    uAccent: { value: new THREE.Color(s.accent) },
    uStripe: { value: new THREE.Vector4() },
    uSeams: { value: new THREE.Vector4() },
    uBelt: { value: new THREE.Vector2() },
  };
  decoratePaint(paint, paintU);
  const accent = new THREE.MeshStandardMaterial({ color: s.accent, metalness: 0.3, roughness: 0.3, envMapIntensity: 1.2 });
  const detailMat = new THREE.MeshStandardMaterial({
    color: atlas ? '#ffffff' : '#1a1b24',
    map: atlas?.map ?? null,
    roughnessMap: atlas?.orm ?? null,
    metalnessMap: atlas?.orm ?? null,
    roughness: atlas ? 1 : 0.5,
    metalness: atlas ? 1 : 0.2,
    envMapIntensity: 1.3,
  });
  const glass = pbr
    ? new THREE.MeshPhysicalMaterial({ color: '#0c1220', metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2 })
    : new THREE.MeshStandardMaterial({ color: '#1c2a4a', metalness: 0.7, roughness: 0.08, envMapIntensity: 1.8 });
  const headLights = new THREE.MeshStandardMaterial({ color: '#f4f8ff', emissive: '#fff4d8', emissiveIntensity: 1.6, roughness: 0.12, metalness: 0.2 });
  const tailLights = new THREE.MeshStandardMaterial({ color: '#ff2a4a', emissive: '#ff1030', emissiveIntensity: 0.9, roughness: 0.25 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: '#17171c', roughness: 0.88, metalness: 0, normalMap: pbr ? tyreNormalMap() : null, normalScale: new THREE.Vector2(0.9, 0.9) });
  const rimMat = new THREE.MeshStandardMaterial({ color: s.rimColor, metalness: 0.85, roughness: 0.26, envMapIntensity: 1.4, side: THREE.DoubleSide });
  const brakeMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.7, roughness: 0.35 });

  const paintParts: THREE.BufferGeometry[] = [];
  const accentParts: THREE.BufferGeometry[] = [];
  const detailParts: THREE.BufferGeometry[] = [];
  const glassParts: THREE.BufferGeometry[] = [];
  const headParts: THREE.BufferGeometry[] = [];
  const tailParts: THREE.BufferGeometry[] = [];

  // --- Body shell -----------------------------------------------------------------------------
  const shell = buildBody(f, D);
  paintParts.push(forPaint(shell.body), forPaint(shell.walls));
  const front = f.section(L / 2);
  const rear = f.section(-L / 2);
  const capTopF = f.topY(front, 0);
  const archF = f.axles[0];
  const archR = f.axles[1];
  const Ra = f.Ra;

  // --- Greenhouse -------------------------------------------------------------------------------
  const gh = buildGreenhouse(f, D);
  glassParts.push(forPlain(gh.glass));
  paintParts.push(forPaint(gh.paint));
  const roofKind = s.roof ?? 'paint';
  if (roofKind === 'accent') accentParts.push(forPlain(gh.roof));
  else if (roofKind === 'black') detailParts.push(forDetail(gh.roof, ATLAS.gloss));
  else paintParts.push(forPaint(gh.roof));
  detailParts.push(forDetail(gh.seal, ATLAS.gloss));

  // Mirrors: body-coloured housings on black stalks just behind the A-pillar base.
  {
    const mz = gh.cf - gh.slopeF * 0.22;
    const b = gh.baseAt(mz);
    for (const side of [-1, 1]) {
      const housing = new THREE.SphereGeometry(1, detail === 'low' ? 8 : 14, detail === 'low' ? 6 : 10);
      housing.scale(0.09, 0.05, 0.075);
      paintParts.push(forPaint(place(housing, side * (b.hw + 0.12), b.y + 0.1, mz)));
      const stalk = new THREE.BoxGeometry(0.1, 0.025, 0.05);
      detailParts.push(forDetail(place(stalk, side * (b.hw + 0.05), b.y + 0.07, mz), ATLAS.plastic));
    }
  }

  // --- Front end: grille, splitter, plate, headlights ----------------------------------------
  const capHW = front.hw;
  const capH = capTopF - f.yb;
  {
    const gw = capHW * 2 * (s.style === 'hyper' ? 0.7 : 0.62);
    const gHt = Math.min(0.18, capH * 0.55);
    const gy = f.yb + capH * 0.4;
    const grille = panel(roundRect(gw, gHt, gHt * 0.35), 0, gy, L / 2 + 0.006, 1, 0.01);
    detailParts.push(forDetail(grille, ATLAS.grille, 'xy'));
    if (s.style !== 'hyper' && s.style !== 'bubble') {
      const frame = roundRect(gw + 0.05, gHt + 0.04, gHt * 0.4);
      frame.holes.push(roundRect(gw, gHt, gHt * 0.35));
      detailParts.push(forDetail(panel(frame, 0, gy, L / 2 + 0.01, 1, 0.012), ATLAS.chrome));
    }
    // Splitter lip.
    const split = new THREE.BoxGeometry(capHW * 2 * 0.96, 0.025, 0.12);
    detailParts.push(forDetail(place(split, 0, f.yb + 0.012, L / 2 - 0.02), s.style === 'drift' || s.style === 'hyper' ? ATLAS.carbon : ATLAS.plastic));
    // Front plate on the lower bumper.
    const plateY = gy - gHt / 2 - 0.065;
    if ((s.style === 'wagon' || s.style === 'hatch') && plateY - 0.045 > f.yb + 0.02) {
      const plate = panel(roundRect(0.34, 0.09, 0.015), 0, plateY, L / 2 + 0.008, 1, 0.006);
      detailParts.push(forDetail(plate, ATLAS.plate, 'xy'));
    }
  }
  const res = D.decal;
  const lights = (spec: Omit<DecalSpec, 'offset'>, lens: THREE.BufferGeometry[]) => {
    detailParts.push(forDetail(decal(f, { ...spec, d0: Math.max(0.004, spec.d0 - 0.012), d1: spec.d1 + 0.015, a0: spec.a0 - 0.014, a1: spec.a1 + 0.014, offset: 0.004 }, res), ATLAS.gloss));
    lens.push(forPlain(decal(f, { ...spec, offset: 0.008 }, res)));
  };
  if (s.lightStyle === 'round') {
    lights({ from: 'front', d0: 0.02, d1: 0.17, a0: -0.02, a1: 0.11, round: 2 }, headParts);
    lights({ from: 'front', d0: 0.2, d1: 0.33, a0: -0.01, a1: 0.1, round: 2 }, headParts);
  } else if (s.lightStyle === 'wide') {
    lights({ from: 'front', d0: 0.02, d1: 0.34, a0: -0.01, a1: 0.09, sweep: 0.04, round: 4 }, headParts);
  } else {
    lights({ from: 'front', d0: 0.015, d1: 0.46, a0: 0.02, a1: 0.065, sweep: 0.07, round: 8 }, headParts);
  }

  // --- Rear end: light bar, plate, diffuser, exhausts ---------------------------------------
  const rearHW = rear.hw;
  {
    lights({ from: 'rear', d0: 0.012, d1: 0.24, a0: -0.045, a1: 0.035, round: 6 }, tailParts);
    const barY = rear.ys - 0.005;
    const barW = rearHW * 2 * 0.94;
    const housing = panel(roundRect(barW + 0.03, 0.09, 0.03), 0, barY, -L / 2 - 0.004, -1, 0.008);
    detailParts.push(forDetail(housing, ATLAS.gloss));
    const bar = panel(roundRect(barW, s.style === 'bubble' || s.style === 'hyper' ? 0.035 : 0.06, 0.02), 0, barY, -L / 2 - 0.009, -1, 0.006);
    tailParts.push(forPlain(bar));
    const plateY = Math.max(f.yb + 0.12, barY - 0.13);
    if (plateY + 0.05 < barY - 0.04) detailParts.push(forDetail(panel(roundRect(0.34, 0.09, 0.015), 0, plateY, -L / 2 - 0.006, -1, 0.006), ATLAS.plate, 'xy', true));
    // Diffuser fins.
    const plate = new THREE.BoxGeometry(rearHW * 2 * 0.8, 0.02, 0.28);
    detailParts.push(forDetail(place(plate, 0, f.yb + 0.01, -L / 2 + 0.14), ATLAS.plastic));
    for (let i = -2; i <= 2; i++) {
      const fin = new THREE.BoxGeometry(0.012, 0.07, 0.26);
      detailParts.push(forDetail(place(fin, i * rearHW * 0.3, f.yb + 0.035, -L / 2 + 0.13), s.style === 'drift' || s.style === 'hyper' ? ATLAS.carbon : ATLAS.plastic));
    }
  }

  // --- Skirts and vents ---------------------------------------------------------------------
  {
    const d0 = L / 2 - (archF - Ra) + 0.03;
    const d1 = L / 2 - (archR + Ra) - 0.03;
    if (d1 > d0 + 0.2) detailParts.push(forDetail(decal(f, { from: 'front', d0, d1, a0: 0.0, a1: 0.075, anchor: 'rocker', round: 12, offset: 0.004, nu: 4, nv: 2 }, res), ATLAS.plastic));
    if (s.sideVents) {
      const v0 = s.style === 'hyper' ? L / 2 - (archR + Ra) - 0.6 : d0 + 0.04;
      detailParts.push(forDetail(decal(f, { from: 'front', d0: v0, d1: v0 + (s.style === 'hyper' ? 0.5 : 0.36), a0: -0.12, a1: -0.02, sweep: 0.03, round: 4, offset: 0.004 }, res), ATLAS.gloss));
    }
  }

  // --- Style features -------------------------------------------------------------------------
  const roofWing = s.cabinTo > 0.88;
  const deckZ = roofWing ? gh.ct + 0.12 : -L / 2 + 0.3;
  const deckY = roofWing ? s.roofHeight - 0.03 : f.topY(f.section(deckZ), 0);
  const spoilerY = deckY + (roofWing ? 0.07 : s.spoiler === 'tall' ? 0.36 : 0.2);
  if (s.spoiler === 'wing' || s.spoiler === 'tall') {
    const c = s.spoiler === 'tall' ? 0.4 : 0.34;
    const foil = new THREE.Shape();
    foil.moveTo(c / 2, 0);
    foil.bezierCurveTo(c / 4, 0.05, -c / 4, 0.036, -c / 2, 0.012);
    foil.bezierCurveTo(-c / 4, -0.004, c / 4, -0.012, c / 2, 0);
    const span = W * 0.9;
    const wing = new THREE.ExtrudeGeometry(foil, { depth: span, bevelEnabled: false, curveSegments: 8 });
    wing.translate(0, 0, -span / 2);
    wing.rotateY(-Math.PI / 2);
    place(wing, 0, spoilerY, deckZ, -0.1);
    if (s.spoiler === 'tall') detailParts.push(forDetail(wing, ATLAS.carbon, 'xz'));
    else paintParts.push(forPaint(wing));
    for (const side of [-1, 1]) {
      const ep = new THREE.ExtrudeGeometry(roundRect(c + 0.06, 0.16, 0.04), { depth: 0.012, bevelEnabled: false });
      ep.rotateY(Math.PI / 2);
      accentParts.push(forPlain(place(ep, side * (span / 2 + 0.006), spoilerY + 0.02, deckZ)));
      const post = new THREE.BoxGeometry(0.03, spoilerY - deckY + 0.04, 0.09);
      detailParts.push(forDetail(place(post, side * W * 0.27, (spoilerY + deckY) / 2, deckZ - 0.02, -0.12), ATLAS.satin));
    }
  } else if (s.spoiler === 'lip') {
    const lip = new THREE.Shape();
    lip.moveTo(0, 0);
    lip.lineTo(-0.16, 0);
    lip.lineTo(-0.16, 0.035);
    lip.quadraticCurveTo(-0.08, 0.012, 0, 0.004);
    const span = rearHW * 2 * 0.96;
    const g = new THREE.ExtrudeGeometry(lip, { depth: span, bevelEnabled: false });
    g.translate(0, 0, -span / 2);
    g.rotateY(-Math.PI / 2);
    const lz = -L / 2 + 0.2;
    paintParts.push(forPaint(place(g, 0, f.topY(f.section(lz), 0) - 0.012, lz)));
  } else if (s.spoiler === 'ducktail') {
    const duck = new THREE.Shape();
    duck.moveTo(0.1, 0);
    duck.lineTo(-0.2, 0);
    duck.lineTo(-0.22, 0.09);
    duck.quadraticCurveTo(-0.05, 0.02, 0.1, 0);
    const span = W * s.cabinWidth * 0.9;
    const g = new THREE.ExtrudeGeometry(duck, { depth: span, bevelEnabled: false });
    g.translate(0, 0, -span / 2);
    g.rotateY(-Math.PI / 2);
    paintParts.push(forPaint(place(g, 0, s.roofHeight - 0.01, gh.ct + gh.slopeR + 0.02)));
  }
  if (s.roofScoop) {
    const hood = s.style === 'wagon';
    const sz = hood ? L / 2 - 0.85 : (gh.cf - gh.slopeF + gh.ct + gh.slopeR) / 2;
    const sy = hood ? f.topY(f.section(sz), 0) - 0.01 : s.roofHeight + 0.005;
    const prof = new THREE.Shape();
    prof.moveTo(0.28, 0);
    prof.lineTo(-0.28, 0);
    prof.lineTo(-0.24, 0.1);
    prof.lineTo(0.1, 0.1);
    prof.closePath();
    const sw = hood ? 0.5 : 0.36;
    const g = new THREE.ExtrudeGeometry(prof, { depth: sw, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
    g.translate(0, 0, -sw / 2);
    g.rotateY(-Math.PI / 2);
    paintParts.push(forPaint(place(g, 0, sy, sz)));
    const mouth = panel(roundRect(sw * 0.9, 0.07, 0.02), 0, sy + 0.055, sz + 0.1 + 0.035, 1, 0.01);
    detailParts.push(forDetail(mouth, ATLAS.grille, 'xy'));
  }
  if (s.roofRack) {
    const b = gh.baseAt((gh.cf + gh.ct) / 2);
    const tw = b.hw * f.tune.tumble;
    for (const zz of [-0.35, 0.3]) detailParts.push(forDetail(place(tube(0.02, tw * 2.05).rotateZ(Math.PI / 2), 0, s.roofHeight + 0.09, (gh.cf + gh.ct) / 2 + zz), ATLAS.satin));
    for (const side of [-1, 1]) detailParts.push(forDetail(place(tube(0.022, (gh.cf - gh.slopeF - gh.ct - gh.slopeR) * 0.95).rotateX(Math.PI / 2), side * tw * 0.85, s.roofHeight + 0.05, (gh.cf - gh.slopeF + gh.ct + gh.slopeR) / 2), ATLAS.satin));
  }
  if (s.bullbar) {
    const by = f.yb + capH * 0.55;
    detailParts.push(forDetail(place(tube(0.03, capHW * 1.5).rotateZ(Math.PI / 2), 0, by + 0.12, L / 2 + 0.14), ATLAS.chrome));
    detailParts.push(forDetail(place(tube(0.025, capHW * 1.2).rotateZ(Math.PI / 2), 0, by - 0.05, L / 2 + 0.16), ATLAS.chrome));
    for (const side of [-1, 1]) detailParts.push(forDetail(place(tube(0.028, 0.36), side * capHW * 0.55, by + 0.02, L / 2 + 0.13), ATLAS.chrome));
  }
  if (s.fins) {
    for (const side of [-1, 1]) {
      const fin = new THREE.Shape();
      fin.moveTo(0.3, 0);
      fin.lineTo(-0.36, 0);
      fin.lineTo(-0.4, 0.15);
      fin.quadraticCurveTo(-0.1, 0.05, 0.3, 0);
      const g = new THREE.ExtrudeGeometry(fin, { depth: 0.03, bevelEnabled: false });
      g.translate(0, 0, -0.015);
      g.rotateY(-Math.PI / 2);
      const fz = -L / 2 + 0.75;
      accentParts.push(forPlain(place(g, side * W * 0.33, f.topY(f.section(fz), W * 0.33) - 0.02, fz)));
    }
  }
  // Underbody plate avoids see-through between the wheels.
  detailParts.push(forDetail(place(new THREE.BoxGeometry(W * 0.8, 0.03, L * 0.8), 0, f.yb + 0.018, 0), ATLAS.plastic));

  // --- Paint decoration (stripes + seams) --------------------------------------------------------
  {
    const stripeMode = { none: 0, twin: 1, center: 2, flank: 3 }[s.stripes];
    const mid = f.section(0);
    paintU.uStripe.value.set(stripeMode, s.stripes === 'flank' ? 0.07 : s.stripes === 'center' ? W * 0.22 : W * 0.085, W * 0.035, f.yb + (mid.ys - f.yb) * 0.62);
    const doorF = Math.min(gh.cf - 0.04, archF - Ra - 0.07);
    const doorLen = f.tune.doors === 4 ? 0.95 : 1.15;
    const doorR = Math.max(doorF - doorLen, archR + Ra + 0.07);
    paintU.uSeams.value.set(doorF, doorR, gh.cf + 0.05, mid.xs - 0.06);
    paintU.uBelt.value.set(f.yb + 0.09, gh.baseAt(gh.cf - 0.3).y - 0.02);
  }

  const addMerged = (parts: THREE.BufferGeometry[], mat: THREE.Material, cast = true) => {
    if (!parts.length) return;
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!g) return;
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast;
    m.receiveShadow = false;
    body.add(m);
  };
  addMerged(paintParts, paint);
  addMerged(accentParts, accent);
  addMerged(detailParts, detailMat);
  addMerged(glassParts, glass);
  addMerged(headParts, headLights, false);
  addMerged(tailParts, tailLights, false);

  // --- Wheels ---------------------------------------------------------------------------------
  const r = s.wheelRadius;
  const ww = s.wheelWidth;
  const tyreGeo = tyreGeometry(r, ww, D.tyre);
  const rimGeo = rimGeometry(s.rimStyle, r, ww, D.rim, detail);
  const brakeGeo = detail !== 'low' ? brakeGeometry(r, ww, D.rim, s.caliper ?? '#ff3b3b') : null;
  const wheels: WheelVisual[] = [];
  const track = W / 2 - ww * 0.35;
  for (const isFront of [true, false]) {
    for (const left of [true, false]) {
      const pivot = new THREE.Group();
      pivot.position.set(left ? track : -track, r, isFront ? s.wheelbase / 2 : -s.wheelbase / 2);
      const spin = new THREE.Group();
      pivot.add(spin);
      const t = new THREE.Mesh(tyreGeo, tyreMat);
      t.castShadow = true;
      spin.add(t);
      const rimMesh = new THREE.Mesh(rimGeo, rimMat);
      rimMesh.castShadow = detail !== 'low';
      if (!left) rimMesh.scale.x = -1;
      spin.add(rimMesh);
      if (brakeGeo) {
        const b = new THREE.Mesh(brakeGeo, brakeMat);
        if (!left) b.scale.x = -1;
        pivot.add(b);
      }
      root.add(pivot);
      wheels.push({ pivot, spin, front: isFront, left });
    }
  }

  // --- Exhausts + boost flames ------------------------------------------------------------------
  const flameMat = new THREE.MeshBasicMaterial({ color: '#7fdcff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  // Hot white core at the nozzle, shock diamonds along the plume, soft fade to the tip.
  flameMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vFlameT;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlameT = -position.z;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFlameT;').replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        float t = clamp(vFlameT, 0.0, 1.0);
        float core = 1.0 - smoothstep(0.0, 0.35, t);
        float diamonds = pow(0.5 + 0.5 * cos(t * 31.0), 8.0) * (1.0 - t) * step(0.08, t);
        float a = pow(1.0 - t, 1.4);
        diffuseColor.rgb = (diffuseColor.rgb * (0.7 + 1.2 * diamonds) + vec3(1.0, 0.95, 0.9) * core) * 1.6;
        diffuseColor.a *= a;
      }`,
    );
  };
  flameMat.customProgramCacheKey = () => 'prism-flame-1';
  const flameGeo = new THREE.ConeGeometry(0.13, 1, 10, 1, true);
  flameGeo.rotateX(-Math.PI / 2);
  flameGeo.translate(0, 0, -0.5);
  const exhausts: THREE.Vector3[] = [];
  const flames: THREE.Mesh[] = [];
  const pipes: THREE.BufferGeometry[] = [];
  const tips: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const pos = new THREE.Vector3(side * rearHW * 0.62, f.yb + 0.08, -L / 2 - 0.04);
    exhausts.push(pos);
    if (def.engine.cylinders > 0) {
      const outer = new THREE.CylinderGeometry(0.062, 0.055, 0.14, detail === 'low' ? 8 : 16, 1, true).rotateX(Math.PI / 2);
      pipes.push(forDetail(place(outer, pos.x, pos.y, pos.z + 0.05), ATLAS.chrome));
      const inner = new THREE.CircleGeometry(0.056, 12).rotateY(Math.PI);
      tips.push(forDetail(place(inner, pos.x, pos.y, pos.z + 0.03), ATLAS.gloss));
    }
    const fl = new THREE.Mesh(flameGeo, flameMat);
    fl.position.copy(pos);
    fl.visible = false;
    fl.renderOrder = 5;
    body.add(fl);
    flames.push(fl);
  }
  if (pipes.length) {
    const g = mergeGeometries([...pipes, ...tips], false);
    if (g) {
      body.add(new THREE.Mesh(g, detailMat));
    }
    for (const p of [...pipes, ...tips]) p.dispose();
  }

  // Soft blob shadow: grounds every car even when shadow maps are off or far away.
  const blobMat = new THREE.MeshBasicMaterial({ map: typeof document !== 'undefined' ? softDotTexture() : null, color: '#000000', transparent: true, opacity: 0.42, depthWrite: false });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.35, L * 1.15).rotateX(-Math.PI / 2), blobMat);
  blob.position.y = 0.04;
  blob.renderOrder = 1;
  root.add(blob);

  const rearContacts = [new THREE.Vector3(track, 0.05, -s.wheelbase / 2), new THREE.Vector3(-track, 0.05, -s.wheelbase / 2)];

  const allMats = [paint, accent, detailMat, glass, headLights, tailLights, tyreMat, rimMat, brakeMat];
  return {
    root,
    body,
    wheels,
    paint,
    tailLights,
    headLights,
    flames,
    flameMat,
    exhausts,
    rearContacts,
    shape: s,
    accentStripe: paintU.uAccent.value,
    setColor(c: string) {
      paint.color.set(c);
    },
    setOpacity(o: number) {
      for (const m of allMats) {
        m.transparent = o < 1;
        m.opacity = o;
        m.depthWrite = o >= 1;
      }
      blobMat.opacity = 0.42 * o;
    },
    dispose() {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const m of allMats) m.dispose();
      flameMat.dispose();
      blobMat.dispose();
    },
  };
}
