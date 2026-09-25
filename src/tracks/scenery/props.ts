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
  const g = new THREE.DodecahedronGeometry(1, 0);
  g.scale(1.3, 0.8, 1.1);
  translate(g, 0, 0.35, 0);
  return coloredMerge([{ geo: g, color }]);
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
