import * as THREE from 'three';
import { Rng } from '../core/rng';

/** Procedurally painted canvas textures (no image downloads). Cached by key. */
const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, repeat = true, srgb = true, aniso = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, count: number, colors: string[], size: [number, number]) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rng.pick(colors);
    const s = rng.range(size[0], size[1]);
    ctx.globalAlpha = rng.range(0.25, 0.8);
    ctx.fillRect(rng.range(0, w), rng.range(0, h), s, s);
  }
  ctx.globalAlpha = 1;
}

export interface RoadStyle {
  base: string;
  speck: string[];
  edge: string;
  center: string;
  dashed: boolean;
}

/** Road texture: u across the road (0 = left edge), v along it (repeats every ~12 m). */
export function roadTexture(style: RoadStyle): THREE.Texture {
  const key = 'road:' + JSON.stringify(style);
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(256, 512);
  ctx.fillStyle = style.base;
  ctx.fillRect(0, 0, 256, 512);
  const rng = new Rng(42);
  speckle(ctx, 256, 512, rng, 5000, style.speck, [1, 2.5]);
  // Subtle tyre-worn lanes.
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.3, 'rgba(0,0,0,0.08)');
  grad.addColorStop(0.4, 'rgba(0,0,0,0)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.08)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 512);
  // Edge lines.
  ctx.fillStyle = style.edge;
  ctx.fillRect(6, 0, 7, 512);
  ctx.fillRect(256 - 13, 0, 7, 512);
  // Centre line.
  ctx.fillStyle = style.center;
  if (style.dashed) {
    ctx.fillRect(125, 0, 6, 200);
    ctx.fillRect(125, 256, 6, 200);
  } else {
    ctx.fillRect(122, 0, 4, 512);
    ctx.fillRect(130, 0, 4, 512);
  }
  const t = finish(c);
  cache.set(key, t);
  return t;
}

/** Tileable height field -> tangent-space normal map (red = +x, green = +y). */
function heightToNormal(ctx: CanvasRenderingContext2D, w: number, h: number, height: Float32Array, strength: number) {
  const out = ctx.createImageData(w, h);
  const H = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = Math.round((-dx / len) * 127 + 128);
      out.data[i + 1] = Math.round((dy / len) * 127 + 128);
      out.data[i + 2] = Math.round((1 / len) * 127 + 128);
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

/** Tileable value noise on a w x h grid with `cells` lattice cells per side. */
function tileNoise(w: number, h: number, cells: number, rng: Rng): Float32Array {
  const lat = new Float32Array(cells * cells).map(() => rng.next());
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cells;
      const fy = (y / h) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const L = (i: number, j: number) => lat[((j + cells) % cells) * cells + ((i + cells) % cells)];
      const a = L(x0, y0) + (L(x0 + 1, y0) - L(x0, y0)) * sx;
      const b = L(x0, y0 + 1) + (L(x0 + 1, y0 + 1) - L(x0, y0 + 1)) * sx;
      out[y * w + x] = a + (b - a) * sy;
    }
  }
  return out;
}

/**
 * Asphalt micro-detail: a tileable normal map (aggregate grain, pits and a few sealed cracks)
 * plus a roughness map in road space (polished tyre lanes, smoother paint).
 */
export function asphaltDetail(): { normal: THREE.Texture; rough: THREE.Texture } {
  const key = 'asphalt-detail';
  const hit = cache.get(key + ':n');
  if (hit) return { normal: hit, rough: cache.get(key + ':r')! };
  const N = 256;
  const rng = new Rng(77);
  const h = new Float32Array(N * N);
  const n1 = tileNoise(N, N, 64, rng);
  const n2 = tileNoise(N, N, 16, rng);
  for (let i = 0; i < h.length; i++) h[i] = n1[i] * 0.6 + n2[i] * 0.25;
  // Pits.
  for (let i = 0; i < 900; i++) {
    const x = Math.floor(rng.range(0, N));
    const y = Math.floor(rng.range(0, N));
    h[y * N + x] -= 0.5;
  }
  // Sealed cracks: wandering lines that are slightly raised (tar strips).
  for (let c = 0; c < 3; c++) {
    let x = rng.range(0, N);
    let y = rng.range(0, N);
    let a = rng.range(0, Math.PI * 2);
    for (let k = 0; k < 160; k++) {
      a += rng.range(-0.35, 0.35);
      x += Math.cos(a);
      y += Math.sin(a);
      for (let o = -1; o <= 1; o++) {
        const px = ((Math.floor(x) + o) % N + N) % N;
        const py = ((Math.floor(y) % N) + N) % N;
        h[py * N + px] = 0.45 + (o === 0 ? 0.08 : 0.04);
      }
    }
  }
  const [c, ctx] = canvas(N, N);
  heightToNormal(ctx, N, N, h, 2.2);
  const normal = finish(c, true, false, 8);
  // Roughness (G channel) across the road: u = 0 left edge, 1 right edge.
  const [rc, rctx] = canvas(64, 16);
  const img = rctx.createImageData(64, 16);
  for (let x = 0; x < 64; x++) {
    const u = x / 63;
    const lane = Math.exp(-(((u - 0.3) / 0.06) ** 2)) + Math.exp(-(((u - 0.7) / 0.06) ** 2));
    const paint = u < 0.055 || u > 0.945 || Math.abs(u - 0.5) < 0.02 ? 1 : 0;
    const r = Math.max(0.55, 1 - lane * 0.3 - paint * 0.35);
    for (let y = 0; y < 16; y++) {
      const i = (y * 64 + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = Math.round(r * 255);
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  }
  rctx.putImageData(img, 0, 0);
  const rough = finish(rc, true, false, 4);
  cache.set(key + ':n', normal);
  cache.set(key + ':r', rough);
  return { normal, rough };
}

/** Gentle ripples for puddles and wet asphalt. */
export function puddleNormal(): THREE.Texture {
  const key = 'puddle-normal';
  const hit = cache.get(key);
  if (hit) return hit;
  const N = 128;
  const rng = new Rng(91);
  const a = tileNoise(N, N, 8, rng);
  const b = tileNoise(N, N, 24, rng);
  const h = new Float32Array(N * N);
  for (let i = 0; i < h.length; i++) h[i] = a[i] * 0.8 + b[i] * 0.2;
  const [c, ctx] = canvas(N, N);
  heightToNormal(ctx, N, N, h, 3);
  const t = finish(c, true, false, 4);
  cache.set(key, t);
  return t;
}

/** Lumpy ground micro-relief (soil, grass clumps). */
export function groundNormal(): THREE.Texture {
  const key = 'ground-normal';
  const hit = cache.get(key);
  if (hit) return hit;
  const N = 256;
  const rng = new Rng(13);
  const a = tileNoise(N, N, 32, rng);
  const b = tileNoise(N, N, 96, rng);
  const h = new Float32Array(N * N);
  for (let i = 0; i < h.length; i++) h[i] = a[i] * 0.7 + b[i] * 0.3;
  const [c, ctx] = canvas(N, N);
  heightToNormal(ctx, N, N, h, 3.2);
  const t = finish(c, true, false, 8);
  cache.set(key, t);
  return t;
}

/** Wind-blown sand ripples, gently wavering. */
export function rippleNormal(): THREE.Texture {
  const key = 'ripple-normal';
  const hit = cache.get(key);
  if (hit) return hit;
  const N = 256;
  const rng = new Rng(29);
  const warp = tileNoise(N, N, 6, rng);
  const fine = tileNoise(N, N, 64, rng);
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const ph = ((y + warp[i] * 40) / N) * Math.PI * 2 * 12;
      // Asymmetric ripple profile (gentle windward slope, steep lee side).
      const r = Math.sin(ph) + 0.35 * Math.sin(ph * 2);
      h[i] = r * 0.18 + fine[i] * 0.1;
    }
  }
  const [c, ctx] = canvas(N, N);
  heightToNormal(ctx, N, N, h, 4);
  const t = finish(c, true, false, 8);
  cache.set(key, t);
  return t;
}

/** Choppy wave normals for open water (two octaves of tiling noise). */
export function waveNormal(): THREE.Texture {
  const key = 'wave-normal';
  const hit = cache.get(key);
  if (hit) return hit;
  const N = 256;
  const rng = new Rng(57);
  const a = tileNoise(N, N, 8, rng);
  const b = tileNoise(N, N, 20, rng);
  const c2 = tileNoise(N, N, 48, rng);
  const h = new Float32Array(N * N);
  for (let i = 0; i < h.length; i++) h[i] = a[i] * 0.55 + b[i] * 0.3 + c2[i] * 0.15;
  const [c, ctx] = canvas(N, N);
  heightToNormal(ctx, N, N, h, 5);
  const t = finish(c, true, false, 8);
  cache.set(key, t);
  return t;
}

export function noiseTexture(key: string, base: string, specks: string[], seed = 1, blades = false): THREE.Texture {
  const hit = cache.get('noise:' + key);
  if (hit) return hit;
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  const rng = new Rng(seed);
  // Large soft blotches for variation.
  for (let i = 0; i < 40; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    const col = rng.pick(specks);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(rng.range(0, 256), rng.range(0, 256));
    ctx.scale(rng.range(20, 60), rng.range(20, 60));
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  speckle(ctx, 256, 256, rng, 2500, specks, [1, 3]);
  if (blades) {
    for (let i = 0; i < 1500; i++) {
      ctx.strokeStyle = rng.pick(specks);
      ctx.globalAlpha = rng.range(0.3, 0.7);
      const x = rng.range(0, 256);
      const y = rng.range(0, 256);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.range(-2, 2), y - rng.range(3, 7));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const t = finish(c);
  cache.set('noise:' + key, t);
  return t;
}

export function stripeTexture(key: string, a: string, b: string, stripes = 2): THREE.Texture {
  const hit = cache.get('stripe:' + key);
  if (hit) return hit;
  const [c, ctx] = canvas(64, 128);
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? a : b;
    ctx.fillRect(0, (i * 128) / stripes, 64, 128 / stripes);
  }
  const t = finish(c);
  cache.set('stripe:' + key, t);
  return t;
}

export function checkerTexture(): THREE.Texture {
  const hit = cache.get('checker');
  if (hit) return hit;
  const [c, ctx] = canvas(128, 32);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 4; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#15151f';
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const t = finish(c, true, true, 4);
  t.magFilter = THREE.NearestFilter;
  cache.set('checker', t);
  return t;
}

/** Chevron arrows for boost pads (emissive). */
export function chevronTexture(): THREE.Texture {
  const hit = cache.get('chevron');
  if (hit) return hit;
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#0a0620';
  ctx.fillRect(0, 0, 128, 128);
  const grad = ctx.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, '#ff4fa3');
  grad.addColorStop(0.5, '#ffd23f');
  grad.addColorStop(1, '#3de0ff');
  ctx.fillStyle = grad;
  for (let i = 0; i < 2; i++) {
    const y = i * 64 + 10;
    ctx.beginPath();
    ctx.moveTo(10, y + 40);
    ctx.lineTo(64, y);
    ctx.lineTo(118, y + 40);
    ctx.lineTo(100, y + 52);
    ctx.lineTo(64, y + 24);
    ctx.lineTo(28, y + 52);
    ctx.closePath();
    ctx.fill();
  }
  const t = finish(c);
  cache.set('chevron', t);
  return t;
}

/** Soft round sprite used for smoke/dust particles. */
export function softDotTexture(): THREE.Texture {
  const hit = cache.get('softdot');
  if (hit) return hit;
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = finish(c, false, false, 1);
  cache.set('softdot', t);
  return t;
}

export function sparkTexture(): THREE.Texture {
  const hit = cache.get('spark');
  if (hit) return hit;
  const [c, ctx] = canvas(32, 32);
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const t = finish(c, false, false, 1);
  cache.set('spark', t);
  return t;
}

/** Banner text texture (start gantry, signs). */
export function bannerTexture(text: string, bg: string, fg: string, w = 1024, h = 128): THREE.Texture {
  const key = `banner:${text}:${bg}:${fg}:${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(w, h);
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, bg);
  grad.addColorStop(0.5, shade(bg, 30));
  grad.addColorStop(1, bg);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = `italic 900 ${Math.floor(h * 0.62)}px "Baloo 2 Variable", "Arial Black", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 8;
  ctx.fillText(text, w / 2, h / 2 + h * 0.04);
  const t = finish(c, false, true, 4);
  cache.set(key, t);
  return t;
}

/** Window grid texture for city buildings (emissive map). */
export function windowTexture(seed: number, lit: string[], dark: string): THREE.Texture {
  const key = `win:${seed}:${lit.join()}:${dark}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(128, 256);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 128, 256);
  const rng = new Rng(seed);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = rng.chance(0.55) ? rng.pick(lit) : dark;
      ctx.fillRect(x * 16 + 3, y * 16 + 4, 10, 9);
    }
  }
  const t = finish(c);
  cache.set(key, t);
  return t;
}

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt / 255);
  return '#' + c.getHexString();
}

export function disposeTextureCache() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
