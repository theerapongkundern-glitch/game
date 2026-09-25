import * as THREE from 'three';
import type { Renderer } from '../../core/Renderer';
import { World } from '../../core/World';
import { RaceSim } from '../../modes/RaceSim';
import { makeAIBrainFactory } from '../../ai/AIDriver';
import { buildOpponents } from '../../modes/opponents';
import type { TrackDef } from '../../tracks/types';
import { Loop } from '../../core/Loop';
import { damp } from '../../core/math';

type Shot = 'chase' | 'trackside' | 'orbit' | 'heli';
const SHOTS: Shot[] = ['orbit', 'chase', 'trackside', 'heli', 'chase', 'trackside'];

const _v = new THREE.Vector3();
const _look = new THREE.Vector3();

/** Attract mode behind the main menu: AI cars racing with cinematic camera cuts. */
export class MenuBackground {
  readonly world: World;
  readonly sim: RaceSim;
  readonly camera: THREE.PerspectiveCamera;
  private acc = 0;
  private shotTime = 0;
  private shotIndex = 0;
  private target = 0;
  private tsPos = new THREE.Vector3();
  private readonly lookSmooth = new THREE.Vector3();
  private orbitA = 0;
  /** Blurs/darkens slightly so menus read clearly. */
  fx = { blur: 0.15, aberration: 0, bloom: 0.4 };

  constructor(
    private readonly renderer: Renderer,
    track: TrackDef,
  ) {
    this.world = new World(renderer, track);
    this.sim = new RaceSim(this.world.track, buildOpponents(6, [], 42), { id: 'free', laps: 0, showPosition: false }, 'hard', { countdown: false, quality: renderer.quality });
    this.sim.makeBrain = makeAIBrainFactory('normal');
    for (const rc of this.sim.cars) this.world.scene.add(rc.car.object);
    this.camera = new THREE.PerspectiveCamera(55, renderer.width / renderer.height, 0.1, 3000);
    this.fx.bloom = this.world.sky.preset.bloom;
    // Warm up so cars are spread around the track.
    for (let i = 0; i < 120 * 4; i++) this.sim.step(Loop.STEP, () => {});
    this.nextShot();
  }

  private nextShot() {
    this.shotTime = 0;
    this.shotIndex = (this.shotIndex + 1) % SHOTS.length;
    const ranking = this.sim.ranking();
    this.target = ranking[Math.floor(Math.random() * Math.min(4, ranking.length))].index;
    const shot = SHOTS[this.shotIndex];
    if (shot === 'trackside') {
      const rc = this.sim.cars[this.target];
      const main = this.world.track.main;
      const i = main.idx(Math.round(rc.lastMainS / 2) + 45);
      const side = Math.random() < 0.5 ? 1 : -1;
      const lat = (side > 0 ? main.limitL[i] : main.limitR[i]) + 3;
      this.tsPos.set(main.px[i] + main.nx[i] * lat * side, main.py[i] + 1.6, main.pz[i] + main.nz[i] * lat * side);
    }
    this.orbitA = Math.random() * Math.PI * 2;
    const rc = this.sim.cars[this.target];
    this.lookSmooth.copy(rc.car.object.position);
  }

  render(dt: number) {
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= Loop.STEP && steps < 12) {
      this.sim.step(Loop.STEP, () => {});
      this.acc -= Loop.STEP;
      steps++;
    }
    const alpha = this.acc / Loop.STEP;
    for (const rc of this.sim.cars) rc.car.sync(alpha, dt, this.world.time);
    this.world.scene.updateMatrixWorld();
    for (const rc of this.sim.cars) rc.car.emitEffects(this.world.effects, dt);
    const rc = this.sim.cars[this.target];
    const car = rc.car;
    car.renderPos(alpha, _v);
    this.world.update(dt, _v);
    this.shotTime += dt;
    const shot = SHOTS[this.shotIndex];
    const h = car.renderHeading(alpha);
    const cam = this.camera;
    switch (shot) {
      case 'chase': {
        cam.position.set(_v.x - Math.sin(h) * 6.5 + Math.cos(h) * 1.5, _v.y + 1.3, _v.z - Math.cos(h) * 6.5 - Math.sin(h) * 1.5);
        _look.set(_v.x + Math.sin(h) * 4, _v.y + 0.8, _v.z + Math.cos(h) * 4);
        break;
      }
      case 'trackside':
        cam.position.copy(this.tsPos);
        _look.copy(_v).setY(_v.y + 0.7);
        break;
      case 'orbit':
        this.orbitA += dt * 0.35;
        cam.position.set(_v.x + Math.cos(this.orbitA) * 11, _v.y + 3.6, _v.z + Math.sin(this.orbitA) * 11);
        _look.copy(_v).setY(_v.y + 0.8);
        break;
      case 'heli':
        cam.position.set(_v.x - Math.sin(h) * 30, _v.y + 26, _v.z - Math.cos(h) * 30);
        _look.set(_v.x + Math.sin(h) * 20, _v.y, _v.z + Math.cos(h) * 20);
        break;
    }
    this.lookSmooth.x = damp(this.lookSmooth.x, _look.x, 8, dt);
    this.lookSmooth.y = damp(this.lookSmooth.y, _look.y, 8, dt);
    this.lookSmooth.z = damp(this.lookSmooth.z, _look.z, 8, dt);
    cam.lookAt(this.lookSmooth);
    cam.fov = shot === 'trackside' ? 38 : 55;
    const tooFar = shot === 'trackside' && cam.position.distanceTo(_v) > 90 && this.shotTime > 2;
    if (this.shotTime > 6.5 || tooFar) this.nextShot();
    this.renderer.render(this.world.scene, [{ camera: cam, x: 0, y: 0, w: 1, h: 1 }], dt, this.fx);
  }

  dispose() {
    for (const rc of this.sim.cars) this.world.scene.remove(rc.car.object);
    this.sim.dispose();
    this.world.dispose();
  }
}
