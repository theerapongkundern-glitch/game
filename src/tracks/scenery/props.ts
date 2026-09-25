import * as THREE from 'three';
import { coloredMerge, translate } from './common';

/** Low-poly, vertex-coloured prop geometries shared by the themed scenery sets. */

function bend(g: THREE.BufferGeometry, amount: number, height: number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = y / height;
    pos.setX(i, pos.getX(i) + amount * t * t);
  }
  g.computeVertexNormals();
  return g;
}

export function palmGeometry(): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; color: string }[] = [];
  const h = 7.5;
  const trunk = new THREE.CylinderGeometry(0.22, 0.34, h, 6, 5);
  translate(trunk, 0, h / 2, 0);
  bend(trunk, 1.4, h);
  parts.push({ geo: trunk, color: '#a47148' });
  // Trunk rings.
  for (let k = 1; k < 6; k += 2) {
    const y = (k / 6) * h;
    const ring = new THREE.TorusGeometry(0.3 - k * 0.015, 0.06, 3, 6);
    ring.rotateX(Math.PI / 2);
    translate(ring, 1.4 * (y / h) * (y / h), y, 0);
    parts.push({ geo: ring, color: '#8a5a36' });
  }
  const topX = 1.4;
  // Fronds.
  const leaf = new THREE.Shape();
  leaf.moveTo(0, 0);
  leaf.quadraticCurveTo(0.9, 0.35, 3.6, 0);
  leaf.quadraticCurveTo(0.9, -0.35, 0, 0);
  for (let k = 0; k < 8; k++) {
    const g = new THREE.ShapeGeometry(leaf, 3);
    g.rotateX(-Math.PI / 2);
    // Droop.
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setY(i, pos.getY(i) - 0.12 * x * x + 0.4 * x * (k % 2 ? 0.8 : 1));
    }
    g.rotateY((k / 8) * Math.PI * 2 + (k % 2) * 0.2);
    translate(g, topX, h, 0);
    parts.push({ geo: g, color: k % 2 ? '#3fbf5a' : '#2fa84d' });
  }
  for (let k = 0; k < 3; k++) {
    const c = new THREE.IcosahedronGeometry(0.2, 0);
    const a = (k / 3) * Math.PI * 2;
    translate(c, topX + Math.cos(a) * 0.25, h - 0.25, Math.sin(a) * 0.25);
    parts.push({ geo: c, color: '#6b4a2a' });
  }
  const out = coloredMerge(parts);
  // Leaves are single-sided shapes: duplicate the normals issue is handled by DoubleSide material.
  return out;
}

/** Palm trunk + coconuts (fronds are separate textured cards, see palmFrondGeometry). */
export function palmTrunkGeometry(): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; color: string }[] = [];
  const h = 7.5;
  const trunk = new THREE.CylinderGeometry(0.2, 0.34, h, 6, 5);
  translate(trunk, 0, h / 2, 0);
  bend(trunk, 1.4, h);
  parts.push({ geo: trunk, color: '#9c6b44' });
  for (let k = 1; k < 6; k += 2) {
    const y = (k / 6) * h;
    const ring = new THREE.TorusGeometry(0.29 - k * 0.015, 0.05, 3, 6);
    ring.rotateX(Math.PI / 2);
    translate(ring, 1.4 * (y / h) * (y / h), y, 0);
    parts.push({ geo: ring, color: '#7a5234' });
  }
  for (let k = 0; k < 3; k++) {
    const c = new THREE.IcosahedronGeometry(0.19, 0);
    const a = (k / 3) * Math.PI * 2;
    translate(c, 1.4 + Math.cos(a) * 0.24, h - 0.3, Math.sin(a) * 0.24);
    parts.push({ geo: c, color: '#5e4128' });
  }
  return coloredMerge(parts);
}

/** Ten arching frond cards around the crown; uv.x runs along the frond (0 = crown). */
export function palmFrondGeometry(): THREE.BufferGeometry {
  const P: number[] = [];
  const N: number[] = [];
  const U: number[] = [];
  const topX = 1.4;
  const h = 7.5;
  const SEG = 5;
  for (let k = 0; k < 10; k++) {
    const yaw = (k / 10) * Math.PI * 2 + (k % 2) * 0.15;
    const len = 3.4 + (k % 3) * 0.35;
    const lift = k % 2 ? 0.9 : 0.55;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const r = t * len;
      // Arch up then droop.
      const y = lift * Math.sin(t * Math.PI * 0.6) * 1.6 - 1.7 * t * t;
      pts.push(new THREE.Vector3(Math.cos(yaw) * r, y, Math.sin(yaw) * r));
    }
    const side = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
    for (let i = 0; i < SEG; i++) {
      const t0 = i / SEG;
      const t1 = (i + 1) / SEG;
      const w0 = 0.85 * Math.sin(Math.PI * Math.min(1, t0 * 1.1 + 0.05));
      const w1 = 0.85 * Math.sin(Math.PI * Math.min(1, t1 * 1.1 + 0.05));
      // Slight V-fold: the frond edges hang lower than the rib.
      const a0 = pts[i].clone().addScaledVector(side, -w0).add(new THREE.Vector3(0, -0.22 * w0, 0));
      const b0 = pts[i].clone().addScaledVector(side, w0).add(new THREE.Vector3(0, -0.22 * w0, 0));
      const a1 = pts[i + 1].clone().addScaledVector(side, -w1).add(new THREE.Vector3(0, -0.22 * w1, 0));
      const b1 = pts[i + 1].clone().addScaledVector(side, w1).add(new THREE.Vector3(0, -0.22 * w1, 0));
      const quad = [a0, b0, a1, a1, b0, b1];
      const uvs = [[t0, 0], [t0, 1], [t1, 0], [t1, 0], [t0, 1], [t1, 1]];
      quad.forEach((v, q) => {
        P.push(v.x + topX, v.y + h, v.z);
        N.push(0, 1, 0);
        U.push(uvs[q][0], uvs[q][1]);
      });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.computeVertexNormals();
  return g;
}

/** Frond texture: a central rib with many slender leaflets (alpha cut-out). */
export function frondTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  let seed = 17;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let x = 6; x < 250; x += 3.2) {
    const t = x / 256;
    const len = 26 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.04));
    for (const dir of [-1, 1]) {
      ctx.strokeStyle = rnd() > 0.5 ? '#2f9e4a' : '#46b85a';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x, 32);
      ctx.quadraticCurveTo(x + 6, 32 + dir * len * 0.5, x + 12 + rnd() * 4, 32 + dir * len);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#c9b46a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 32);
  ctx.lineTo(256, 32);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Wooden pier: deck planks + posts, length along -z from the origin. */
export function pierGeometry(length: number, deckY: number, depth: number): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; color: string }[] = [];
  for (let z = 0; z < length; z += 0.5) {
    parts.push({ geo: translate(new THREE.BoxGeometry(3.4, 0.12, 0.44), 0, deckY, -z), color: (Math.floor(z * 2) % 3) === 0 ? '#b98a5a' : '#c99a68' });
  }
  for (let z = 0; z <= length; z += 4) {
    for (const x of [-1.6, 1.6]) {
      const hgt = deckY + depth;
      parts.push({ geo: translate(new THREE.CylinderGeometry(0.14, 0.16, hgt, 6), x, deckY - hgt / 2, -z), color: '#7a5436' });
      parts.push({ geo: translate(new THREE.BoxGeometry(0.1, 0.9, 0.1), x, deckY + 0.5, -z), color: '#8a6040' });
    }
  }
  for (const x of [-1.6, 1.6]) parts.push({ geo: translate(new THREE.BoxGeometry(0.08, 0.08, length), x, deckY + 0.95, -length / 2), color: '#8a6040' });
  // A little hut at the end.
  parts.push({ geo: translate(new THREE.BoxGeometry(4, 2.6, 3.6), 0, deckY + 1.35, -length - 1), color: '#ffffff' });
  parts.push({ geo: translate(new THREE.ConeGeometry(3.4, 1.6, 4).rotateY(Math.PI / 4), 0, deckY + 3.4, -length - 1), color: '#ff6f59' });
  return coloredMerge(parts);
}

export function pineGeometry(): THREE.BufferGeometry {
  return coloredMerge([
    { geo: translate(new THREE.CylinderGeometry(0.22, 0.32, 2.2, 6), 0, 1.1, 0), color: '#7a5234' },
    { geo: translate(new THREE.ConeGeometry(2.3, 3.4, 7), 0, 3.3, 0), color: '#2f8a4a' },
    { geo: translate(new THREE.ConeGeometry(1.8, 2.9, 7), 0, 4.9, 0), color: '#37a055' },
    { geo: translate(new THREE.ConeGeometry(1.2, 2.3, 7), 0, 6.4, 0), color: '#44b562' },
  ]);
}

export function leafyTreeGeometry(): THREE.BufferGeometry {
  return coloredMerge([
    { geo: translate(new THREE.CylinderGeometry(0.2, 0.3, 2.6, 6), 0, 1.3, 0), color: '#7a5234' },
    { geo: translate(new THREE.IcosahedronGeometry(1.9, 0), 0, 3.6, 0), color: '#f08a3c' },
    { geo: translate(new THREE.IcosahedronGeometry(1.3, 0), 0.9, 4.4, 0.4), color: '#ffb13d' },
    { geo: translate(new THREE.IcosahedronGeometry(1.2, 0), -0.8, 4.1, -0.5), color: '#e8683a' },
  ]);
}

export function rockGeometry(color = '#9a8f86'): THREE.BufferGeometry {
  // Noise-displaced icosphere: craggy, faceted boulders instead of a plain dodecahedron.
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) {
      k = 0.78 + 0.34 * Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453 % 1);
      seen.set(key, k);
    }
    pos.setXYZ(i, x * k, y * k * (y < 0 ? 0.5 : 1), z * k);
  }
  g.scale(1.3, 0.8, 1.1);
  translate(g, 0, 0.3, 0);
  const c = new THREE.Color(color);
  const lighter = '#' + c.clone().lerp(new THREE.Color('#ffffff'), 0.12).getHexString();
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  // Faces pointing up are a touch lighter (weathered tops).
  const out = coloredMerge([{ geo: ng, color }]);
  const nor = out.attributes.normal as THREE.BufferAttribute;
  const col = out.attributes.color as THREE.BufferAttribute;
  const lc = new THREE.Color(lighter);
  for (let i = 0; i < nor.count; i++) if (nor.getY(i) > 0.6) col.setXYZ(i, lc.r, lc.g, lc.b);
  return out;
}

/** Pine trunk only (the foliage is a separate, textured card mesh). */
export function pineTrunkGeometry(): THREE.BufferGeometry {
  return coloredMerge([{ geo: translate(new THREE.CylinderGeometry(0.16, 0.34, 7.2, 6), 0, 3.6, 0), color: '#6b4a30' }]);
}

/**
 * Pine foliage: stacked, drooping open cones whose lower rims are cut by an alpha-tested needle
 * texture, so silhouettes read as feathery boughs. Vertex colours darken the inner/lower parts.
 */
export function pineFoliageGeometry(): THREE.BufferGeometry {
  const tiers = [
    { r: 2.5, h: 2.7, y: 1.8 },
    { r: 2.05, h: 2.5, y: 3.2 },
    { r: 1.6, h: 2.3, y: 4.5 },
    { r: 1.1, h: 2.0, y: 5.7 },
    { r: 0.6, h: 1.6, y: 6.8 },
  ];
  const parts: THREE.BufferGeometry[] = [];
  tiers.forEach((t, k) => {
    const g = new THREE.ConeGeometry(t.r, t.h, 10, 1, true);
    const pos = g.attributes.position as THREE.BufferAttribute;
    // Droop the rim and wobble it so tiers don't look machined.
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < -t.h / 2 + 0.01) {
        const a = Math.atan2(pos.getZ(i), pos.getX(i));
        pos.setY(i, y - 0.25 - 0.2 * Math.sin(a * 3 + k));
        const w = 1 + 0.12 * Math.sin(a * 5 + k * 2);
        pos.setX(i, pos.getX(i) * w);
        pos.setZ(i, pos.getZ(i) * w);
      }
    }
    g.rotateY(k * 0.7);
    g.translate(0, t.y + t.h / 2, 0);
    const n = pos.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const up = (pos.getY(i) - 1.5) / 7;
      const shade = 0.62 + 0.38 * Math.min(1, Math.max(0, up)) + (k % 2) * 0.04;
      col[i * 3] = shade * 0.92;
      col[i * 3 + 1] = shade;
      col[i * 3 + 2] = shade * 0.9;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g.toNonIndexed());
    g.dispose();
  });
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const P = new Float32Array(total * 3);
  const N = new Float32Array(total * 3);
  const C = new Float32Array(total * 3);
  const U = new Float32Array(total * 2);
  let o = 0;
  for (const g of parts) {
    P.set(g.attributes.position.array as Float32Array, o * 3);
    g.computeVertexNormals();
    N.set(g.attributes.normal.array as Float32Array, o * 3);
    C.set(g.attributes.color.array as Float32Array, o * 3);
    U.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.computeBoundingSphere();
  return out;
}

/** Needle texture for pine tiers: v = 0 is the drooping rim (ragged alpha), v = 1 the tip. */
export function needleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 128);
  // Body of the bough.
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#4fae5a');
  g.addColorStop(1, '#2c7a3f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 104);
  // Ragged, drooping needle tips along the rim (bottom of the canvas = v 0).
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let x = 0; x < 256; x += 3) {
    const len = 8 + rnd() * 22;
    ctx.strokeStyle = rnd() > 0.5 ? '#2f8a45' : '#3d9c50';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 96);
    ctx.lineTo(x + (rnd() - 0.5) * 8, 96 + len);
    ctx.stroke();
  }
  // Needle strokes for texture.
  for (let i = 0; i < 900; i++) {
    const x = rnd() * 256;
    const y = rnd() * 100;
    ctx.strokeStyle = rnd() > 0.5 ? 'rgba(120,200,110,0.55)' : 'rgba(20,70,35,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 6, y + 5 + rnd() * 6);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Grass tuft: three crossed blade cards (uv v = 0 at the root). */
export function grassTuftGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(0.9, 0.55, 1, 2);
    g.translate(0, 0.27, 0);
    g.rotateY((k / 3) * Math.PI);
    parts.push(g.toNonIndexed());
    g.dispose();
  }
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const P = new Float32Array(total * 3);
  const U = new Float32Array(total * 2);
  const N = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    P.set(g.attributes.position.array as Float32Array, o * 3);
    U.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
    g.dispose();
  }
  // Normals point up so the cards light like the ground they grow from.
  for (let i = 0; i < total; i++) N[i * 3 + 1] = 1;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  return out;
}

export function grassTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const x = 4 + rnd() * 120;
    const h = 24 + rnd() * 38;
    const lean = (rnd() - 0.5) * 18;
    const g = ctx.createLinearGradient(0, 64, 0, 64 - h);
    g.addColorStop(0, '#4f9a45');
    g.addColorStop(1, rnd() > 0.3 ? '#b4ec84' : '#e2ec8a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 1.6, 64);
    ctx.quadraticCurveTo(x + lean * 0.3, 64 - h * 0.6, x + lean, 64 - h);
    ctx.quadraticCurveTo(x + lean * 0.3 + 1, 64 - h * 0.6, x + 1.6, 64);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function cactusGeometry(): THREE.BufferGeometry {
  const green = '#3f9d58';
  const parts = [
    { geo: translate(new THREE.CylinderGeometry(0.42, 0.48, 5, 8), 0, 2.5, 0), color: green },
    { geo: translate(new THREE.SphereGeometry(0.42, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0, 5, 0), color: green },
    { geo: translate(new THREE.CylinderGeometry(0.28, 0.28, 1.2, 7).rotateZ(Math.PI / 2), 0.9, 2.2, 0), color: green },
    { geo: translate(new THREE.CylinderGeometry(0.28, 0.3, 1.8, 7), 1.45, 3.0, 0), color: green },
    { geo: translate(new THREE.SphereGeometry(0.28, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), 1.45, 3.9, 0), color: green },
    { geo: translate(new THREE.CylinderGeometry(0.25, 0.25, 1.0, 7).rotateZ(Math.PI / 2), -0.8, 3.0, 0), color: green },
    { geo: translate(new THREE.CylinderGeometry(0.25, 0.27, 1.4, 7), -1.25, 3.6, 0), color: green },
    { geo: translate(new THREE.SphereGeometry(0.25, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), -1.25, 4.3, 0), color: green },
    { geo: translate(new THREE.SphereGeometry(0.22, 6, 4), 0, 5.35, 0), color: '#ff5fa2' },
  ];
  return coloredMerge(parts);
}

export function hutGeometry(): THREE.BufferGeometry {
  return coloredMerge([
    { geo: translate(new THREE.BoxGeometry(4, 2.6, 3.4), 0, 1.3, 0), color: '#ffffff' },
    { geo: translate(new THREE.ConeGeometry(3.4, 2.2, 4).rotateY(Math.PI / 4), 0, 3.7, 0), color: '#e8c07a' },
    { geo: translate(new THREE.BoxGeometry(1, 1.8, 0.1), 0, 0.9, 1.72), color: '#6b4a2a' },
  ]);
}

export function umbrellaGeometry(): THREE.BufferGeometry {
  return coloredMerge([
    { geo: translate(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5), 0, 1.2, 0), color: '#ffffff' },
    { geo: translate(new THREE.ConeGeometry(1.6, 0.7, 8, 1, true), 0, 2.4, 0), color: '#ffffff' },
    { geo: translate(new THREE.BoxGeometry(0.7, 0.06, 1.8), 0.9, 0.05, 0.4), color: '#ffffff' },
  ]);
}

export function lampGeometry(): THREE.BufferGeometry {
  return coloredMerge([
    { geo: translate(new THREE.CylinderGeometry(0.1, 0.14, 7, 6), 0, 3.5, 0), color: '#2a2640' },
    { geo: translate(new THREE.BoxGeometry(0.12, 0.12, 2.2), 0, 7, 1.0), color: '#2a2640' },
  ]);
}

export function mountainGeometry(snow: string | null, base: string, mid: string): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(1, 1, 7, 3);
  translate(g, 0, 0.5, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  // Jitter for a rugged silhouette.
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.02 && y < 0.98) {
      pos.setX(i, pos.getX(i) * (0.85 + Math.sin(i * 12.9) * 0.15));
      pos.setZ(i, pos.getZ(i) * (0.85 + Math.cos(i * 7.3) * 0.15));
    }
  }
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  const p2 = ng.attributes.position as THREE.BufferAttribute;
  const cols = new Float32Array(p2.count * 3);
  const cBase = new THREE.Color(base);
  const cMid = new THREE.Color(mid);
  const cSnow = snow ? new THREE.Color(snow) : cMid;
  for (let i = 0; i < p2.count; i += 3) {
    const y = (p2.getY(i) + p2.getY(i + 1) + p2.getY(i + 2)) / 3;
    const c = y > 0.72 && snow ? cSnow : y > 0.35 ? cMid : cBase;
    for (let k = 0; k < 3; k++) {
      cols[(i + k) * 3] = c.r;
      cols[(i + k) * 3 + 1] = c.g;
      cols[(i + k) * 3 + 2] = c.b;
    }
  }
  ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  ng.deleteAttribute('uv');
  return ng;
}

/** Flat-topped layered mesa (desert). */
export function mesaGeometry(): THREE.BufferGeometry {
  const layers = ['#c46a3f', '#d98652', '#b85c3a', '#e39a62'];
  const parts: { geo: THREE.BufferGeometry; color: string }[] = [];
  let y = 0;
  for (let k = 0; k < 4; k++) {
    const h = 0.25;
    const r = 1 - k * 0.07;
    const g = new THREE.CylinderGeometry(r * 0.97, r, h, 9, 1);
    translate(g, 0, y + h / 2, 0);
    parts.push({ geo: g, color: layers[k] });
    y += h;
  }
  return coloredMerge(parts);
}

export function balloonGeometry(): THREE.BufferGeometry {
  const env = new THREE.SphereGeometry(3, 12, 10);
  env.scale(1, 1.15, 1);
  translate(env, 0, 6, 0);
  return coloredMerge([
    { geo: env, color: '#ffffff' },
    { geo: translate(new THREE.CylinderGeometry(1.1, 0.4, 1.2, 8), 0, 2.4, 0), color: '#ffffff' },
    { geo: translate(new THREE.BoxGeometry(1.1, 0.8, 1.1), 0, 0.4, 0), color: '#8a5a36' },
  ]);
}

export function sailboatGeometry(): THREE.BufferGeometry {
  const hull = new THREE.BoxGeometry(1.6, 0.6, 4.2);
  translate(hull, 0, 0.3, 0);
  const sail = new THREE.BufferGeometry();
  sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.7, -1.4, 0, 5.2, -0.2, 0, 0.7, 1.2, 0, 0.7, 1.2, 0, 5.2, -0.2, 0, 0.7, -1.4], 3));
  sail.computeVertexNormals();
  return coloredMerge([
    { geo: hull, color: '#ffffff' },
    { geo: translate(new THREE.CylinderGeometry(0.06, 0.06, 5, 4), 0, 3, -0.3), color: '#6b4a2a' },
    { geo: sail, color: '#ffffff' },
  ]);
}

export function mushroomGeometry(): THREE.BufferGeometry {
  return coloredMerge([
    { geo: translate(new THREE.CylinderGeometry(0.3, 0.4, 1.4, 7), 0, 0.7, 0), color: '#fff3e0' },
    { geo: translate(new THREE.SphereGeometry(1.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.3, 0), color: '#ff4f4f' },
    { geo: translate(new THREE.SphereGeometry(0.16, 5, 4), 0.5, 2.0, 0.3), color: '#ffffff' },
    { geo: translate(new THREE.SphereGeometry(0.14, 5, 4), -0.4, 2.05, -0.3), color: '#ffffff' },
    { geo: translate(new THREE.SphereGeometry(0.12, 5, 4), 0.1, 2.35, -0.1), color: '#ffffff' },
  ]);
}

export function logGeometry(): THREE.BufferGeometry {
  return coloredMerge([{ geo: translate(new THREE.CylinderGeometry(0.4, 0.4, 5, 7).rotateZ(Math.PI / 2), 0, 0.4, 0), color: '#8a5a36' }]);
}

export function cabinGeometry(): THREE.BufferGeometry {
  return coloredMerge([
    { geo: translate(new THREE.BoxGeometry(6, 3, 5), 0, 1.5, 0), color: '#a0643a' },
    { geo: translate(new THREE.ConeGeometry(4.8, 2.6, 4).rotateY(Math.PI / 4), 0, 4.3, 0), color: '#c0392b' },
    { geo: translate(new THREE.BoxGeometry(1.1, 1.1, 0.1), 1.5, 1.8, 2.52), color: '#ffe8a3' },
    { geo: translate(new THREE.BoxGeometry(1.1, 2, 0.1), -1.2, 1.0, 2.52), color: '#5a3a22' },
    { geo: translate(new THREE.BoxGeometry(0.7, 2, 0.7), 2, 4.5, -1), color: '#7a7a7a' },
  ]);
}

export function lighthouseGeometry(): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; color: string }[] = [];
  const h = 3;
  for (let k = 0; k < 6; k++) {
    const r0 = 2.2 - k * 0.2;
    const r1 = 2.2 - (k + 1) * 0.2;
    parts.push({ geo: translate(new THREE.CylinderGeometry(r1, r0, h, 12), 0, k * h + h / 2, 0), color: k % 2 ? '#ff4f4f' : '#ffffff' });
  }
  parts.push({ geo: translate(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 12), 0, 18.15, 0), color: '#333344' });
  parts.push({ geo: translate(new THREE.CylinderGeometry(0.9, 0.9, 2, 10), 0, 19.3, 0), color: '#fff6c8' });
  parts.push({ geo: translate(new THREE.ConeGeometry(1.3, 1.5, 12), 0, 21, 0), color: '#ff4f4f' });
  return coloredMerge(parts);
}
