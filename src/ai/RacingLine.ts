import { SAMPLE_SPACING, type TrackPath } from '../tracks/Track';
import { clamp } from '../core/math';
import { GRAVITY } from '../vehicles/VehiclePhysics';

/**
 * A racing line for one path: lateral offsets that minimise curvature (a classic
 * "elastic band" relaxation clamped to the road), plus per-sample curvature.
 */
export class RacingLine {
  readonly offset: Float32Array;
  readonly x: Float32Array;
  readonly z: Float32Array;
  /** Unsigned curvature (1/m) of the line. */
  readonly curv: Float32Array;
  readonly n: number;

  constructor(
    readonly path: TrackPath,
    margin = 2.2,
  ) {
    const n = (this.n = path.n);
    this.offset = new Float32Array(n);
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.curv = new Float32Array(n);
    const lim = (i: number) => Math.max(0, path.hw[i] - margin);
    const off = this.offset;
    const tmp = new Float32Array(n);
    const px = (i: number) => path.px[i] + path.nx[i] * off[i];
    const pz = (i: number) => path.pz[i] + path.nz[i] * off[i];
    const ramps = path.ramps;
    for (const k of [14, 10, 7, 5, 3]) {
      for (let iter = 0; iter < 45; iter++) {
        for (let i = 0; i < n; i++) {
          if (!path.closed && (i < k || i >= n - k)) {
            tmp[i] = 0;
            continue;
          }
          const a = path.idx(i - k);
          const b = path.idx(i + k);
          const mx = (px(a) + px(b)) / 2;
          const mz = (pz(a) + pz(b)) / 2;
          const o = (mx - path.px[i]) * path.nx[i] + (mz - path.pz[i]) * path.nz[i];
          tmp[i] = clamp(off[i] + (o - off[i]) * 0.55, -lim(i), lim(i));
        }
        off.set(tmp);
      }
    }
    // Keep ramps lined up: AI loves a jump if it's in the middle of the road.
    for (const r of ramps) {
      const centre = (r.lat0 + r.lat1) / 2;
      const i0 = Math.floor(r.s0 / SAMPLE_SPACING) - 12;
      const i1 = Math.ceil(r.s1 / SAMPLE_SPACING) + 2;
      for (let i = i0; i <= i1; i++) {
        const j = path.idx(i);
        const t = clamp((i - i0) / 10, 0, 1);
        off[j] = off[j] + (clamp(centre, -lim(j), lim(j)) - off[j]) * t;
      }
    }
    for (let i = 0; i < n; i++) {
      this.x[i] = px(i);
      this.z[i] = pz(i);
    }
    // Curvature from circumradius over a few samples, then smoothed.
    const k = 4;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = path.idx(i - k);
      const b = path.idx(i + k);
      const ax = this.x[a],
        az = this.z[a];
      const bx = this.x[i],
        bz = this.z[i];
      const cx = this.x[b],
        cz = this.z[b];
      const ab = Math.hypot(bx - ax, bz - az);
      const bc = Math.hypot(cx - bx, cz - bz);
      const ca = Math.hypot(ax - cx, az - cz);
      const cross = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
      raw[i] = ab * bc * ca > 1e-6 ? (2 * cross) / (ab * bc * ca) : 0;
    }
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let d = -2; d <= 2; d++) s += raw[path.idx(i + d)];
      this.curv[i] = s / 5;
    }
  }

  /**
   * Target speed profile for a car with a given grip, braking and top speed.
   * Includes a backward braking pass so the AI slows *before* corners.
   */
  speedProfile(mu: number, downforce: number, topSpeed: number, brakeDecel: number, gripScale: number[] | null = null): Float32Array {
    const n = this.n;
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const g = gripScale ? gripScale[i] : 1;
      const m = mu * g * GRAVITY;
      const denom = this.curv[i] - m * downforce;
      v[i] = denom <= 1e-5 ? topSpeed : Math.min(topSpeed, Math.sqrt(m / denom));
    }
    const passes = this.path.closed ? 2 : 1;
    for (let p = 0; p < passes; p++) {
      for (let i = n - 2; i >= 0; i--) {
        const j = this.path.closed ? (i + 1) % n : i + 1;
        const lim = Math.sqrt(v[j] * v[j] + 2 * brakeDecel * SAMPLE_SPACING);
        if (v[i] > lim) v[i] = lim;
      }
      if (this.path.closed) {
        const lim = Math.sqrt(v[0] * v[0] + 2 * brakeDecel * SAMPLE_SPACING);
        if (v[n - 1] > lim) v[n - 1] = lim;
      }
    }
    return v;
  }
}
