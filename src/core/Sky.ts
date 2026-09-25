import * as THREE from 'three';
import type { SkyPresetId } from '../tracks/types';

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
    hemiSky: '#5a4db8',
    hemiGround: '#1b1234',
    hemiIntensity: 0.9,
    fog: '#241a55',
    fogDensity: 0.0022,
    clouds: 0.25,
    cloudColor: '#3b2f7a',
    stars: 1,
    exposure: 1.15,
    bloom: 0.95,
    night: true,
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
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Sky dome + sun/hemisphere lights + fog, configured by a preset. */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly sunDir = new THREE.Vector3();
  preset: SkyPreset;

  constructor(readonly id: SkyPresetId) {
    const p = (this.preset = SKY_PRESETS[id]);
    const el = (p.sunElevation * Math.PI) / 180;
    const az = (p.sunAzimuth * Math.PI) / 180;
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
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
    this.hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemiIntensity);
  }

  addTo(scene: THREE.Scene) {
    const p = this.preset;
    scene.add(this.mesh, this.sun, this.sun.target, this.hemi);
    scene.fog = new THREE.FogExp2(p.fog, p.fogDensity);
    scene.background = new THREE.Color(p.horizon);
  }

  /** Keeps the shadow frustum centred on the focus point (usually the player's car). */
  follow(x: number, y: number, z: number, time: number) {
    this.sun.position.set(x + this.sunDir.x * 120, y + this.sunDir.y * 120, z + this.sunDir.z * 120);
    this.sun.target.position.set(x, y, z);
    this.mesh.position.set(x, 0, z);
    this.uniforms.uTime.value = time;
  }

  /** Renders the sky into a PMREM environment map for reflections. */
  makeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
    const scene = new THREE.Scene();
    const dome = new THREE.Mesh(this.mesh.geometry, (this.mesh.material as THREE.ShaderMaterial).clone());
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
    (dome.material as THREE.Material).dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    return rt.texture;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.sun.shadow.map?.dispose();
  }
}
