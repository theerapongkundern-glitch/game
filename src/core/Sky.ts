import * as THREE from 'three';
import type { SkyPresetId } from '../tracks/types';
import { Sky as PhysicalSky } from 'three/examples/jsm/objects/Sky.js';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';

export interface SkyPreset {
  top: string;
  horizon: string;
  bottom: string;
  sunColor: string;
  /** Sun elevation / azimuth in degrees. */
  sunElevation: number;
  sunAzimuth: number;
  sunIntensity: number;
  sunDisc: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fog: string;
  fogDensity: number;
  clouds: number;
  cloudColor: string;
  stars: number;
  exposure: number;
  /** Bloom strength used on High quality. */
  bloom: number;
  night: boolean;
  /** Physical (Preetham) sky parameters, used on Medium+ for daytime presets. */
  turbidity: number;
  rayleigh: number;
  mie: number;
  mieG: number;
  /** Brightness of the physical sky relative to the scene. */
  skyGain: number;
  /** 0..1: how much the physical sky takes on the preset's art-directed hues. */
  stylize: number;
}

export const SKY_PRESETS: Record<SkyPresetId, SkyPreset> = {
  day: {
    top: '#2f7dff',
    horizon: '#bfe8ff',
    bottom: '#d7f0ff',
    sunColor: '#fff4d6',
    sunElevation: 52,
    sunAzimuth: 35,
    sunIntensity: 2.8,
    sunDisc: 1,
    hemiSky: '#cfe9ff',
    hemiGround: '#8b9b62',
    hemiIntensity: 1.25,
    fog: '#bfe3ff',
    fogDensity: 0.0016,
    clouds: 0.55,
    cloudColor: '#ffffff',
    stars: 0,
    exposure: 1.0,
    bloom: 0.25,
    night: false,
    turbidity: 2.2,
    rayleigh: 1.4,
    mie: 0.004,
    mieG: 0.8,
    skyGain: 0.18,
    stylize: 0.2,
  },
  sunset: {
    top: '#3a2d8f',
    horizon: '#ff9a5c',
    bottom: '#ffb37a',
    sunColor: '#ffb070',
    sunElevation: 11,
    sunAzimuth: -60,
    sunIntensity: 2.6,
    sunDisc: 1.4,
    hemiSky: '#ffc2a0',
    hemiGround: '#5a4a6a',
    hemiIntensity: 1.1,
    fog: '#f0a07c',
    fogDensity: 0.0019,
    clouds: 0.6,
    cloudColor: '#ff9fc0',
    stars: 0,
    exposure: 1.05,
    bloom: 0.45,
    night: false,
    turbidity: 7,
    rayleigh: 2.6,
    mie: 0.006,
    mieG: 0.86,
    skyGain: 0.8,
    stylize: 0.6,
  },
  golden: {
    top: '#3f76d8',
    horizon: '#ffd79c',
    bottom: '#ffe0b0',
    sunColor: '#ffd08a',
    sunElevation: 24,
    sunAzimuth: 120,
    sunIntensity: 3.0,
    sunDisc: 1.2,
    hemiSky: '#ffe2b8',
    hemiGround: '#b7704a',
    hemiIntensity: 1.15,
    fog: '#f6d2a2',
    fogDensity: 0.0014,
    clouds: 0.3,
    cloudColor: '#fff0dc',
    stars: 0,
    exposure: 1.0,
    bloom: 0.3,
    night: false,
    turbidity: 5,
    rayleigh: 1.8,
    mie: 0.005,
    mieG: 0.84,
    skyGain: 0.2,
    stylize: 0.3,
  },
  night: {
    top: '#050822',
    horizon: '#2c1f63',
    bottom: '#1a1240',
    sunColor: '#8fa8ff',
    sunElevation: 38,
    sunAzimuth: -140,
    sunIntensity: 0.55,
    sunDisc: 0.6,
    hemiSky: '#7a6ae0',
    hemiGround: '#2a1d4a',
    hemiIntensity: 1.35,
    fog: '#241a55',
    fogDensity: 0.0022,
    clouds: 0.25,
    cloudColor: '#3b2f7a',
    stars: 1,
    exposure: 1.1,
    bloom: 0.72,
    night: true,
    turbidity: 2,
    rayleigh: 1,
    mie: 0.004,
    mieG: 0.8,
    skyGain: 1,
    stylize: 0.0,
  },
  dusk: {
    top: '#23307a',
    horizon: '#f58fa0',
    bottom: '#e38a9a',
    sunColor: '#ff9d8a',
    sunElevation: 6,
    sunAzimuth: 80,
    sunIntensity: 2.0,
    sunDisc: 1.2,
    hemiSky: '#d9a0c0',
    hemiGround: '#40305a',
    hemiIntensity: 1.1,
    fog: '#c98aa8',
    fogDensity: 0.002,
    clouds: 0.5,
    cloudColor: '#ffb0c8',
    stars: 0.35,
    exposure: 1.05,
    bloom: 0.5,
    night: false,
    turbidity: 6,
    rayleigh: 3,
    mie: 0.006,
    mieG: 0.88,
    skyGain: 0.9,
    stylize: 0.5,
  },
};

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const frag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uSunDisc;
uniform float uClouds;
uniform vec3 uCloudColor;
uniform float uStars;
uniform float uMoon;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uBottom, smoothstep(0.0, -0.25, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 6.0 * uSunDisc + pow(sd, 18.0) * 0.35 + pow(sd, 3.0) * 0.12);
  // Clouds on a virtual plane.
  if (h > 0.0 && uClouds > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 0.9;
    float n = fbm(uv * 1.3 + vec2(uTime * 0.004, uTime * 0.002));
    float c = smoothstep(0.52, 0.85, n) * smoothstep(0.0, 0.18, h) * uClouds;
    vec3 cc = mix(uCloudColor, uSunColor, pow(sd, 6.0) * 0.6);
    col = mix(col, cc, c * 0.85);
  }
  // Stars.
  if (uStars > 0.0 && h > 0.02) {
    vec2 g = floor(d.xz / (h + 0.3) * 160.0);
    float s = hash(g);
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 40.0);
    col += vec3(step(0.9965, s) * tw * uStars * smoothstep(0.02, 0.3, h));
  }
  // Moon (opposite-ish to the hidden sun direction, high in the sky).
  if (uMoon > 0.0) {
    vec3 md = normalize(vec3(-uSunDir.x, 0.55, -uSunDir.z));
    float m = max(dot(d, md), 0.0);
    col += vec3(0.95, 0.97, 1.0) * smoothstep(0.99955, 0.9997, m) * 2.5;
    col += vec3(0.5, 0.55, 0.95) * pow(m, 60.0) * 0.35;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Radial glow + ring textures for the sun lens flare (generated, no images). */
function flareTexture(kind: 'glow' | 'ring' | 'hex'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  if (kind === 'glow') {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.15, 'rgba(255,245,220,0.8)');
    g.addColorStop(0.5, 'rgba(255,200,140,0.15)');
    g.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  } else if (kind === 'ring') {
    const g = ctx.createRadialGradient(64, 64, 40, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.6, 'rgba(160,220,255,0.35)');
    g.addColorStop(0.8, 'rgba(255,160,220,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  } else {
    ctx.translate(64, 64);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * 58, Math.sin(a) * 58);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 60);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0.05)');
    ctx.fillStyle = g;
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface SkyOptions {
  /** Use the physical (Preetham) sky for daytime presets. */
  physical: boolean;
  /** Add a sun lens flare. */
  flare: boolean;
}

/**
 * Sky dome + sun/hemisphere lights + fog, configured by a preset. Daytime presets use a
 * physically based atmosphere (with lit, drifting clouds) on Medium+; night uses a
 * stylised gradient with stars and a moon so the neon city stays colourful.
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly sunDir = new THREE.Vector3();
  readonly physical: boolean;
  preset: SkyPreset;
  private flare: Lensflare | null = null;
  private readonly flareTex: THREE.Texture[] = [];

  constructor(
    readonly id: SkyPresetId,
    opts: SkyOptions = { physical: false, flare: false },
  ) {
    const p = (this.preset = SKY_PRESETS[id]);
    const el = (p.sunElevation * Math.PI) / 180;
    const az = (p.sunAzimuth * Math.PI) / 180;
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    this.physical = opts.physical && !p.night;
    if (this.physical) {
      const sky = new PhysicalSky();
      const mat = sky.material as THREE.ShaderMaterial;
      const u = mat.uniforms;
      u.turbidity.value = p.turbidity;
      u.rayleigh.value = p.rayleigh;
      u.mieCoefficient.value = p.mie;
      u.mieDirectionalG.value = p.mieG;
      u.sunPosition.value.copy(this.sunDir);
      u.cloudCoverage.value = p.clouds * 0.75;
      u.cloudDensity.value = 0.5;
      u.cloudElevation.value = 0.55;
      u.cloudScale.value = 0.00025;
      // Scale to our exposure and melt the horizon into the tuned (vibrant) fog colour.
      u.uSkyGain = { value: p.skyGain };
      u.uHaze = { value: new THREE.Color(p.fog) };
      u.uTop = { value: new THREE.Color(p.top) };
      u.uHorizon = { value: new THREE.Color(p.horizon) };
      u.uStylize = { value: p.stylize };
      mat.fragmentShader = mat.fragmentShader
        .replace('uniform float time;', 'uniform float time;\nuniform float uSkyGain;\nuniform vec3 uHaze;\nuniform vec3 uTop;\nuniform vec3 uHorizon;\nuniform float uStylize;')
        .replace(
          'gl_FragColor = vec4( texColor, 1.0 );',
          `texColor *= uSkyGain;
          // Pull the hue toward the preset gradient (luminance preserved) to keep the palette vibrant.
          vec3 grad = mix( uHorizon, uTop, pow( clamp( direction.y, 0.0, 1.0 ), 0.55 ) );
          const vec3 LW = vec3( 0.2126, 0.7152, 0.0722 );
          vec3 tinted = grad * ( dot( texColor, LW ) / max( dot( grad, LW ), 0.02 ) );
          texColor = mix( texColor, tinted, uStylize );
          // Soft-knee compression keeps the sun glow from flooding the bloom pass.
          float pk = max( max( texColor.r, texColor.g ), max( texColor.b, 1e-4 ) );
          if ( pk > 0.9 ) texColor *= ( 0.9 + ( pk - 0.9 ) / ( 1.0 + ( pk - 0.9 ) / 0.9 ) ) / pk;
          float hz = smoothstep( 0.22, -0.02, direction.y );
          texColor = mix( texColor, uHaze, hz * 0.85 );
          gl_FragColor = vec4( texColor, 1.0 );`,
        );
      mat.fog = false;
      this.uniforms = u;
      this.uniforms.uTime = u.time;
      this.mesh = sky;
    } else {
      this.uniforms = {
        uTop: { value: new THREE.Color(p.top) },
        uHorizon: { value: new THREE.Color(p.horizon) },
        uBottom: { value: new THREE.Color(p.bottom) },
        uSunColor: { value: new THREE.Color(p.sunColor) },
        uSunDir: { value: this.sunDir.clone() },
        uSunDisc: { value: p.sunDisc },
        uClouds: { value: p.clouds },
        uCloudColor: { value: new THREE.Color(p.cloudColor) },
        uStars: { value: p.stars },
        uMoon: { value: p.night ? 1 : 0 },
        uTime: { value: 0 },
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: vert,
        fragmentShader: frag,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      });
      this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    }
    this.mesh.scale.setScalar(2500);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;

    this.sun = new THREE.DirectionalLight(p.sunColor, p.sunIntensity);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 45;
    sc.bottom = -45;
    sc.near = 1;
    sc.far = 260;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    this.hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemiIntensity);

    if (opts.flare && !p.night && typeof document !== 'undefined') {
      const glow = flareTexture('glow');
      const ring = flareTexture('ring');
      const hex = flareTexture('hex');
      this.flareTex.push(glow, ring, hex);
      const f = new Lensflare();
      const tint = new THREE.Color(p.sunColor).multiplyScalar(0.55);
      const k = 0.35;
      f.addElement(new LensflareElement(glow, 300, 0, tint));
      f.addElement(new LensflareElement(hex, 60, 0.35, new THREE.Color('#9fd8ff').multiplyScalar(k)));
      f.addElement(new LensflareElement(ring, 140, 0.55, new THREE.Color('#ffc2e8').multiplyScalar(k)));
      f.addElement(new LensflareElement(hex, 90, 0.75, new THREE.Color('#c8ffd8').multiplyScalar(k)));
      f.addElement(new LensflareElement(ring, 200, 1.0, new THREE.Color('#fff0c0').multiplyScalar(k)));
      f.frustumCulled = false;
      this.flare = f;
    }
  }

  addTo(scene: THREE.Scene) {
    const p = this.preset;
    scene.add(this.mesh, this.sun, this.sun.target, this.hemi);
    if (this.flare) scene.add(this.flare);
    scene.fog = new THREE.FogExp2(p.fog, p.fogDensity);
    scene.background = new THREE.Color(p.horizon);
  }

  /** Keeps the shadow frustum centred on the focus point (usually the player's car). */
  follow(x: number, y: number, z: number, time: number) {
    this.sun.position.set(x + this.sunDir.x * 120, y + this.sunDir.y * 120, z + this.sunDir.z * 120);
    this.sun.target.position.set(x, y, z);
    this.mesh.position.set(x, 0, z);
    this.uniforms.uTime.value = time;
    if (this.flare) this.flare.position.set(x + this.sunDir.x * 1800, y + this.sunDir.y * 1800, z + this.sunDir.z * 1800);
  }

  /** Renders the sky into a PMREM environment map for reflections. */
  makeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const scene = new THREE.Scene();
    const mat = (this.mesh.material as THREE.ShaderMaterial).clone();
    if (this.physical) mat.uniforms.showSunDisc.value = 0;
    const dome = new THREE.Mesh(this.mesh.geometry, mat);
    dome.scale.setScalar(100);
    scene.add(dome);
    // A ground disc so reflections have a floor.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(90, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(this.preset.hemiGround).multiplyScalar(0.8) }),
    );
    ground.position.y = -5;
    scene.add(ground);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(scene, 0.02);
    pmrem.dispose();
    mat.dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    return rt.texture;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.sun.shadow.map?.dispose();
    this.flare?.dispose();
    for (const t of this.flareTex) t.dispose();
  }
}
