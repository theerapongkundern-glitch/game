import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Radial motion blur + vignette + slight grade, applied in linear HDR before tone mapping. */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uBlur: { value: 0 },
    uVignette: { value: 0.35 },
    uSaturation: { value: 1.12 },
    uAberration: { value: 0 },
    uSamples: { value: 8 },
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
    varying vec2 vUv;
    void main() {
      vec2 center = vec2(0.5, 0.52);
      vec2 dir = vUv - center;
      float dist = length(dir);
      vec3 col = texture2D(tDiffuse, vUv).rgb;
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
  private readonly final: ShaderPass;
  enabled = true;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    opts: { bloom: boolean; blurSamples: number; msaa: number },
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: opts.msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    if (opts.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.5, 0.55, 0.82);
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
  }

  setSize(w: number, h: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  set(params: { blur?: number; bloom?: number; aberration?: number; vignette?: number; saturation?: number }) {
    const u = this.final.uniforms;
    if (params.blur !== undefined) u.uBlur.value = params.blur;
    if (params.aberration !== undefined) u.uAberration.value = params.aberration;
    if (params.vignette !== undefined) u.uVignette.value = params.vignette;
    if (params.saturation !== undefined) u.uSaturation.value = params.saturation;
    if (this.bloom && params.bloom !== undefined) this.bloom.strength = params.bloom;
  }

  render(dt: number) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
    this.bloom?.dispose();
  }
}
