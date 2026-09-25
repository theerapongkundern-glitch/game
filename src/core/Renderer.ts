import * as THREE from 'three';
import { PostFX } from './PostFX';
import { clamp } from './math';

export type Quality = 'low' | 'medium' | 'high';

export interface QualityPreset {
  maxPixelRatio: number;
  shadows: number;
  post: boolean;
  bloom: boolean;
  blurSamples: number;
  msaa: number;
  /** Scenery density multiplier. */
  scenery: number;
  antialias: boolean;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: { maxPixelRatio: 1, shadows: 0, post: false, bloom: false, blurSamples: 0, msaa: 0, scenery: 0.45, antialias: false },
  medium: { maxPixelRatio: 1.25, shadows: 1024, post: true, bloom: false, blurSamples: 5, msaa: 2, scenery: 0.75, antialias: true },
  high: { maxPixelRatio: 1.5, shadows: 2048, post: true, bloom: true, blurSamples: 8, msaa: 4, scenery: 1, antialias: true },
};

/** A camera drawn into a normalised rectangle of the canvas (y from the bottom). */
export interface View {
  camera: THREE.PerspectiveCamera;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameFX {
  blur: number;
  aberration: number;
  bloom: number;
}

/**
 * Owns the WebGLRenderer, quality presets, post-processing and dynamic resolution.
 * Single-view frames go through the composer; split-screen renders views directly.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  quality: Quality;
  preset: QualityPreset;
  private post: PostFX | null = null;
  private postScene: THREE.Scene | null = null;
  width = 1;
  height = 1;
  /** Dynamic resolution scale (0.6..1). */
  dynScale = 1;
  private slowFrames = 0;
  private fastFrames = 0;
  autoResolution = true;

  constructor(readonly canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.preset = QUALITY[quality];
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: this.preset.antialias,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: false,
    });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.info.autoReset = false;
    this.applyQuality(quality);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio) * this.dynScale;
  }

  applyQuality(q: Quality) {
    this.quality = q;
    this.preset = QUALITY[q];
    this.gl.shadowMap.enabled = this.preset.shadows > 0;
    this.gl.shadowMap.needsUpdate = true;
    this.post?.dispose();
    this.post = null;
    this.postScene = null;
    this.dynScale = 1;
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.setSize(this.width, this.height, false);
    this.post?.setSize(this.width, this.height, this.pixelRatio);
  }

  /** Adjusts resolution when frames are consistently slow (or recovers when fast). */
  trackFrame(frameMs: number) {
    if (!this.autoResolution) return;
    if (frameMs > 19) {
      this.slowFrames++;
      this.fastFrames = 0;
    } else if (frameMs < 12) {
      this.fastFrames++;
      this.slowFrames = Math.max(0, this.slowFrames - 1);
    }
    if (this.slowFrames > 45 && this.dynScale > 0.6) {
      this.dynScale = clamp(this.dynScale - 0.1, 0.6, 1);
      this.slowFrames = 0;
      this.resize();
    } else if (this.fastFrames > 240 && this.dynScale < 1) {
      this.dynScale = clamp(this.dynScale + 0.1, 0.6, 1);
      this.fastFrames = 0;
      this.resize();
    }
  }

  setExposure(e: number) {
    this.gl.toneMappingExposure = e;
  }

  render(scene: THREE.Scene, views: View[], dt: number, fx: FrameFX) {
    const gl = this.gl;
    gl.info.reset();
    if (views.length === 1 && this.preset.post) {
      const v = views[0];
      v.camera.aspect = this.width / this.height;
      v.camera.updateProjectionMatrix();
      if (!this.post || this.postScene !== scene) {
        this.post?.dispose();
        this.post = new PostFX(gl, scene, v.camera, { bloom: this.preset.bloom, blurSamples: this.preset.blurSamples, msaa: this.preset.msaa });
        this.post.setSize(this.width, this.height, this.pixelRatio);
        this.postScene = scene;
      }
      this.post.setScene(scene, v.camera);
      this.post.set({ blur: fx.blur, aberration: fx.aberration, bloom: fx.bloom });
      this.post.render(dt);
      return;
    }
    gl.setScissorTest(views.length > 1);
    for (const v of views) {
      const x = Math.floor(v.x * this.width);
      const y = Math.floor(v.y * this.height);
      const w = Math.ceil(v.w * this.width);
      const h = Math.ceil(v.h * this.height);
      v.camera.aspect = w / h;
      v.camera.updateProjectionMatrix();
      gl.setViewport(x, y, w, h);
      gl.setScissor(x, y, w, h);
      gl.render(scene, v.camera);
    }
    gl.setScissorTest(false);
    gl.setViewport(0, 0, this.width, this.height);
  }

  info() {
    return this.gl.info.render;
  }

  dispose() {
    this.post?.dispose();
    this.gl.dispose();
  }
}
