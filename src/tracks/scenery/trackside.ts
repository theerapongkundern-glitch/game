import * as THREE from 'three';
import type { Track, TrackPath } from '../Track';
import type { TrackVisual } from '../TrackBuilder';
import type { ThemeStyle } from '../themes';
import { Rng } from '../../core/rng';
import { Bag, coloredMerge, translate } from './common';

/**
 * Start/finish atmosphere shared by every themed track: grandstands packed with a cheering
 * crowd, a catch fence, flags and sponsor-style banners (original slogans only).
 * Everything follows the track's own curve, so it fits whatever the start straight looks like.
 */

const SHIRTS = ['#ff4fa3', '#3de0ff', '#ffd23f', '#2ec27e', '#ff5a36', '#b44dff', '#ffffff', '#5b6cff', '#ff8a3d', '#a4e635'];
const SKIN = ['#f1c7a0', '#d9a37a', '#b27650', '#8a5a3c', '#f5d6b8', '#6b4430'];

const SLOGANS = ['PRISM RUSH', 'FULL THROTTLE', 'DRIFT HAPPY', 'GO GO GO!'];

export interface TracksideResult {
  group: THREE.Group;
  update(time: number): void;
  /** 0..1 how hard the crowd cheers (set at GO and at the finish). */
  setCheer(v: number): void;
  dispose(): void;
}

interface Frame {
  x: number;
  y: number;
  z: number;
  /** Outward unit vector (away from the road) on the chosen side. */
  ox: number;
  oz: number;
  tx: number;
  tz: number;
}

/** Samples the path from s0 to s1 (metres, may be negative) at a lateral offset on one side. */
function frames(path: TrackPath, s0: number, s1: number, side: 1 | -1, extra: number, step = 2): Frame[] {
  const out: Frame[] = [];
  const spacing = path.length / path.n;
  for (let s = s0; s <= s1 + 1e-6; s += step) {
    const f = (((s / spacing) % path.n) + path.n) % path.n;
    const i = Math.floor(f);
    const j = path.idx(i + 1);
    const k = f - i;
    const L = (a: Float32Array) => a[i] + (a[j] - a[i]) * k;
    const lim = side > 0 ? L(path.limitL) : L(path.limitR);
    const nx = L(path.nx) * side;
    const nz = L(path.nz) * side;
    const len = Math.hypot(nx, nz) || 1;
    const lat = lim + extra;
    out.push({ x: L(path.px) + (nx / len) * lat, y: L(path.py), z: L(path.pz) + (nz / len) * lat, ox: nx / len, oz: nz / len, tx: L(path.tx), tz: L(path.tz) });
  }
  return out;
}

/** Extrudes a 2D cross-section (outward, up) along a list of frames. Colours per segment. */
function sweep(fr: Frame[], profile: [number, number][], colors: string[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const c = colors.map((h) => new THREE.Color(h));
  for (let f = 0; f < fr.length - 1; f++) {
    const a = fr[f];
    const b = fr[f + 1];
    for (let p = 0; p < profile.length - 1; p++) {
      const [u0, v0] = profile[p];
      const [u1, v1] = profile[p + 1];
      const A0 = [a.x + a.ox * u0, a.y + v0, a.z + a.oz * u0];
      const A1 = [a.x + a.ox * u1, a.y + v1, a.z + a.oz * u1];
      const B0 = [b.x + b.ox * u0, b.y + v0, b.z + b.oz * u0];
      const B1 = [b.x + b.ox * u1, b.y + v1, b.z + b.oz * u1];
      pos.push(...A0, ...B0, ...A1, ...A1, ...B0, ...B1);
      const cc = c[p % c.length];
      for (let q = 0; q < 6; q++) col.push(cc.r, cc.g, cc.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Makes every triangle face away from `inside` (fixes winding for either track side). */
function faceOutwards(g: THREE.BufferGeometry, side: 1 | -1) {
  if (side > 0) return g;
  const p = g.attributes.position.array as Float32Array;
  const c = g.attributes.color.array as Float32Array;
  for (let i = 0; i < p.length; i += 9) {
    for (let q = 0; q < 3; q++) {
      [p[i + 3 + q], p[i + 6 + q]] = [p[i + 6 + q], p[i + 3 + q]];
      [c[i + 3 + q], c[i + 6 + q]] = [c[i + 6 + q], c[i + 3 + q]];
    }
  }
  g.computeVertexNormals();
  return g;
}

function bannerAtlas(theme: ThemeStyle): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  const bgs = [theme.gantry.banner, '#1b1446', theme.gantry.pillar, '#ffffff'];
  const fgs = [theme.gantry.text, '#ffd23f', '#ffffff', '#ff4fa3'];
  SLOGANS.forEach((text, i) => {
    const y = i * 128;
    ctx.fillStyle = bgs[i];
    ctx.fillRect(0, y, 1024, 128);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let k = 0; k < 12; k++) ctx.fillRect(k * 90 - 20, y, 30, 128);
    ctx.fillStyle = fgs[i];
    ctx.font = 'italic 900 84px "Baloo 2 Variable", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, y + 68);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function fenceTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = 'rgba(210,215,225,1)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let k = -64; k <= 128; k += 16) {
    ctx.moveTo(k, 0);
    ctx.lineTo(k + 64, 64);
    ctx.moveTo(k + 64, 0);
    ctx.lineTo(k, 64);
  }
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function buildTrackside(track: Track, visual: TrackVisual, theme: ThemeStyle, density: number, shadows: boolean, night: boolean): TracksideResult {
  const group = new THREE.Group();
  group.name = 'trackside';
  const bag = new Bag();
  const rng = new Rng(track.def.seed + 991);
  const main = track.main;
  const uniforms = { uTime: { value: 0 }, uCheer: { value: 0.25 } };
  const hasDoc = typeof document !== 'undefined';

  // Is the band beside the road free (no other stretch of track running through it)?
  const clear = (fr: Frame[], depth: number) =>
    fr.every((f) => {
      for (const d of [2, depth * 0.5, depth]) {
        const q = visual.distanceToTrack(f.x + f.ox * d, f.z + f.oz * d);
        if (q.dist < q.limit + 0.5) return false;
      }
      return true;
    });

  const standMat = bag.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 }));
  const crowdMat = bag.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  crowdMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uCheer;')
      // White vertices take the instance (shirt) colour; heads keep their skin tone.
      .replace('#include <common>', '#include <common>\nattribute vec3 aSkin;')
      .replace('#include <color_vertex>', 'vColor = vec4(1.0);\n#ifdef USE_INSTANCING_COLOR\nvColor.rgb = color.r > 0.9 ? instanceColor.rgb : aSkin;\n#endif')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ph = float(gl_InstanceID) * 1.37;
        float jump = max(0.0, sin(uTime * (6.0 + fract(ph) * 3.0) + ph * 5.0));
        transformed.y += jump * mix(0.03, 0.22, uCheer) * step(0.35, fract(ph * 0.61));`,
      );
  };
  crowdMat.customProgramCacheKey = () => 'prism-crowd-1';

  // Person: white body (takes the instance shirt colour) and a grey-marked head (takes the
  // per-instance skin tone), so the whole crowd is a single draw call.
  const personGeo = bag.add(
    coloredMerge([
      { geo: translate(new THREE.BoxGeometry(0.42, 0.62, 0.3), 0, 0.31, 0), color: '#ffffff' },
      { geo: translate(new THREE.IcosahedronGeometry(0.15, 0), 0, 0.78, 0), color: '#808080' },
    ]),
  );

  const stands: { side: 1 | -1; s0: number; s1: number; rows: number }[] = [
    { side: 1, s0: -46, s1: 22, rows: 8 },
    { side: -1, s0: -30, s1: 10, rows: 6 },
  ];
  const people: { x: number; y: number; z: number; yaw: number }[] = [];
  const standParts: THREE.BufferGeometry[] = [];
  const roofParts: THREE.BufferGeometry[] = [];
  const excl = visual.exclusions;
  const roofColor = theme.gantry.pillar;
  const seatA = theme.gantry.banner;
  const seatB = '#f2f4ff';
  for (const st of stands) {
    const gap = 3.2;
    const tread = 0.9;
    const riser = 0.48;
    const depth = 0.3 + st.rows * tread + 0.4;
    const fr = frames(main, st.s0, st.s1, st.side, gap);
    if (!clear(fr, depth + 2)) continue;
    // Cross-section: front wall, stepped tiers, back wall down to the ground.
    const prof: [number, number][] = [[0, -2], [0, 1.2], [0.3, 1.2]];
    const cols: string[] = ['#c9ccd6', '#c9ccd6'];
    for (let k = 0; k < st.rows; k++) {
      const y = 1.2 + k * riser;
      prof.push([0.3 + k * tread, y + riser], [0.3 + (k + 1) * tread, y + riser]);
      cols.push(k % 2 ? seatA : seatB, '#b8bcc8');
    }
    const top = 1.2 + st.rows * riser;
    prof.push([depth, top], [depth, -2]);
    cols.push('#9fa3b0', '#8d91a0');
    standParts.push(faceOutwards(sweep(fr, prof, cols), st.side));
    // Roof slab over the stand, held up by columns at the back.
    const roofY = top + 3.4;
    const roofProf: [number, number][] = [[-0.6, roofY], [depth + 0.4, roofY + 0.9], [depth + 0.4, roofY + 1.2], [-0.6, roofY + 0.3], [-0.6, roofY]];
    roofParts.push(faceOutwards(sweep(fr, roofProf, [roofColor, roofColor, '#ffffff', roofColor]), st.side));
    for (let f = 0; f < fr.length; f += 4) {
      const p = fr[f];
      const colH = roofY + 0.9 + 2;
      const colGeo = new THREE.BoxGeometry(0.35, colH, 0.35);
      colGeo.translate(p.x + p.ox * (depth + 0.1), p.y - 2 + colH / 2, p.z + p.oz * (depth + 0.1));
      roofParts.push(coloredMerge([{ geo: colGeo, color: '#7d8190' }]));
    }
    // Crowd.
    for (let k = 0; k < st.rows; k++) {
      for (let f = 0; f < fr.length - 1; f++) {
        const a = fr[f];
        const b = fr[f + 1];
        for (let q = 0; q < 3; q++) {
          if (!rng.chance(0.78 * Math.min(1, density + 0.2))) continue;
          const t = (q + rng.range(0.1, 0.9)) / 3;
          const u = 0.3 + k * tread + tread * 0.55;
          const x = a.x + (b.x - a.x) * t + a.ox * u;
          const z = a.z + (b.z - a.z) * t + a.oz * u;
          const y = a.y + (b.y - a.y) * t + 1.2 + (k + 1) * riser;
          people.push({ x, y, z, yaw: Math.atan2(-a.ox, -a.oz) + rng.range(-0.3, 0.3) });
        }
      }
    }
    for (let f = 0; f < fr.length; f += 3) {
      const p = fr[f];
      excl.push({ x: p.x + p.ox * depth * 0.5, z: p.z + p.oz * depth * 0.5, r: depth * 0.5 + 5 });
    }
    // Catch fence between barrier and stand.
    if (hasDoc) {
      const ff = frames(main, st.s0 - 4, st.s1 + 4, st.side, 1.4);
      const fg = sweep(ff, [[0, 0], [0, 3.4]], ['#ffffff']);
      const uv: number[] = [];
      let run = 0;
      for (let f = 0; f < ff.length - 1; f++) {
        const len = Math.hypot(ff[f + 1].x - ff[f].x, ff[f + 1].z - ff[f].z);
        const u0 = run / 1.2;
        const u1 = (run + len) / 1.2;
        run += len;
        uv.push(u0, 0, u1, 0, u0, 3.4 / 1.2, u0, 3.4 / 1.2, u1, 0, u1, 3.4 / 1.2);
      }
      fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      const fenceMat = bag.add(new THREE.MeshStandardMaterial({ map: bag.add(fenceTexture()), alphaTest: 0.45, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4, transparent: false }));
      const fence = new THREE.Mesh(bag.add(fg), fenceMat);
      group.add(fence);
      for (let f = 0; f < ff.length; f += 2) {
        const p = ff[f];
        const post = new THREE.CylinderGeometry(0.06, 0.06, 3.6, 6);
        post.translate(p.x, p.y + 1.8, p.z);
        roofParts.push(coloredMerge([{ geo: post, color: '#9aa0ae' }]));
      }
    }
  }
  if (standParts.length) {
    const g = bag.add(mergeAll(standParts));
    const m = new THREE.Mesh(g, standMat);
    m.receiveShadow = true;
    m.castShadow = shadows;
    group.add(m);
  }
  if (roofParts.length) {
    const g = bag.add(mergeAll(roofParts));
    const m = new THREE.Mesh(g, standMat);
    m.castShadow = shadows;
    group.add(m);
  }
  // Instanced crowd.
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3(1, 1, 1);
  if (people.length) {
    const g = personGeo.clone();
    const skin = new Float32Array(people.length * 3);
    const mesh = new THREE.InstancedMesh(bag.add(g), crowdMat, people.length);
    const c = new THREE.Color();
    people.forEach((p, i) => {
      _e.set(0, p.yaw, 0);
      _q.setFromEuler(_e);
      const sc = rng.range(0.9, 1.12);
      _s.set(sc, sc, sc);
      _p.set(p.x, p.y, p.z);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, c.set(rng.pick(SHIRTS)));
      c.set(rng.pick(SKIN)).toArray(skin, i * 3);
    });
    g.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 3));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // Flags on tall poles along both sides of the start straight.
  {
    const flagGeo = bag.add(new THREE.PlaneGeometry(1.8, 1.1, 8, 1));
    flagGeo.translate(0.9, 0, 0);
    const flagMat = bag.add(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }));
    flagMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float fph = float(gl_InstanceID) * 2.1;
        transformed.z += sin(uTime * 5.0 - position.x * 2.6 + fph) * 0.16 * (position.x / 1.8);
        transformed.y -= (position.x / 1.8) * 0.12;`,
      );
    };
    flagMat.customProgramCacheKey = () => 'prism-flag-1';
    const poleGeo = bag.add(new THREE.CylinderGeometry(0.05, 0.07, 7, 6).translate(0, 3.5, 0));
    const poleMat = bag.add(new THREE.MeshStandardMaterial({ color: '#dfe3ea', metalness: 0.7, roughness: 0.3 }));
    const spots: Frame[] = [];
    for (const side of [1, -1] as const) {
      const fr = frames(main, -60, 40, side, 0.9, 12);
      for (const f of fr) {
        const q = visual.distanceToTrack(f.x, f.z);
        if (q.dist >= q.limit + 0.3) spots.push(f);
      }
    }
    const flags = new THREE.InstancedMesh(flagGeo, flagMat, Math.max(1, spots.length));
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, Math.max(1, spots.length));
    flags.count = poles.count = spots.length;
    spots.forEach((f, i) => {
      _p.set(f.x, f.y, f.z);
      _q.identity();
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      poles.setMatrixAt(i, _m);
      _p.set(f.x, f.y + 6.3, f.z);
      _e.set(0, Math.atan2(f.tx, f.tz) + Math.PI / 2 + (i % 2 ? 0.3 : -0.3), 0);
      _q.setFromEuler(_e);
      _m.compose(_p, _q, _s);
      flags.setMatrixAt(i, _m);
      flags.setColorAt(i, new THREE.Color(rng.pick(SHIRTS)));
    });
    flags.computeBoundingSphere();
    poles.computeBoundingSphere();
    poles.castShadow = shadows;
    group.add(flags, poles);
  }

  // Banner boards on short posts just behind the barrier.
  if (hasDoc) {
    const tex = bag.add(bannerAtlas(theme));
    const mat = bag.add(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: night ? 0.9 : 0.15, roughness: 0.55 }));
    const parts: THREE.BufferGeometry[] = [];
    let n = 0;
    for (const side of [1, -1] as const) {
      const fr = frames(main, -90, 70, side, 0.35, 14);
      for (const f of fr) {
        const q = visual.distanceToTrack(f.x, f.z);
        if (q.dist < q.limit + 0.1) continue;
        const row = n++ % SLOGANS.length;
        const g = new THREE.PlaneGeometry(6, 1.1);
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (row + 1 - uv.getY(i)) / 4);
        g.rotateY(Math.atan2(-f.ox, -f.oz));
        g.translate(f.x, f.y + theme.barrier.height + 0.85, f.z);
        parts.push(g.toNonIndexed());
        g.dispose();
      }
    }
    if (parts.length) {
      const g = bag.add(mergeUv(parts));
      const m = new THREE.Mesh(g, mat);
      group.add(m);
    }
  }

  return {
    group,
    update(time: number) {
      uniforms.uTime.value = time;
    },
    setCheer(v: number) {
      uniforms.uCheer.value = v;
    },
    dispose: () => bag.dispose(),
  };
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    col.set(g.attributes.color.array as Float32Array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

function mergeUv(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    uv.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}
