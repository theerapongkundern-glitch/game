import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarDef, CarShape } from './CarDefs';

export interface WheelVisual {
  /** Steering pivot (rotates around Y). */
  pivot: THREE.Group;
  /** Spinning part (rotates around X). */
  spin: THREE.Group;
  front: boolean;
  left: boolean;
}

export interface CarVisual {
  root: THREE.Group;
  /** Body group that pitches/rolls with suspension. */
  body: THREE.Group;
  wheels: WheelVisual[];
  paint: THREE.MeshStandardMaterial;
  tailLights: THREE.MeshStandardMaterial;
  headLights: THREE.MeshStandardMaterial;
  flames: THREE.Mesh[];
  flameMat: THREE.MeshBasicMaterial;
  /** Rear exhaust positions in body space (for particles). */
  exhausts: THREE.Vector3[];
  /** Rear wheel contact points in root space (for smoke). */
  rearContacts: THREE.Vector3[];
  shape: CarShape;
  setColor(color: string): void;
  setOpacity(opacity: number): void;
  dispose(): void;
}

const tmpMatrix = new THREE.Matrix4();

function nonIndexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  // Keep only position/normal/uv so geometries can merge.
  for (const name of Object.keys(ng.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') ng.deleteAttribute(name);
  }
  ng.clearGroups();
  return ng;
}

function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const e = new THREE.Euler(rx, ry, rz);
  tmpMatrix.makeRotationFromEuler(e);
  tmpMatrix.setPosition(x, y, z);
  g.applyMatrix4(tmpMatrix);
  return g;
}

/** Side-profile extrusion: the profile is in (forward, up) and is extruded across the width. */
function extrudeProfile(points: [number, number][], width: number, bevel: number, curve = 10): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  const inner = points.slice(1, -1).map(([x, y]) => new THREE.Vector2(x, y));
  shape.splineThru(inner);
  const last = points[points.length - 1];
  shape.lineTo(last[0], last[1]);
  shape.lineTo(points[0][0], points[0][1]);
  const depth = Math.max(0.01, width - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: curve,
    steps: 1,
  });
  // Shape x = forward (+z in car space), y = up, extrude z = across width (x in car space).
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(-Math.PI / 2);
  // After rotation: forward is +z? rotateY(-90°) maps (x,0,0) -> (0,0,x). Width -> x.
  return geo;
}

export function buildCarModel(def: CarDef, color: string, quality: 'low' | 'medium' | 'high' = 'high'): CarVisual {
  const s = def.shape;
  const L = s.length;
  const W = s.width;
  const root = new THREE.Group();
  root.name = def.id;
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.3, envMapIntensity: 1.25 });
  const accent = new THREE.MeshStandardMaterial({ color: s.accent, metalness: 0.2, roughness: 0.35 });
  const trim = new THREE.MeshStandardMaterial({ color: '#1a1b24', metalness: 0.2, roughness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1c2a4a', metalness: 0.7, roughness: 0.08, envMapIntensity: 1.8 });
  const headLights = new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: '#fff4c8', emissiveIntensity: 1.6, roughness: 0.2 });
  const tailLights = new THREE.MeshStandardMaterial({ color: '#ff2a4a', emissive: '#ff1030', emissiveIntensity: 0.9, roughness: 0.3 });
  const tyre = new THREE.MeshStandardMaterial({ color: '#16161c', roughness: 0.85 });
  const rim = new THREE.MeshStandardMaterial({ color: s.rimColor, metalness: 0.75, roughness: 0.25 });

  const paintParts: THREE.BufferGeometry[] = [];
  const accentParts: THREE.BufferGeometry[] = [];
  const trimParts: THREE.BufferGeometry[] = [];
  const glassParts: THREE.BufferGeometry[] = [];
  const headParts: THREE.BufferGeometry[] = [];
  const tailParts: THREE.BufferGeometry[] = [];

  const clearance = s.clearance;
  const bodyTop = s.bodyHeight;
  const bevel = Math.min(0.12, W * 0.06);
  const curveSeg = quality === 'low' ? 6 : 10;

  // --- Lower body from the side profile ------------------------------------------------------
  // The extrude bevel grows the outline by `bevel` in every direction, so inset the profile
  // to keep the final body exactly L long and bodyTop high (lights sit on the real surface).
  const hx = L / 2 - bevel;
  const y0 = clearance + bevel;
  const y1 = bodyTop - bevel;
  const prof: [number, number][] = s.profile.map(([px, py]) => [hx - px * hx * 2, y0 + py * (y1 - y0)]);
  const profile: [number, number][] = [[hx, y0], ...prof, [-hx, y0]];
  paintParts.push(nonIndexed(extrudeProfile(profile, W, bevel, curveSeg)));

  // --- Cabin (glass) + roof ---------------------------------------------------------------
  const cf = L / 2 - s.cabinFrom * L;
  const ct = L / 2 - s.cabinTo * L;
  const cabinBase = bodyTop - 0.06;
  const cabinLen = cf - ct;
  const roofY = s.roofHeight;
  const cw = W * s.cabinWidth;
  const slopeF = cabinLen * (s.style === 'hyper' ? 0.42 : s.style === 'bubble' ? 0.3 : 0.28);
  const slopeR = cabinLen * (s.style === 'wagon' || s.style === 'hatch' ? 0.08 : s.style === 'hyper' ? 0.35 : 0.22);
  const cabinProfile: [number, number][] = [
    [cf, cabinBase],
    [cf - slopeF * 0.5, cabinBase + (roofY - cabinBase) * 0.62],
    [cf - slopeF, roofY],
    [ct + slopeR, roofY],
    [ct + slopeR * 0.3, cabinBase + (roofY - cabinBase) * 0.55],
    [ct, cabinBase],
  ];
  const cb = 0.06;
  const cabinInset: [number, number][] = cabinProfile.map(([x, y], i) => [x + (i < 3 ? -cb : cb), i === 0 || i === cabinProfile.length - 1 ? y : y - cb]);
  glassParts.push(nonIndexed(extrudeProfile(cabinInset, cw, cb, curveSeg)));
  // Roof panel in body colour.
  const roofLen = Math.max(0.3, cabinLen - slopeF - slopeR - 0.05);
  const roof = new THREE.BoxGeometry(cw * 0.96, 0.07, roofLen);
  paintParts.push(nonIndexed(place(roof, 0, roofY + 0.02, (cf - slopeF + ct + slopeR) / 2)));
  // Pillars.
  for (const side of [-1, 1]) {
    const pillar = new THREE.BoxGeometry(0.07, (roofY - cabinBase) * 1.05, 0.09);
    paintParts.push(nonIndexed(place(pillar, side * (cw / 2 - 0.02), (roofY + cabinBase) / 2, cf - slopeF * 0.55, -0.55, 0, 0)));
    const pillarR = new THREE.BoxGeometry(0.07, (roofY - cabinBase) * 1.0, 0.12);
    paintParts.push(nonIndexed(place(pillarR, side * (cw / 2 - 0.02), (roofY + cabinBase) / 2, ct + slopeR * 0.6, 0.35, 0, 0)));
  }

  // --- Racing stripes: roof centre + both flanks -------------------------------------------------
  {
    const stripeW = W * 0.16;
    const roofStripe = new THREE.BoxGeometry(stripeW, 0.02, roofLen * 0.98);
    accentParts.push(nonIndexed(place(roofStripe, 0, roofY + 0.065, (cf - slopeF + ct + slopeR) / 2)));
    for (const side of [-1, 1]) {
      const flank = new THREE.BoxGeometry(0.02, 0.07, L * 0.62);
      accentParts.push(nonIndexed(place(flank, side * (W / 2 + 0.004), clearance + (bodyTop - clearance) * 0.66, -L * 0.02)));
    }
  }

  // --- Bumpers, skirts, grille ---------------------------------------------------------------
  const bumperF = new THREE.BoxGeometry(W * 0.92, 0.18, 0.2);
  trimParts.push(nonIndexed(place(bumperF, 0, clearance + 0.12, L / 2 - 0.02)));
  const bumperR = new THREE.BoxGeometry(W * 0.92, 0.2, 0.2);
  trimParts.push(nonIndexed(place(bumperR, 0, clearance + 0.14, -L / 2 + 0.02)));
  for (const side of [-1, 1]) {
    const skirt = new THREE.BoxGeometry(0.08, 0.12, s.wheelbase * 0.62);
    trimParts.push(nonIndexed(place(skirt, side * (W / 2 - 0.01), clearance + 0.08, 0)));
  }
  const grille = new THREE.BoxGeometry(W * 0.5, 0.14, 0.05);
  trimParts.push(nonIndexed(place(grille, 0, clearance + (bodyTop - clearance) * 0.45, L / 2 + 0.005)));

  // --- Lights -------------------------------------------------------------------------------
  const hlY = clearance + (bodyTop - clearance) * 0.62;
  for (const side of [-1, 1]) {
    const hl = new THREE.BoxGeometry(W * 0.2, 0.1, 0.08);
    headParts.push(nonIndexed(place(hl, side * W * 0.3, hlY, L / 2 - 0.02)));
    const tl = new THREE.BoxGeometry(W * 0.24, 0.1, 0.08);
    tailParts.push(nonIndexed(place(tl, side * W * 0.3, clearance + (bodyTop - clearance) * 0.72, -L / 2 + 0.01)));
  }

  // --- Style features ------------------------------------------------------------------------
  const spoilerY = bodyTop + (s.spoiler === 'tall' ? 0.42 : 0.26);
  if (s.spoiler === 'wing' || s.spoiler === 'tall') {
    const wing = new THREE.BoxGeometry(W * 0.94, 0.05, 0.36);
    paintParts.push(nonIndexed(place(wing, 0, spoilerY, -L / 2 + 0.3, -0.08)));
    for (const side of [-1, 1]) {
      const post = new THREE.BoxGeometry(0.06, spoilerY - bodyTop + 0.05, 0.12);
      trimParts.push(nonIndexed(place(post, side * W * 0.3, (spoilerY + bodyTop) / 2, -L / 2 + 0.3)));
      const plate = new THREE.BoxGeometry(0.04, 0.2, 0.42);
      accentParts.push(nonIndexed(place(plate, side * W * 0.47, spoilerY + 0.04, -L / 2 + 0.3)));
    }
  } else if (s.spoiler === 'lip') {
    const lip = new THREE.BoxGeometry(W * 0.86, 0.06, 0.18);
    paintParts.push(nonIndexed(place(lip, 0, bodyTop + 0.03, -L / 2 + 0.16, 0.25)));
  } else if (s.spoiler === 'ducktail') {
    const duck = new THREE.BoxGeometry(W * 0.9, 0.1, 0.3);
    paintParts.push(nonIndexed(place(duck, 0, roofY + 0.02, -L / 2 + 0.55, 0.3)));
  }
  if (s.roofScoop) {
    const scoop = new THREE.BoxGeometry(W * 0.28, 0.12, 0.5);
    trimParts.push(nonIndexed(place(scoop, 0, s.style === 'wagon' ? bodyTop + 0.05 : roofY + 0.08, s.style === 'wagon' ? L / 2 - 0.9 : (cf + ct) / 2 + 0.2)));
  }
  if (s.sideVents) {
    for (const side of [-1, 1]) {
      const vent = new THREE.BoxGeometry(0.05, 0.14, 0.5);
      trimParts.push(nonIndexed(place(vent, side * (W / 2 + 0.005), clearance + (bodyTop - clearance) * 0.55, ct - 0.1)));
    }
  }
  if (s.roofRack) {
    for (const zz of [-0.3, 0.3]) {
      const bar = new THREE.BoxGeometry(cw * 1.02, 0.05, 0.05);
      trimParts.push(nonIndexed(place(bar, 0, roofY + 0.14, (cf + ct) / 2 + zz)));
    }
    for (const side of [-1, 1]) {
      const rail = new THREE.BoxGeometry(0.05, 0.05, roofLen * 0.9);
      trimParts.push(nonIndexed(place(rail, side * cw * 0.45, roofY + 0.1, (cf - slopeF + ct + slopeR) / 2)));
    }
  }
  if (s.bullbar) {
    const bar = new THREE.BoxGeometry(W * 0.7, 0.07, 0.07);
    trimParts.push(nonIndexed(place(bar, 0, clearance + 0.4, L / 2 + 0.16)));
    for (const side of [-1, 1]) {
      const post = new THREE.BoxGeometry(0.07, 0.4, 0.07);
      trimParts.push(nonIndexed(place(post, side * W * 0.3, clearance + 0.25, L / 2 + 0.14)));
    }
  }
  if (s.fins) {
    for (const side of [-1, 1]) {
      const fin = new THREE.BoxGeometry(0.05, 0.32, 0.8);
      accentParts.push(nonIndexed(place(fin, side * W * 0.34, bodyTop + 0.12, -L / 2 + 0.7, 0.2)));
    }
  }
  // Mirrors.
  for (const side of [-1, 1]) {
    const mirror = new THREE.BoxGeometry(0.2, 0.1, 0.08);
    paintParts.push(nonIndexed(place(mirror, side * (cw / 2 + 0.12), cabinBase + 0.12, cf - 0.05)));
  }
  // Underbody shadow plate (dark), avoids see-through under the car.
  const under = new THREE.BoxGeometry(W * 0.9, 0.04, L * 0.86);
  trimParts.push(nonIndexed(place(under, 0, clearance + 0.02, 0)));

  const addMerged = (parts: THREE.BufferGeometry[], mat: THREE.Material, cast = true) => {
    if (!parts.length) return;
    const g = mergeGeometries(parts, false);
    if (!g) return;
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast;
    m.receiveShadow = false;
    body.add(m);
    for (const p of parts) p.dispose();
  };
  addMerged(paintParts, paint);
  addMerged(accentParts, accent);
  addMerged(trimParts, trim);
  addMerged(glassParts, glass);
  addMerged(headParts, headLights, false);
  addMerged(tailParts, tailLights, false);

  // --- Wheels ---------------------------------------------------------------------------------
  const r = s.wheelRadius;
  const ww = s.wheelWidth;
  const segs = quality === 'low' ? 12 : 18;
  const tyreGeo = new THREE.CylinderGeometry(r, r, ww, segs, 1);
  tyreGeo.rotateZ(Math.PI / 2);
  const rimGeo = (() => {
    const disc = new THREE.CylinderGeometry(r * 0.64, r * 0.64, ww * 0.25, segs, 1);
    disc.rotateZ(Math.PI / 2);
    const parts = [nonIndexed(disc)];
    for (let k = 0; k < 5; k++) {
      const spoke = new THREE.BoxGeometry(ww * 0.18, r * 1.1, r * 0.16);
      spoke.rotateX((k / 5) * Math.PI * 2);
      parts.push(nonIndexed(spoke));
    }
    const g = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();
    return g;
  })();
  const wheels: WheelVisual[] = [];
  const track = W / 2 - ww * 0.35;
  for (const front of [true, false]) {
    for (const left of [true, false]) {
      const pivot = new THREE.Group();
      pivot.position.set(left ? track : -track, r, front ? s.wheelbase / 2 : -s.wheelbase / 2);
      const spin = new THREE.Group();
      pivot.add(spin);
      const t = new THREE.Mesh(tyreGeo, tyre);
      t.castShadow = true;
      spin.add(t);
      const rimMesh = new THREE.Mesh(rimGeo, rim);
      rimMesh.position.x = (left ? 1 : -1) * ww * 0.42;
      spin.add(rimMesh);
      root.add(pivot);
      wheels.push({ pivot, spin, front, left });
    }
  }

  // --- Boost flames -----------------------------------------------------------------------------
  const flameMat = new THREE.MeshBasicMaterial({ color: '#7fdcff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameGeo = new THREE.ConeGeometry(0.13, 1, 10, 1, true);
  flameGeo.rotateX(-Math.PI / 2);
  flameGeo.translate(0, 0, -0.5);
  const exhausts: THREE.Vector3[] = [];
  const flames: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const pos = new THREE.Vector3(side * W * 0.22, clearance + 0.12, -L / 2 - 0.05);
    exhausts.push(pos);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 8).rotateX(Math.PI / 2), rim);
    pipe.position.copy(pos);
    body.add(pipe);
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.copy(pos);
    f.visible = false;
    f.renderOrder = 5;
    body.add(f);
    flames.push(f);
  }

  const rearContacts = [new THREE.Vector3(track, 0.05, -s.wheelbase / 2), new THREE.Vector3(-track, 0.05, -s.wheelbase / 2)];

  const allMats = [paint, accent, trim, glass, headLights, tailLights, tyre, rim];
  return {
    root,
    body,
    wheels,
    paint,
    tailLights,
    headLights,
    flames,
    flameMat,
    exhausts,
    rearContacts,
    shape: s,
    setColor(c: string) {
      paint.color.set(c);
    },
    setOpacity(o: number) {
      for (const m of allMats) {
        m.transparent = o < 1;
        m.opacity = o;
        m.depthWrite = o >= 1;
      }
    },
    dispose() {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      for (const m of allMats) m.dispose();
      flameMat.dispose();
    },
  };
}
