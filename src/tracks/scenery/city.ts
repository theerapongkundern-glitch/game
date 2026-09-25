import * as THREE from 'three';
import type { Track } from '../Track';
import type { TrackVisual } from '../TrackBuilder';
import { Rng } from '../../core/rng';
import { Bag, instanced, scatter, vcMat, type Placement, type SceneryResult } from './common';
import { lampGeometry } from './props';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ParticleSystem } from '../../core/Particles';
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
        float whash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
        // Window grid mask (x) and lit flag (y) for side faces.
        vec2 winInfo() {
          vec3 n = abs(vWNormal);
          if (n.y >= 0.5) return vec2(0.0);
          float u = n.x > n.z ? vWPos.z : vWPos.x;
          vec2 cell = vec2(u / 3.2, vWPos.y / 3.6);
          vec2 f = fract(cell);
          vec2 id = floor(cell);
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.8) * step(1.5, vWPos.y);
          float h = whash(id + floor(vWPos.xz / 40.0));
          return vec2(win, step(0.58, h));
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        vec2 wi = winInfo();
        // Dark windows are glass: mirror-smooth and reflective (they pick up the sky and neon).
        roughnessFactor = mix(roughnessFactor, 0.05, wi.x * (1.0 - wi.y));`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.85, wi.x * (1.0 - wi.y));`,
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

  // --- Neon signs (text): one atlas texture, all signs merged into a single mesh -----------
  const signPlaces = scatter(visual, rng, b, Math.floor(26 * density) + 6, { minGap: 3, maxDist: 34, scale: [1, 1] });
  {
    const atlas = bag.add(signAtlas());
    const signMat = bag.add(new THREE.MeshBasicMaterial({ map: atlas, color: new THREE.Color(1.6, 1.6, 1.6), side: THREE.DoubleSide }));
    const poleMat = bag.add(new THREE.MeshStandardMaterial({ color: '#222033', roughness: 0.5, metalness: 0.5 }));
    const signGeos: THREE.BufferGeometry[] = [];
    const poleGeos: THREE.BufferGeometry[] = [];
    const tmp = new THREE.Object3D();
    signPlaces.forEach((sp, i) => {
      const row = i % SIGNS.length;
      const g = new THREE.PlaneGeometry(10, 2.5);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (row + 1 - uv.getY(k)) / SIGNS.length);
      let best = 0;
      let bd = Infinity;
      for (let k = 0; k < main.n; k += 3) {
        const dd = (main.px[k] - sp.x) ** 2 + (main.pz[k] - sp.z) ** 2;
        if (dd < bd) {
          bd = dd;
          best = k;
        }
      }
      tmp.position.set(sp.x, sp.y + rng.range(6, 14), sp.z);
      tmp.lookAt(main.px[best], tmp.position.y, main.pz[best]);
      tmp.updateMatrix();
      g.applyMatrix4(tmp.matrix);
      signGeos.push(g.toNonIndexed());
      g.dispose();
      const h = tmp.position.y - sp.y;
      const pole = new THREE.CylinderGeometry(0.15, 0.15, h, 5);
      pole.translate(sp.x, sp.y + h / 2 - 1.2, sp.z);
      poleGeos.push(pole.toNonIndexed());
      pole.dispose();
    });
    if (signGeos.length) {
      group.add(new THREE.Mesh(bag.add(mergeGeometries(signGeos)!), signMat));
      group.add(new THREE.Mesh(bag.add(mergeGeometries(poleGeos)!), poleMat));
      for (const g of [...signGeos, ...poleGeos]) g.dispose();
    }
  }

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

  // --- Wet-road reflections of the neon barriers (additive streaks along the edges) ---------
  {
    const tex = bag.add(new THREE.CanvasTexture(makeStreaks()));
    tex.wrapT = THREE.RepeatWrapping;
    const refl = bag.add(new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color('#3de0ff').multiplyScalar(0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (const side of [1, -1]) {
      let prev = -1;
      for (let k = 0; k <= main.n; k++) {
        const i = k % main.n;
        const gap = side > 0 ? main.gapL[i] : main.gapR[i];
        const lim = side > 0 ? main.limitL[i] : main.limitR[i];
        const hw = main.hw[i];
        const row = pos.length / 3;
        for (const [lat, u] of [[Math.min(hw, lim) - 2.6, 0], [Math.min(hw, lim) - 0.1, 1]] as const) {
          const l = lat * side;
          pos.push(main.px[i] + main.nx[i] * l, main.py[i] + Math.tan(main.bank[i]) * l + 0.03, main.pz[i] + main.nz[i] * l);
          uv.push(u, (k * SAMPLE_SPACING) / 9);
        }
        if (prev >= 0 && !gap) idx.push(prev, row, prev + 1, prev + 1, row, row + 1);
        prev = row;
      }
    }
    const g = bag.add(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, refl);
    mesh.renderOrder = 3;
    group.add(mesh);
  }

  // --- Overpass bridge crossing the track --------------------------------------------------
  {
    const concrete = bag.add(new THREE.MeshStandardMaterial({ color: '#3a3552', roughness: 0.8, metalness: 0.1 }));
    const glowMat = bag.add(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff4fa3').multiplyScalar(2.2) }));
    for (let tries = 0, i = Math.floor(main.n * 0.35); tries < 40; tries++, i = (i + 7) % main.n) {
      let straight = true;
      for (let k = -8; k <= 8; k++) if (Math.abs(main.curv[main.idx(i + k)]) > 0.006) straight = false;
      if (!straight) continue;
      const span = Math.max(main.limitL[i], main.limitR[i]) + 7;
      const ends = [1, -1].map((sd) => ({ x: main.px[i] + main.nx[i] * span * sd, z: main.pz[i] + main.nz[i] * span * sd }));
      if (!ends.every((e) => { const d = visual.distanceToTrack(e.x, e.z); return d.dist > d.limit + 1.5; })) continue;
      const yaw = Math.atan2(main.nx[i], main.nz[i]);
      const y0 = main.py[i];
      const solid: THREE.BufferGeometry[] = [];
      const glow: THREE.BufferGeometry[] = [];
      const put = (g: THREE.BufferGeometry, x: number, y: number, z: number, list: THREE.BufferGeometry[]) => {
        g.rotateY(yaw);
        g.translate(x, y, z);
        list.push(g.index ? g.toNonIndexed() : g);
      };
      put(new THREE.BoxGeometry(9, 1.3, span * 2 + 4), main.px[i], y0 + 10, main.pz[i], solid);
      for (const sd of [-1, 1]) {
        put(new THREE.BoxGeometry(0.3, 1.1, span * 2 + 4), main.px[i] + main.tx[i] * 4.4 * sd, y0 + 11.2, main.pz[i] + main.tz[i] * 4.4 * sd, solid);
        put(new THREE.BoxGeometry(0.2, 0.2, span * 2 + 4), main.px[i] + main.tx[i] * 4.5 * sd, y0 + 9.3, main.pz[i] + main.tz[i] * 4.5 * sd, glow);
      }
      for (const e of ends) {
        put(new THREE.BoxGeometry(2.2, 10, 2.2), e.x, y0 + 5, e.z, solid);
        visual.exclusions.push({ x: e.x, z: e.z, r: 5 });
      }
      const deck = new THREE.Mesh(bag.add(mergeGeometries(solid)!), concrete);
      deck.castShadow = true;
      group.add(deck, new THREE.Mesh(bag.add(mergeGeometries(glow)!), glowMat));
      break;
    }
  }

  // --- Traffic lights on the verge (cycle green -> amber -> red) --------------------------
  const tlLamps = ['#ff3040', '#ffb020', '#30ff70'].map((c) => bag.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(c) })));
  {
    const darkMat = bag.add(new THREE.MeshStandardMaterial({ color: '#1a1826', roughness: 0.5, metalness: 0.6 }));
    const parts: THREE.BufferGeometry[] = [];
    const lamps: THREE.BufferGeometry[][] = [[], [], []];
    for (let t = 0; t < 6; t++) {
      const i = Math.floor(((t + 0.25) / 6) * main.n);
      if (main.gapR[i]) continue;
      const lat = -(main.limitR[i] + 0.8);
      const x = main.px[i] + main.nx[i] * lat;
      const z = main.pz[i] + main.nz[i] * lat;
      const y = main.py[i];
      const yaw = Math.atan2(main.nx[i], main.nz[i]);
      const tmp = new THREE.Object3D();
      tmp.position.set(x, y, z);
      tmp.rotation.y = yaw;
      tmp.updateMatrix();
      const add = (g: THREE.BufferGeometry, list: THREE.BufferGeometry[]) => {
        g.applyMatrix4(tmp.matrix);
        list.push(g.index ? g.toNonIndexed() : g);
      };
      add(new THREE.CylinderGeometry(0.12, 0.16, 6.2, 6).translate(0, 3.1, 0), parts);
      add(new THREE.BoxGeometry(0.16, 0.16, 4.2).translate(0, 6.0, 2.1), parts);
      add(new THREE.BoxGeometry(0.55, 1.5, 0.45).translate(0, 5.1, 3.9), parts);
      for (let k = 0; k < 3; k++) add(new THREE.SphereGeometry(0.16, 8, 6).translate(0, 5.55 - k * 0.45, 3.9 - 0.25), lamps[k]);
    }
    if (parts.length) {
      group.add(new THREE.Mesh(bag.add(mergeGeometries(parts)!), darkMat));
      lamps.forEach((list, k) => group.add(new THREE.Mesh(bag.add(mergeGeometries(list)!), tlLamps[k])));
    }
  }

  // --- Manhole steam ----------------------------------------------------------------------------
  const steam = new ParticleSystem(Math.floor(260 * Math.max(0.4, density)), 'soft');
  bag.add(steam);
  group.add(steam.points);
  const vents: { x: number; y: number; z: number }[] = [];
  for (let v = 0; v < 9; v++) {
    const i = Math.floor(((v + 0.6) / 9) * main.n);
    const sd = v % 2 ? 1 : -1;
    const lat = (main.hw[i] - 1.6) * sd;
    vents.push({ x: main.px[i] + main.nx[i] * lat, y: main.py[i] + 0.05, z: main.pz[i] + main.nz[i] * lat });
  }
  let steamAcc = 0;

  // --- Animated screen billboards ---------------------------------------------------------------
  const screenTex = bag.add(new THREE.CanvasTexture(makeScreen()));
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.wrapS = THREE.RepeatWrapping;
  {
    const mat = bag.add(new THREE.MeshBasicMaterial({ map: screenTex, color: new THREE.Color(1.5, 1.5, 1.5) }));
    const frameMat = bag.add(new THREE.MeshStandardMaterial({ color: '#1a1826', roughness: 0.4, metalness: 0.7 }));
    const spots = scatter(visual, rng, b, 4, { minGap: 6, maxDist: 45, scale: [1, 1] });
    const tmp = new THREE.Object3D();
    const screens: THREE.BufferGeometry[] = [];
    const frames: THREE.BufferGeometry[] = [];
    for (const sp of spots) {
      let best = 0;
      let bd = Infinity;
      for (let k = 0; k < main.n; k += 3) {
        const dd = (main.px[k] - sp.x) ** 2 + (main.pz[k] - sp.z) ** 2;
        if (dd < bd) {
          bd = dd;
          best = k;
        }
      }
      tmp.position.set(sp.x, sp.y + 16, sp.z);
      tmp.lookAt(main.px[best], tmp.position.y, main.pz[best]);
      tmp.updateMatrix();
      screens.push(new THREE.PlaneGeometry(16, 9).applyMatrix4(tmp.matrix).toNonIndexed());
      frames.push(new THREE.BoxGeometry(17, 10, 0.6).translate(0, 0, -0.35).applyMatrix4(tmp.matrix).toNonIndexed());
      frames.push(new THREE.CylinderGeometry(0.5, 0.6, 12, 8).translate(sp.x, sp.y + 6, sp.z).toNonIndexed());
    }
    if (screens.length) {
      group.add(new THREE.Mesh(bag.add(mergeGeometries(screens)!), mat));
      group.add(new THREE.Mesh(bag.add(mergeGeometries(frames)!), frameMat));
    }
  }

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
    update(time, dt, focus) {
      // Traffic light cycle: green 3 s, amber 1 s, red 2 s.
      const ph = time % 6;
      const on = ph < 3 ? 2 : ph < 4 ? 1 : 0;
      tlLamps.forEach((m, k) => m.color.set(['#ff3040', '#ffb020', '#30ff70'][k]).multiplyScalar(k === on ? 2.6 : 0.12));
      screenTex.offset.x = (time * 0.05) % 1;
      steamAcc += dt;
      while (steamAcc > 0.09) {
        steamAcc -= 0.09;
        const v = vents[Math.floor(steam.random() * vents.length)];
        steam.emit({ x: v.x, y: v.y + 0.3, z: v.z, vx: (steam.random() - 0.5) * 0.5, vy: 2.4 + steam.random() * 1.2, vz: (steam.random() - 0.5) * 0.5, spread: 0.4, life: 2.8, size: 0.7, endSize: 4.5, r: 0.5, g: 0.55, b: 0.72, alpha: 0.13, drag: 0.35 });
      }
      steam.update(dt);
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

function signAtlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128 * SIGNS.length;
  const ctx = c.getContext('2d')!;
  SIGNS.forEach((word, i) => {
    const y = i * 128;
    const col = NEON[i % NEON.length];
    ctx.fillStyle = '#0b0820';
    ctx.fillRect(0, y, 512, 128);
    ctx.strokeStyle = col;
    ctx.lineWidth = 6;
    ctx.shadowColor = col;
    ctx.shadowBlur = 14;
    ctx.strokeRect(8, y + 8, 496, 112);
    ctx.fillStyle = col;
    ctx.font = 'italic 900 78px "Baloo 2 Variable", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(word, 256, y + 68);
    ctx.shadowBlur = 0;
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeStreaks(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(64, 256);
  const rnd = (n: number) => Math.abs(Math.sin(n * 127.1) * 43758.5453) % 1;
  for (let y = 0; y < 256; y++) {
    const streak = 0.35 + 0.65 * rnd(Math.floor(y / 6) + 1);
    for (let x = 0; x < 64; x++) {
      const u = x / 63;
      const a = Math.pow(u, 2.2) * streak * (0.6 + 0.4 * rnd(x * 3 + Math.floor(y / 3)));
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(a * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function makeScreen(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const panels: [string, string, string][] = [
    ['#ff4fa3', '#5b3cff', 'NEON NIGHTS'],
    ['#3de0ff', '#1b1446', 'ZOOM ZOOM'],
    ['#ffd23f', '#ff5a36', 'BOOST UP!'],
    ['#a4e635', '#0b7a5a', 'PRISM FM'],
  ];
  panels.forEach(([a, bgc, text], i) => {
    const x = i * 256;
    const g = ctx.createLinearGradient(x, 0, x + 256, 256);
    g.addColorStop(0, a);
    g.addColorStop(1, bgc);
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 256, 256);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let k = 0; k < 8; k++) ctx.fillRect(x, k * 32, 256, 14);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'italic 900 44px "Baloo 2 Variable", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 128, 128);
  });
  return c;
}
