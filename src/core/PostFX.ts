import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';

/** Radial motion blur + vignette + slight grade, applied in linear HDR before tone mapping. */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uBlur: { value: 0 },
    uVignette: { value: 0.35 },
    uSaturation: { value: 1.12 },
    uAberration: { value: 0 },
    uSamples: { value: 8 },
    uHaze: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uBlur;
    uniform float uVignette;
    uniform float uSaturation;
    uniform float uAberration;
    uniform int uSamples;
    uniform float uHaze;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec2 center = vec2(0.5, 0.52);
      vec2 dir = vUv - center;
      float dist = length(dir);
      vec2 uv0 = vUv;
      if (uHaze > 0.0) {
        // Heat shimmer in a band around the horizon (hot air above the far road).
        float band = smoothstep(0.36, 0.5, vUv.y) * (1.0 - smoothstep(0.52, 0.66, vUv.y));
        uv0.x += sin(vUv.y * 230.0 + uTime * 7.0) * 0.0012 * band * uHaze;
        uv0.y += cos(vUv.x * 150.0 + uTime * 5.3) * 0.0007 * band * uHaze;
      }
      vec3 col = texture2D(tDiffuse, uv0).rgb;
      if (uBlur > 0.001) {
        // Blur grows toward the edges, keeping the car in the middle crisp.
        float strength = uBlur * smoothstep(0.12, 0.7, dist);
        vec3 acc = col;
        float total = 1.0;
        for (int i = 1; i <= 12; i++) {
          if (i > uSamples) break;
          float t = float(i) / float(uSamples);
          vec2 uv = vUv - dir * strength * t * 0.12;
          float w = 1.0 - t * 0.6;
          acc += texture2D(tDiffuse, uv).rgb * w;
          total += w;
        }
        col = acc / total;
      }
      if (uAberration > 0.0) {
        vec2 off = dir * uAberration * 0.006;
        col.r = mix(col.r, texture2D(tDiffuse, vUv + off).r, 0.8);
        col.b = mix(col.b, texture2D(tDiffuse, vUv - off).b, 0.8);
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      float v = smoothstep(0.85, 0.25, dist * (1.0 + uVignette * 0.6));
      col *= mix(1.0, v, uVignette);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloom: UnrealBloomPass | null;
  private readonly ao: GTAOPass | null;
  private readonly dof: BokehPass | null;
  private readonly final: ShaderPass;
  enabled = true;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    opts: { bloom: boolean; blurSamples: number; msaa: number; ao?: boolean; dof?: { focus: number; aperture: number; maxblur: number } },
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: opts.msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    if (opts.ao) {
      // Ground-truth AO (Ultra): contact shadows under cars, props and in crevices.
      this.ao = new GTAOPass(scene, camera, size.x, size.y);
      this.ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.6, scale: 1.1, samples: 12, distanceFallOff: 1 });
      this.ao.blendIntensity = 0.8;
      this.composer.addPass(this.ao);
    } else this.ao = null;
    if (opts.dof) {
      // Showroom depth of field (garage only).
      this.dof = new BokehPass(scene, camera, { ...opts.dof });
      this.composer.addPass(this.dof);
    } else this.dof = null;
    if (opts.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.5, 0.55, 0.95);
      this.composer.addPass(this.bloom);
    } else this.bloom = null;
    this.final = new ShaderPass(FinalShader);
    this.final.uniforms.uSamples.value = opts.blurSamples;
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
  }

  setScene(scene: THREE.Scene, camera: THREE.Camera) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    if (this.ao) {
      this.ao.scene = scene;
      this.ao.camera = camera;
    }
    if (this.dof) {
      this.dof.scene = scene;
      this.dof.camera = camera;
    }
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  set(params: { blur?: number; bloom?: number; aberration?: number; vignette?: number; saturation?: number; haze?: number }) {
    const u = this.final.uniforms;
    if (params.haze !== undefined) u.uHaze.value = params.haze;
    if (params.blur !== undefined) u.uBlur.value = params.blur;
    if (params.aberration !== undefined) u.uAberration.value = params.aberration;
    if (params.vignette !== undefined) u.uVignette.value = params.vignette;
    if (params.saturation !== undefined) u.uSaturation.value = params.saturation;
    if (this.bloom && params.bloom !== undefined) this.bloom.strength = params.bloom;
  }

  render(dt: number) {
    this.final.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
    this.bloom?.dispose();
    this.ao?.dispose();
    this.dof?.dispose();
  }
}
