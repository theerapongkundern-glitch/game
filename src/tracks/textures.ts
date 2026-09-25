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
