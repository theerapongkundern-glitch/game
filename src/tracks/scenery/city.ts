import * as THREE from 'three';
import type { Track } from '../Track';
import type { TrackVisual } from '../TrackBuilder';
import { Rng } from '../../core/rng';
import { Bag, instanced, scatter, vcMat, type Placement, type SceneryResult } from './common';
import { lampGeometry } from './props';
import { bannerTexture } from '../textures';
import { SAMPLE_SPACING } from '../Track';

const NEON = ['#ff4fa3', '#3de0ff', '#ffd23f', '#a4e635', '#b44dff', '#ff8a3d'];
const SIGNS = ['PRISM', 'ZOOM!', 'NOODLES', 'ARCADE', 'RADIO 88', 'DRIFT', 'MOCHI', 'VOLT'];

/** Building material with procedural lit windows computed from world position. */
function buildingMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.2, color: '#ffffff' });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
        #endif
        vWPos = (modelMatrix * wp4).xyz;
        vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wn = mat3(instanceMatrix) * wn;
        #endif
        vWNormal = normalize(mat3(modelMatrix) * wn);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNormal;
        float whash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 n = abs(vWNormal);
          if (n.y < 0.5) {
            float u = n.x > n.z ? vWPos.z : vWPos.x;
            vec2 cell = vec2(u / 3.2, vWPos.y / 3.6);
            vec2 f = fract(cell);
            vec2 id = floor(cell);
            float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.8);
            float h = whash(id + floor(vWPos.xz / 40.0));
            float lit = step(0.58, h);
            vec3 wc = mix(vec3(1.0, 0.82, 0.5), mix(vec3(0.4, 0.9, 1.0), vec3(1.0, 0.45, 0.8), step(0.8, h)), step(0.7, h));
            totalEmissiveRadiance += win * lit * wc * 0.9 * step(1.5, vWPos.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.06, 0.12), win * (1.0 - lit) * 0.6);
          }
        }`,
      );
  };
  return mat;
}

/** Neon Nightway: glowing towers, neon signs, street lamps, arches over the road, rain. */
export function buildCityScenery(track: Track, visual: TrackVisual, density: number, _shadows: boolean): SceneryResult {
  const group = new THREE.Group();
  const bag = new Bag();
  const rng = new Rng(track.def.seed);
  const b = track.bounds;
  const main = track.main;

  // --- Buildings ------------------------------------------------------------------------
  const box = bag.add(new THREE.BoxGeometry(1, 1, 1));
  box.translate(0, 0.5, 0);
  const bmat = bag.add(buildingMaterial());
  const blds = scatter(visual, rng, b, Math.floor(260 * density) + 60, { minGap: 4, maxDist: 240, scale: [1, 1], hug: 0.5 });
  const bmesh = new THREE.InstancedMesh(box, bmat, blds.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tones = ['#2a2f5a', '#3b2d6b', '#1f3a5c', '#402a5a', '#2d2440', '#243b6b'];
  blds.forEach((bl, i) => {
    const near = bl.dist < 60;
    const w = rng.range(14, 30);
    const d = rng.range(14, 30);
    const h = near ? rng.range(18, 60) : rng.range(35, 130);
    // Face the building toward the track (align to nearest track heading roughly).
    q.setFromEuler(new THREE.Euler(0, Math.round(bl.rot / (Math.PI / 2)) * (Math.PI / 2) + 0.0, 0));
    s.set(w, h, d);
    p.set(bl.x, bl.y - 1, bl.z);
    m.compose(p, q, s);
    bmesh.setMatrixAt(i, m);
    bmesh.setColorAt(i, new THREE.Color(rng.pick(tones)));
  });
  bmesh.instanceMatrix.needsUpdate = true;
  bmesh.computeBoundingSphere();
  group.add(bmesh);

  // Rooftop neon trims.
  const trimMat = bag.add(new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  const trimGeo = bag.add(new THREE.BoxGeometry(1, 1, 1));
  const tmesh = new THREE.InstancedMesh(trimGeo, trimMat, blds.length);
  blds.forEach((_bl, i) => {
    bmesh.getMatrixAt(i, m);
    m.decompose(p, q, s);
    p.y += s.y;
    s.set(s.x * 1.02, 0.5, s.z * 1.02);
    m.compose(p, q, s);
    tmesh.setMatrixAt(i, m);
    tmesh.setColorAt(i, new THREE.Color(rng.pick(NEON)).multiplyScalar(1.6));
  });
  tmesh.instanceMatrix.needsUpdate = true;
  tmesh.computeBoundingSphere();
  group.add(tmesh);

  // --- Neon signs (text) --------------------------------------------------------------
  const signPlaces = scatter(visual, rng, b, Math.floor(26 * density) + 6, { minGap: 3, maxDist: 34, scale: [1, 1] });
  signPlaces.forEach((sp, i) => {
    const word = SIGNS[i % SIGNS.length];
    const color = NEON[i % NEON.length];
    const tex = bannerTexture(word, '#0b0820', color, 512, 128);
    const mat = bag.add(new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6), side: THREE.DoubleSide }));
    const g = bag.add(new THREE.PlaneGeometry(10, 2.5));
    const mesh = new THREE.Mesh(g, mat);
    // Face the nearest track point.
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < main.n; k += 3) {
      const dd = (main.px[k] - sp.x) ** 2 + (main.pz[k] - sp.z) ** 2;
      if (dd < bd) {
        bd = dd;
        best = k;
      }
    }
    mesh.position.set(sp.x, sp.y + rng.range(6, 14), sp.z);
    mesh.lookAt(main.px[best], mesh.position.y, main.pz[best]);
    group.add(mesh);
    // Pole.
    const pole = new THREE.Mesh(bag.add(new THREE.CylinderGeometry(0.15, 0.15, mesh.position.y - sp.y, 5)), bag.add(new THREE.MeshStandardMaterial({ color: '#222033' })));
    pole.position.set(sp.x, sp.y + (mesh.position.y - sp.y) / 2 - 1.2, sp.z);
    group.add(pole);
  });

  // --- Street lamps along both sides ---------------------------------------------------
  const lamp = bag.add(lampGeometry());
  const lampPlaces: Placement[] = [];
  const headPlaces: { x: number; y: number; z: number }[] = [];
  const step = Math.round(34 / SAMPLE_SPACING);
  for (let i = 0; i < main.n; i += step) {
    for (const side of [1, -1]) {
      if ((side > 0 ? main.gapL[i] : main.gapR[i]) === 1) continue;
      const lat = (side > 0 ? main.limitL[i] : main.limitR[i]) + 1.2;
      const x = main.px[i] + main.nx[i] * lat * side;
      const z = main.pz[i] + main.nz[i] * lat * side;
      const heading = Math.atan2(-main.nx[i] * side, -main.nz[i] * side);
      lampPlaces.push({ x, y: main.py[i], z, rot: heading, scale: 1, dist: lat });
      headPlaces.push({ x: x - main.nx[i] * side * 2.2, y: main.py[i] + 6.9, z: z - main.nz[i] * side * 2.2 });
    }
  }
  const lampMat = bag.add(vcMat({ roughness: 0.6 }));
  group.add(instanced(lamp, lampMat, lampPlaces));
  const headGeo = bag.add(new THREE.BoxGeometry(0.5, 0.15, 1.2));
  const headMat = bag.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.1, 1.6) }));
  const heads = new THREE.InstancedMesh(headGeo, headMat, headPlaces.length);
  headPlaces.forEach((h, i) => {
    m.makeTranslation(h.x, h.y, h.z);
    heads.setMatrixAt(i, m);
  });
  heads.instanceMatrix.needsUpdate = true;
  heads.computeBoundingSphere();
  group.add(heads);
  // Light pools on the road (fake lights, additive decals).
  const poolTex = bag.add(new THREE.CanvasTexture(makePool()));
  const poolMat = bag.add(new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: '#ffcf8a', opacity: 0.45 }));
  const poolGeo = bag.add(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2));
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, headPlaces.length);
  headPlaces.forEach((h, i) => {
    m.makeTranslation(h.x, h.y - 6.85, h.z);
    pools.setMatrixAt(i, m);
  });
  pools.instanceMatrix.needsUpdate = true;
  pools.computeBoundingSphere();
  pools.renderOrder = 2;
  group.add(pools);

  // --- Neon arches over the road --------------------------------------------------------
  const archMats = NEON.map((c) => bag.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2) })));
  const archCount = 6;
  for (let a = 0; a < archCount; a++) {
    const i = Math.floor(((a + 0.5) / archCount) * main.n);
    const hw = Math.max(main.limitL[i], main.limitR[i]) + 1;
    const torus = bag.add(new THREE.TorusGeometry(hw, 0.35, 6, 24, Math.PI));
    const mesh = new THREE.Mesh(torus, archMats[a % archMats.length]);
    mesh.position.set(main.px[i], main.py[i], main.pz[i]);
    mesh.rotation.y = Math.atan2(main.tx[i], main.tz[i]) + Math.PI / 2;
    mesh.scale.set(1, 0.75, 1);
    group.add(mesh);
  }

  // --- Distant skyline ---------------------------------------------------------------------
  const skyGeo = bag.add(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const skyline = new THREE.InstancedMesh(skyGeo, bmat, 70);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const r0 = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 380;
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2;
    const r = r0 + rng.range(0, 250);
    q.setFromEuler(new THREE.Euler(0, rng.range(0, 6.28), 0));
    s.set(rng.range(30, 70), rng.range(80, 260), rng.range(30, 70));
    p.set(cx + Math.cos(a) * r, -2, cz + Math.sin(a) * r);
    m.compose(p, q, s);
    skyline.setMatrixAt(i, m);
    skyline.setColorAt(i, new THREE.Color(rng.pick(tones)));
  }
  skyline.instanceMatrix.needsUpdate = true;
  skyline.frustumCulled = false;
  group.add(skyline);

  // --- Rain ------------------------------------------------------------------------------------
  const rainCount = Math.floor(1400 * density);
  const rainGeo = bag.add(new THREE.BufferGeometry());
  const rainPos = new Float32Array(rainCount * 6);
  const area = 60;
  for (let i = 0; i < rainCount; i++) {
    const x = rng.range(-area, area);
    const y = rng.range(0, 40);
    const z = rng.range(-area, area);
    rainPos.set([x, y, z, x + 0.05, y - 0.9, z], i * 6);
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = bag.add(new THREE.LineBasicMaterial({ color: '#9fb8ff', transparent: true, opacity: 0.35, depthWrite: false }));
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  group.add(rain);

  return {
    group,
    update(time, _dt, focus) {
      if (focus) {
        // Rain volume follows the player and scrolls downward.
        const fall = (time * 32) % 40;
        rain.position.set(Math.floor(focus.x / 4) * 4, focus.y - fall + 20, Math.floor(focus.z / 4) * 4);
      }
    },
    dispose: () => bag.dispose(),
  };
}

function makePool(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return c;
}
