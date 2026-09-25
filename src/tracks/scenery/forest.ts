import * as THREE from 'three';
import type { Track } from '../Track';
import type { TrackVisual } from '../TrackBuilder';
import { Rng } from '../../core/rng';
import { Bag, instanced, scatter, vcMat, type SceneryResult } from './common';
import type { SceneryExtras } from './common';
import { cabinGeometry, grassTexture, grassTuftGeometry, leafyTreeGeometry, logGeometry, mountainGeometry, mushroomGeometry, needleTexture, pineFoliageGeometry, pineTrunkGeometry, rockGeometry } from './props';
import { SKY_PRESETS } from '../../core/Sky';
import { distantRing } from './distant';
import { findSpot } from './beach';
import { softDotTexture } from '../textures';

/** Pinecrest Ridge: dense pines, autumn trees, giant mushrooms, a cabin, snowy peaks, fireflies. */
export function buildForestScenery(track: Track, visual: TrackVisual, density: number, shadows: boolean, extras: SceneryExtras = { grass: 0, godRays: false }): SceneryResult {
  const group = new THREE.Group();
  const bag = new Bag();
  const rng = new Rng(track.def.seed);
  const b = track.bounds;
  const mat = bag.add(vcMat({ flatShading: true }));
  const water = -5;
  const dry = (_x: number, _z: number, y: number) => y > water + 0.6;

  // Pines: vertex-coloured trunks + alpha-tested needle foliage (two instanced meshes).
  const pines = scatter(visual, rng, b, Math.floor(900 * density) + 100, { minGap: 2.5, maxDist: 260, scale: [0.8, 1.9], hug: 0.55, accept: dry });
  const tallness = new Map(pines.map((p) => [p, rng.range(0.9, 1.25)] as const));
  const needles = bag.add(needleTexture());
  needles.repeat.set(3, 1);
  const needleMat = bag.add(new THREE.MeshStandardMaterial({ map: needles, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }));
  group.add(instanced(bag.add(pineTrunkGeometry()), mat, pines, { cast: shadows, scaleY: (p) => p.scale * (tallness.get(p) ?? 1) }));
  const pineTint = ['#ffffff', '#e8f5d0', '#d6ecd8', '#f2ffe0'].map((c) => new THREE.Color(c));
  group.add(instanced(bag.add(pineFoliageGeometry()), needleMat, pines, { cast: shadows, scaleY: (p) => p.scale * (tallness.get(p) ?? 1), color: (_p, i) => pineTint[i % pineTint.length] }));

  const leafy = bag.add(leafyTreeGeometry());
  const leafies = scatter(visual, rng, b, Math.floor(220 * density) + 30, { minGap: 3, maxDist: 160, scale: [0.9, 1.5], accept: dry });
  const autumn = ['#f08a3c', '#ffb13d', '#e8683a', '#ffd23f', '#d9534f'].map((c) => new THREE.Color(c));
  group.add(instanced(leafy, mat, leafies, { cast: shadows, color: (_p, i) => (i % 3 === 0 ? autumn[i % autumn.length] : null) }));

  const rock = bag.add(rockGeometry('#8c8f99'));
  group.add(instanced(rock, mat, scatter(visual, rng, b, Math.floor(120 * density), { minGap: 2, maxDist: 200, scale: [0.6, 3] }), { tilt: 0.4 }));

  const mush = bag.add(mushroomGeometry());
  group.add(instanced(mush, mat, scatter(visual, rng, b, 24, { minGap: 2, maxDist: 30, scale: [1, 2.2], accept: dry })));

  const log = bag.add(logGeometry());
  group.add(instanced(log, mat, scatter(visual, rng, b, Math.floor(40 * density), { minGap: 2, maxDist: 60, scale: [0.7, 1.2], accept: dry })));

  const cabin = new THREE.Mesh(bag.add(cabinGeometry()), mat);
  const spot = findSpot(visual, rng, b, 14, 40, () => true);
  cabin.position.set(spot.x, spot.y, spot.z);
  cabin.rotation.y = rng.range(0, 6.28);
  cabin.castShadow = shadows;
  group.add(cabin);

  group.add(distantRing(bag, b, mountainGeometry('#ffffff', '#4a6a8a', '#6a7fa8'), 22, 1000, [220, 420], [200, 360], rng, mat, -10));

  // --- Wind-blown grass along the verges (High+) -------------------------------------------
  const main = track.main;
  const windU = { uTime: { value: 0 } };
  if (extras.grass > 0) {
    const tufts: { x: number; y: number; z: number; rot: number; scale: number; dist: number }[] = [];
    const want = Math.floor(14000 * extras.grass);
    for (let t = 0; t < want * 3 && tufts.length < want; t++) {
      const k = rng.int(0, main.n - 1);
      const side = rng.chance(0.5) ? 1 : -1;
      const lim = side > 0 ? main.limitL[k] : main.limitR[k];
      const lat = (main.hw[k] + 1.3 + Math.pow(rng.next(), 1.6) * (lim - main.hw[k] + 9)) * side;
      const x = main.px[k] + main.nx[k] * lat + rng.range(-1, 1);
      const z = main.pz[k] + main.nz[k] * lat + rng.range(-1, 1);
      const d = visual.distanceToTrack(x, z);
      if (d.dist < main.hw[k] + 1.2) continue;
      const y = visual.terrainHeight(x, z);
      if (y < water + 0.4) continue;
      tufts.push({ x, y, z, rot: rng.range(0, 6.28), scale: rng.range(0.7, 1.5), dist: d.dist });
    }
    const gt = bag.add(grassTexture());
    const gmat = bag.add(new THREE.MeshStandardMaterial({ map: gt, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }));
    gmat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, windU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 wpos = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float sway = sin(uTime * 1.8 + wpos.x * 0.35 + wpos.z * 0.22) * 0.5 + sin(uTime * 3.1 + wpos.x) * 0.2;
        transformed.x += sway * 0.12 * uv.y * uv.y;
        transformed.z += sway * 0.06 * uv.y * uv.y;`,
      );
      // Both faces of a card light like the ground it grows from (no dark back faces).
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    };
    gmat.customProgramCacheKey = () => 'prism-grass-1';
    const tint = ['#ffffff', '#e0f0c0', '#fff3c8', '#cfe8b0'].map((c) => new THREE.Color(c));
    group.add(instanced(bag.add(grassTuftGeometry()), gmat, tufts, { color: (_p, i) => tint[i % tint.length] }));
  }

  // --- Valley mist: soft horizontal layers drifting over low ground -------------------------
  const sky = SKY_PRESETS[track.def.sky];
  const mistTex = bag.add(new THREE.CanvasTexture(mistCanvas()));
  const mistMat = bag.add(new THREE.MeshBasicMaterial({ map: mistTex, color: sky.fog, transparent: true, opacity: 0.5, depthWrite: false, fog: true }));
  const mistSpots = scatter(visual, rng, b, 14, { minGap: 25, maxDist: 320, scale: [60, 130] });
  const mist = new THREE.InstancedMesh(bag.add(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), mistMat, Math.max(1, mistSpots.length));
  mist.count = mistSpots.length;
  {
    const m4 = new THREE.Matrix4();
    mistSpots.forEach((sp, i) => {
      m4.compose(new THREE.Vector3(sp.x, Math.max(water, sp.y) + rng.range(3, 7), sp.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sp.rot, 0)), new THREE.Vector3(sp.scale, 1, sp.scale * 0.6));
      mist.setMatrixAt(i, m4);
    });
    mist.instanceMatrix.needsUpdate = true;
    mist.computeBoundingSphere();
    mist.renderOrder = 4;
    group.add(mist);
  }

  // --- Low-sun light shafts between the trees (Ultra) ---------------------------------------
  let shafts: THREE.InstancedMesh | null = null;
  if (extras.godRays) {
    const el = (sky.sunElevation * Math.PI) / 180;
    const az = (sky.sunAzimuth * Math.PI) / 180;
    const sun = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    const shaftTex = bag.add(new THREE.CanvasTexture(shaftCanvas()));
    const shaftMat = bag.add(new THREE.MeshBasicMaterial({ map: shaftTex, color: new THREE.Color(sky.sunColor).multiplyScalar(0.55), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    const geo2 = new THREE.PlaneGeometry(4, 46);
    const geo3 = geo2.clone().rotateY(Math.PI / 2);
    const cross = bag.add(mergeTwo(geo2, geo3));
    const spots = scatter(visual, rng, b, 36, { minGap: 1, maxDist: 60, scale: [0.7, 1.6] });
    shafts = new THREE.InstancedMesh(cross, shaftMat, Math.max(1, spots.length));
    shafts.count = spots.length;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sun);
    const m4 = new THREE.Matrix4();
    spots.forEach((sp, i) => {
      const pos = new THREE.Vector3(sp.x, sp.y + 4, sp.z).addScaledVector(sun, 20);
      m4.compose(pos, q, new THREE.Vector3(sp.scale, 1, sp.scale));
      shafts!.setMatrixAt(i, m4);
    });
    shafts.instanceMatrix.needsUpdate = true;
    shafts.computeBoundingSphere();
    shafts.renderOrder = 5;
    group.add(shafts);
  }

  // Fireflies drifting near the road.
  const count = Math.floor(260 * density);
  const geo = bag.add(new THREE.BufferGeometry());
  const pos = new Float32Array(count * 3);
  const base = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const k = rng.int(0, main.n - 1);
    const side = rng.chance(0.5) ? 1 : -1;
    const lat = (main.limitL[k] + rng.range(1, 20)) * side;
    base[i * 3] = main.px[k] + main.nx[k] * lat;
    base[i * 3 + 1] = main.py[k] + rng.range(0.5, 4);
    base[i * 3 + 2] = main.pz[k] + main.nz[k] * lat;
  }
  pos.set(base);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const fmat = bag.add(
    new THREE.PointsMaterial({ color: new THREE.Color(2.2, 2.0, 0.8), size: 0.45, map: softDotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
  );
  const flies = new THREE.Points(geo, fmat);
  flies.frustumCulled = false;
  group.add(flies);

  return {
    group,
    update(time) {
      for (let i = 0; i < count; i++) {
        const o = i * 1.7;
        pos[i * 3] = base[i * 3] + Math.sin(time * 0.6 + o) * 1.2;
        pos[i * 3 + 1] = base[i * 3 + 1] + Math.sin(time * 0.9 + o * 2) * 0.6;
        pos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(time * 0.5 + o) * 1.2;
      }
      (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      fmat.opacity = 0.6 + Math.sin(time * 3) * 0.2;
      windU.uTime.value = time;
      mistMat.opacity = 0.42 + Math.sin(time * 0.2) * 0.08;
      mistTex.offset.set((time * 0.004) % 1, (time * 0.002) % 1);
    },
    dispose: () => bag.dispose(),
  };
}

function mistCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    const x = 20 + rnd() * 88;
    const y = 20 + rnd() * 88;
    const r = 14 + rnd() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  return c;
}

function shaftCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(32, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 32; x++) {
      const u = Math.abs(x / 31 - 0.5) * 2;
      const v = y / 127;
      const a = Math.pow(1 - u, 2) * Math.sin(Math.PI * v) * (0.5 + 0.5 * Math.sin(v * 9 + x * 0.4));
      const i = (y * 32 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(Math.max(0, a) * 110);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const A = a.toNonIndexed();
  const B = b.toNonIndexed();
  a.dispose();
  b.dispose();
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const x = A.attributes[name].array as Float32Array;
    const y = B.attributes[name].array as Float32Array;
    const arr = new Float32Array(x.length + y.length);
    arr.set(x);
    arr.set(y, x.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, A.attributes[name].itemSize));
  }
  A.dispose();
  B.dispose();
  return out;
}
