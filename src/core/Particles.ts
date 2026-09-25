import * as THREE from 'three';
import { softDotTexture, sparkTexture } from '../tracks/textures';
import type { Quality } from './Renderer';

const vert = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / max(0.1, -mvPosition.z), 0.0, 256.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const frag = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.004) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface EmitOptions {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  spread?: number;
  life?: number;
  size?: number;
  endSize?: number;
  r?: number;
  g?: number;
  b?: number;
  alpha?: number;
  gravity?: number;
  drag?: number;
}

/**
 * Pooled CPU particle system rendered as a single THREE.Points draw call.
 * Dead particles are swap-removed so only live ones are uploaded and drawn.
 */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly max: number;
  private count = 0;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly a0: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private rngState = 1234567;

  constructor(max: number, kind: 'soft' | 'spark', blending: THREE.Blending = THREE.NormalBlending) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    const ca = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    const sa = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', pa);
    this.geo.setAttribute('aColor', ca);
    this.geo.setAttribute('aSize', sa);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uMap: { value: kind === 'spark' ? sparkTexture() : softDotTexture() }, uScale: { value: 500 } },
      ]),
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending,
      fog: true,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    const size = new THREE.Vector2();
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      const cam = camera as THREE.PerspectiveCamera;
      renderer.getCurrentViewport(tmpV4);
      renderer.getSize(size);
      const h = tmpV4.w > 0 ? tmpV4.w : size.y * renderer.getPixelRatio();
      this.mat.uniforms.uScale.value = h / (2 * Math.tan(((cam.fov ?? 60) * Math.PI) / 360));
    };
  }

  private rand() {
    // xorshift for speed + determinism
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState / 4294967296;
  }

  emit(o: EmitOptions) {
    let i: number;
    if (this.count < this.max) i = this.count++;
    else i = Math.floor(this.rand() * this.max); // recycle a random particle when full
    const sp = o.spread ?? 0;
    this.pos[i * 3] = o.x + (this.rand() - 0.5) * sp;
    this.pos[i * 3 + 1] = o.y + (this.rand() - 0.5) * sp * 0.5;
    this.pos[i * 3 + 2] = o.z + (this.rand() - 0.5) * sp;
    this.vel[i * 3] = o.vx ?? 0;
    this.vel[i * 3 + 1] = o.vy ?? 0;
    this.vel[i * 3 + 2] = o.vz ?? 0;
    const life = (o.life ?? 1) * (0.75 + this.rand() * 0.5);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = o.size ?? 1;
    this.s1[i] = o.endSize ?? o.size ?? 1;
    this.a0[i] = o.alpha ?? 1;
    this.col[i * 4] = o.r ?? 1;
    this.col[i * 4 + 1] = o.g ?? 1;
    this.col[i * 4 + 2] = o.b ?? 1;
    this.col[i * 4 + 3] = this.a0[i];
    this.size[i] = this.s0[i];
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0.5;
  }

  random() {
    return this.rand();
  }

  update(dt: number) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const k = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= d;
      this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt;
      this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      // Fade in quickly, fade out smoothly.
      const fade = Math.min(1, t * 8) * (1 - t * t);
      this.col[i * 4 + 3] = this.a0[i] * fade;
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  private copy(from: number, to: number) {
    if (from === to) return;
    for (let c = 0; c < 3; c++) {
      this.pos[to * 3 + c] = this.pos[from * 3 + c];
      this.vel[to * 3 + c] = this.vel[from * 3 + c];
    }
    for (let c = 0; c < 4; c++) this.col[to * 4 + c] = this.col[from * 4 + c];
    this.size[to] = this.size[from];
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.s0[to] = this.s0[from];
    this.s1[to] = this.s1[from];
    this.a0[to] = this.a0[from];
    this.grav[to] = this.grav[from];
    this.drag[to] = this.drag[from];
  }

  clear() {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  get alive() {
    return this.count;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

const tmpV4 = new THREE.Vector4();

/**
 * Motion-stretched sparks: each particle is a short additive line from its position back
 * along its velocity, so fast sparks read as streaks instead of dots.
 */
export class StreakSystem {
  readonly points: THREE.LineSegments;
  private readonly max: number;
  private count = 0;
  private readonly p: Float32Array;
  private readonly v: Float32Array;
  private readonly c0: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.LineBasicMaterial;
  private rngState = 987654;

  constructor(max: number) {
    this.max = max;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.c0 = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.pos = new Float32Array(max * 6);
    this.col = new Float32Array(max * 6);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.points = new THREE.LineSegments(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
  }

  random() {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState / 4294967296;
  }

  emit(o: EmitOptions) {
    const i = this.count < this.max ? this.count++ : Math.floor(this.random() * this.max);
    this.p[i * 3] = o.x;
    this.p[i * 3 + 1] = o.y;
    this.p[i * 3 + 2] = o.z;
    this.v[i * 3] = o.vx ?? 0;
    this.v[i * 3 + 1] = o.vy ?? 0;
    this.v[i * 3 + 2] = o.vz ?? 0;
    this.c0[i * 3] = o.r ?? 1;
    this.c0[i * 3 + 1] = o.g ?? 1;
    this.c0[i * 3 + 2] = o.b ?? 1;
    const life = (o.life ?? 0.4) * (0.75 + this.random() * 0.5);
    this.life[i] = this.maxLife[i] = life;
    this.grav[i] = o.gravity ?? 9;
    this.drag[i] = o.drag ?? 1;
  }

  update(dt: number) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        if (i !== n) {
          for (let k = 0; k < 3; k++) {
            this.p[i * 3 + k] = this.p[n * 3 + k];
            this.v[i * 3 + k] = this.v[n * 3 + k];
            this.c0[i * 3 + k] = this.c0[n * 3 + k];
          }
          this.life[i] = this.life[n];
          this.maxLife[i] = this.maxLife[n];
          this.grav[i] = this.grav[n];
          this.drag[i] = this.drag[n];
        }
        i--;
        continue;
      }
      const k = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.v[k] *= d;
      this.v[k + 1] = this.v[k + 1] * d - this.grav[i] * dt;
      this.v[k + 2] *= d;
      this.p[k] += this.v[k] * dt;
      this.p[k + 1] += this.v[k + 1] * dt;
      this.p[k + 2] += this.v[k + 2] * dt;
      const fade = this.life[i] / this.maxLife[i];
      const o = i * 6;
      const tail = 0.035;
      this.pos[o] = this.p[k];
      this.pos[o + 1] = this.p[k + 1];
      this.pos[o + 2] = this.p[k + 2];
      this.pos[o + 3] = this.p[k] - this.v[k] * tail;
      this.pos[o + 4] = this.p[k + 1] - this.v[k + 1] * tail;
      this.pos[o + 5] = this.p[k + 2] - this.v[k + 2] * tail;
      for (let q = 0; q < 3; q++) {
        this.col[o + q] = this.c0[k + q] * fade;
        this.col[o + 3 + q] = this.c0[k + q] * fade * 0.15;
      }
    }
    this.count = n;
    this.geo.setDrawRange(0, n * 2);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  clear() {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  get alive() {
    return this.count;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** All particle effects used in a race, grouped for convenience. */
export class Effects {
  readonly smoke: ParticleSystem;
  readonly dust: ParticleSystem;
  readonly sparks: ParticleSystem;
  readonly glow: ParticleSystem;
  /** Stretched spark streaks (wall scrapes, bumps). */
  readonly streaks: StreakSystem;
  readonly group = new THREE.Group();
  /** 0..1 particle density multiplier from quality settings. */
  density = 1;

  constructor(quality: Quality) {
    const scale = quality === 'low' ? 0.4 : quality === 'medium' ? 0.7 : quality === 'ultra' ? 1.3 : 1;
    this.density = scale;
    this.smoke = new ParticleSystem(Math.floor(900 * scale) + 50, 'soft', THREE.NormalBlending);
    this.dust = new ParticleSystem(Math.floor(700 * scale) + 50, 'soft', THREE.NormalBlending);
    this.sparks = new ParticleSystem(Math.floor(400 * scale) + 40, 'spark', THREE.AdditiveBlending);
    this.glow = new ParticleSystem(Math.floor(900 * scale) + 40, 'soft', THREE.AdditiveBlending);
    this.streaks = new StreakSystem(Math.floor(500 * scale) + 40);
    this.group.add(this.smoke.points, this.dust.points, this.sparks.points, this.glow.points, this.streaks.points);
  }

  update(dt: number) {
    this.smoke.update(dt);
    this.dust.update(dt);
    this.sparks.update(dt);
    this.glow.update(dt);
    this.streaks.update(dt);
  }

  clear() {
    this.smoke.clear();
    this.dust.clear();
    this.sparks.clear();
    this.glow.clear();
    this.streaks.clear();
  }

  /** Probabilistic emission helper so effects scale with quality. */
  chance(p: number) {
    return this.smoke.random() < p * this.density;
  }

  dispose() {
    this.smoke.dispose();
    this.dust.dispose();
    this.sparks.dispose();
    this.glow.dispose();
    this.streaks.dispose();
  }
}
