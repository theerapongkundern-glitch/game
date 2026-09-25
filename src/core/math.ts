/** Small, allocation-free math helpers shared across the game. */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

export function remap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return lerp(outMin, outMax, clamp01(invLerp(inMin, inMax, v)));
}

/** Frame-rate independent exponential smoothing factor. */
export function dampFactor(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt);
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

/** Wraps an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt));
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Positive modulo. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

export function formatTime(seconds: number, showMillis = true): string {
  if (!isFinite(seconds) || seconds < 0) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds * 1000) % 1000);
  const base = `${m}:${s.toString().padStart(2, '0')}`;
  return showMillis ? `${base}.${ms.toString().padStart(3, '0')}` : base;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
