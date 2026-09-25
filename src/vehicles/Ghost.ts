import * as THREE from 'three';
import { buildCarModel, type CarVisual } from './CarModel';
import { getCarDef } from './CarDefs';
import { wrapAngle } from '../core/math';

/** Samples per second recorded for a ghost lap. */
export const GHOST_RATE = 20;
const STRIDE = 5; // x, y, z, heading, s

export interface GhostData {
  car: string;
  color: string;
  lapTime: number;
  /** Flat array of [x, y, z, heading, lapDistance] per sample. */
  samples: Float32Array;
}

/** Records one lap of a car at a fixed rate. */
export class GhostRecorder {
  private buf: number[] = [];
  private acc = 0;

  reset() {
    this.buf = [];
    this.acc = 0;
  }

  /** Call every simulation step with the time since the lap started. */
  step(dt: number, x: number, y: number, z: number, heading: number, lapS: number) {
    if (this.buf.length === 0) {
      this.buf.push(x, y, z, heading, lapS);
      this.acc = 0;
      return;
    }
    this.acc += dt;
    while (this.acc >= 1 / GHOST_RATE) {
      this.acc -= 1 / GHOST_RATE;
      this.buf.push(x, y, z, heading, lapS);
    }
  }

  finish(car: string, color: string, lapTime: number): GhostData {
    return { car, color, lapTime, samples: new Float32Array(this.buf) };
  }
}

/** Compact string encoding (quantised Int16 + base64) for localStorage. */
export function encodeGhost(g: GhostData): string {
  const n = g.samples.length / STRIDE;
  const q = new Int16Array(g.samples.length);
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    q[o] = Math.round(g.samples[o] / 0.05);
    q[o + 1] = Math.round(g.samples[o + 1] / 0.05);
    q[o + 2] = Math.round(g.samples[o + 2] / 0.05);
    q[o + 3] = Math.round((wrapAngle(g.samples[o + 3]) / Math.PI) * 10000);
    q[o + 4] = Math.round(g.samples[o + 4] / 0.1);
  }
  const bytes = new Uint8Array(q.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const head = JSON.stringify({ c: g.car, k: g.color, t: g.lapTime, r: GHOST_RATE, v: 1 });
  return head + '|' + btoa(bin);
}

export function decodeGhost(s: string | undefined): GhostData | null {
  if (!s) return null;
  try {
    const bar = s.indexOf('|');
    const head = JSON.parse(s.slice(0, bar)) as { c: string; k: string; t: number; r: number };
    const bin = atob(s.slice(bar + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const q = new Int16Array(bytes.buffer);
    const out = new Float32Array(q.length);
    for (let i = 0; i < q.length; i += STRIDE) {
      out[i] = q[i] * 0.05;
      out[i + 1] = q[i + 1] * 0.05;
      out[i + 2] = q[i + 2] * 0.05;
      out[i + 3] = (q[i + 3] / 10000) * Math.PI;
      out[i + 4] = q[i + 4] * 0.1;
    }
    return { car: head.c, color: head.k, lapTime: head.t, samples: out };
  } catch {
    return null;
  }
}

/** Plays back a ghost lap as a translucent car. */
export class GhostPlayer {
  readonly visual: CarVisual;
  private readonly n: number;

  constructor(
    readonly data: GhostData,
    quality: 'low' | 'medium' | 'high',
  ) {
    this.visual = buildCarModel(getCarDef(data.car), data.color, quality);
    this.visual.setOpacity(0.38);
    this.visual.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = false;
        o.renderOrder = 3;
      }
    });
    this.n = data.samples.length / STRIDE;
  }

  get object() {
    return this.visual.root;
  }

  /** Positions the ghost at `t` seconds into its lap. */
  update(t: number) {
    const s = this.data.samples;
    const f = Math.max(0, Math.min(this.n - 1.001, t * GHOST_RATE));
    const i = Math.floor(f);
    const k = f - i;
    const a = i * STRIDE;
    const b = Math.min(this.n - 1, i + 1) * STRIDE;
    const root = this.visual.root;
    root.position.set(s[a] + (s[b] - s[a]) * k, s[a + 1] + (s[b + 1] - s[a + 1]) * k, s[a + 2] + (s[b + 2] - s[a + 2]) * k);
    root.rotation.set(0, s[a + 3] + wrapAngle(s[b + 3] - s[a + 3]) * k, 0);
    root.visible = t <= this.data.lapTime + 0.5;
    for (const w of this.visual.wheels) w.spin.rotation.x += 0.4;
  }

  /** Ghost's lap time at the given lap distance (for live deltas). */
  timeAt(lapS: number): number {
    const s = this.data.samples;
    // Binary search on the monotone-ish distance channel.
    let lo = 0;
    let hi = this.n - 1;
    if (lapS <= s[4]) return 0;
    if (lapS >= s[hi * STRIDE + 4]) return this.data.lapTime;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid * STRIDE + 4] < lapS) lo = mid;
      else hi = mid;
    }
    const d0 = s[lo * STRIDE + 4];
    const d1 = s[hi * STRIDE + 4];
    const k = d1 > d0 ? (lapS - d0) / (d1 - d0) : 0;
    return (lo + k) / GHOST_RATE;
  }

  dispose() {
    this.visual.dispose();
  }
}
