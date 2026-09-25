import * as THREE from 'three';

/**
 * Procedural textures shared by every car: a small "detail" atlas (grille honeycomb, black
 * plastic, chrome, satin metal, carbon weave, number plate) with a matching roughness/metalness
 * map, and a tyre tread normal map. Everything is drawn on canvases at startup (no image files).
 */

export interface AtlasRegion {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** UV rectangles inside the detail atlas (v up, as in three's UV space). */
export const ATLAS = {
  grille: { u0: 0, v0: 0.5, u1: 0.5, v1: 1 },
  plastic: { u0: 0.5, v0: 0.75, u1: 0.75, v1: 1 },
  chrome: { u0: 0.75, v0: 0.75, u1: 1, v1: 1 },
  satin: { u0: 0.5, v0: 0.5, u1: 0.75, v1: 0.75 },
  carbon: { u0: 0.75, v0: 0.5, u1: 1, v1: 0.75 },
  plate: { u0: 0, v0: 0.3, u1: 0.5, v1: 0.45 },
  gloss: { u0: 0.5, v0: 0.25, u1: 0.75, v1: 0.5 },
} satisfies Record<string, AtlasRegion>;

const SIZE = 256;

let atlasCache: { map: THREE.Texture; orm: THREE.Texture } | null = null;
let tyreCache: THREE.Texture | null = null;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

/** Converts a region in UV space to canvas pixels (canvas y grows downwards). */
function px(r: AtlasRegion) {
  return { x: r.u0 * SIZE, y: (1 - r.v1) * SIZE, w: (r.u1 - r.u0) * SIZE, h: (r.v1 - r.v0) * SIZE };
}

function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

export function detailAtlas(): { map: THREE.Texture; orm: THREE.Texture } | null {
  if (typeof document === 'undefined') return null;
  if (atlasCache) return atlasCache;
  const [c, ctx] = canvas(SIZE, SIZE);
  const [o, octx] = canvas(SIZE, SIZE);
  // ORM: R = occlusion (unused, white), G = roughness, B = metalness.
  const fill = (r: AtlasRegion, color: string, rough: number, metal: number) => {
    const p = px(r);
    ctx.fillStyle = color;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    octx.fillStyle = `rgb(255,${Math.round(rough * 255)},${Math.round(metal * 255)})`;
    octx.fillRect(p.x, p.y, p.w, p.h);
  };
  octx.fillStyle = 'rgb(255,150,30)';
  octx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#15161c';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Honeycomb grille: dark cells with satin rims.
  {
    const p = px(ATLAS.grille);
    fill(ATLAS.grille, '#07070a', 0.7, 0.2);
    const r = 7;
    const dx = r * Math.sqrt(3);
    for (let row = -1; row * r * 1.5 < p.h + r; row++) {
      for (let col = -1; col * dx < p.w + dx; col++) {
        const cx = p.x + col * dx + (row % 2 ? dx / 2 : 0);
        const cy = p.y + row * r * 1.5;
        hexPath(ctx, cx, cy, r - 1.4);
        ctx.strokeStyle = '#3a3d48';
        ctx.lineWidth = 2;
        ctx.stroke();
        hexPath(octx, cx, cy, r - 1.4);
        octx.strokeStyle = 'rgb(255,90,200)';
        octx.lineWidth = 2;
        octx.stroke();
      }
    }
  }
  fill(ATLAS.plastic, '#141519', 0.62, 0.05);
  fill(ATLAS.gloss, '#0c0d11', 0.12, 0.2);
  // Chrome: bright with a soft vertical gradient so it reads as polished metal even unlit.
  {
    const p = px(ATLAS.chrome);
    const g = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
    g.addColorStop(0, '#f4f7fb');
    g.addColorStop(0.5, '#c9ced8');
    g.addColorStop(1, '#eef1f6');
    ctx.fillStyle = g;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    octx.fillStyle = 'rgb(255,28,255)';
    octx.fillRect(p.x, p.y, p.w, p.h);
  }
  fill(ATLAS.satin, '#3a3e48', 0.38, 0.85);
  // Carbon weave.
  {
    const p = px(ATLAS.carbon);
    fill(ATLAS.carbon, '#101114', 0.3, 0.25);
    const s = 4;
    for (let y = 0; y < p.h; y += s) {
      for (let x = 0; x < p.w; x += s) {
        const on = ((x / s) ^ (y / s)) & 1;
        ctx.fillStyle = on ? '#24262c' : '#0b0c0f';
        ctx.fillRect(p.x + x, p.y + y, s, s / 2);
        ctx.fillStyle = on ? '#0b0c0f' : '#1c1e23';
        ctx.fillRect(p.x + x, p.y + y + s / 2, s, s / 2);
      }
    }
  }
  // Number plate (original text only).
  {
    const p = px(ATLAS.plate);
    fill(ATLAS.plate, '#f2f4f8', 0.4, 0);
    ctx.strokeStyle = '#1b1f2a';
    ctx.lineWidth = 3;
    ctx.strokeRect(p.x + 3, p.y + 3, p.w - 6, p.h - 6);
    ctx.fillStyle = '#1b1f2a';
    ctx.font = `bold ${Math.round(p.h * 0.62)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PRISM', p.x + p.w / 2, p.y + p.h / 2 + 1);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const orm = new THREE.CanvasTexture(o);
  orm.colorSpace = THREE.NoColorSpace;
  atlasCache = { map, orm };
  return atlasCache;
}

/**
 * Tyre normal map. The lathe UVs run u = around the wheel, v = across the profile, and the
 * tread occupies v in [0.3, 0.7]; the sidewalls get a couple of subtle moulding rings.
 */
export function tyreNormalMap(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  if (tyreCache) return tyreCache;
  const W = 64;
  const H = 128;
  const [c, ctx] = canvas(W, H);
  // Height field: 128 = flat.
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, W, H);
  const vy = (v: number) => (1 - v) * H;
  ctx.fillStyle = 'rgb(20,20,20)';
  // Two circumferential grooves.
  for (const v of [0.43, 0.57]) ctx.fillRect(0, vy(v) - 2, W, 4);
  // Lateral sipes (angled blocks), one per tile.
  ctx.strokeStyle = 'rgb(40,40,40)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W * 0.2, vy(0.31));
  ctx.lineTo(W * 0.45, vy(0.43));
  ctx.moveTo(W * 0.55, vy(0.57));
  ctx.lineTo(W * 0.8, vy(0.69));
  ctx.moveTo(W * 0.1, vy(0.45));
  ctx.lineTo(W * 0.3, vy(0.55));
  ctx.stroke();
  // Sidewall rings.
  ctx.fillStyle = 'rgb(160,160,160)';
  for (const v of [0.12, 0.88]) ctx.fillRect(0, vy(v) - 1, W, 2);
  const src = ctx.getImageData(0, 0, W, H).data;
  const out = ctx.createImageData(W, H);
  const h = (x: number, y: number) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  const strength = 2.2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * W + x) * 4;
      out.data[i] = Math.round((-dx / len) * 127 + 128);
      out.data[i + 1] = Math.round((dy / len) * 127 + 128);
      out.data[i + 2] = Math.round((1 / len) * 127 + 128);
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(22, 1);
  tyreCache = t;
  return t;
}
