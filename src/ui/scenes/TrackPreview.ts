import * as THREE from 'three';
import type { Renderer } from '../../core/Renderer';
import { World } from '../../core/World';
import type { TrackDef } from '../../tracks/types';
import { makeFrame } from '../../tracks/Track';

const _f = makeFrame();
const _g = makeFrame();

/** Cinematic flyover of a track for the track-select screen. */
export class TrackPreview {
  readonly world: World;
  readonly camera: THREE.PerspectiveCamera;
  private s = 0;

  constructor(
    private readonly renderer: Renderer,
    readonly def: TrackDef,
  ) {
    this.world = new World(renderer, def);
    this.camera = new THREE.PerspectiveCamera(50, renderer.width / renderer.height, 0.1, 3000);
    this.s = this.world.track.length * 0.9;
  }

  render(dt: number) {
    const main = this.world.track.main;
    this.s = (this.s + dt * 32) % this.world.track.length;
    main.frameAt(this.s, _f);
    main.frameAt(this.s + 70, _g);
    const cam = this.camera;
    const tx = cam.position.x;
    const ty = cam.position.y;
    const tz = cam.position.z;
    const nx = _f.x - _f.tx * 10 + _f.nx * 6;
    const ny = _f.y + 16;
    const nz = _f.z - _f.tz * 10 + _f.nz * 6;
    const k = tx === 0 && tz === 0 ? 1 : Math.min(1, dt * 2);
    cam.position.set(tx + (nx - tx) * k, ty + (ny - ty) * k, tz + (nz - tz) * k);
    cam.lookAt(_g.x, _g.y + 2, _g.z);
    this.world.update(dt, cam.position);
    this.renderer.render(this.world.scene, [{ camera: cam, x: 0, y: 0, w: 1, h: 1 }], dt, { blur: 0, aberration: 0, bloom: this.world.sky.preset.bloom });
  }

  dispose() {
    this.world.dispose();
  }
}
