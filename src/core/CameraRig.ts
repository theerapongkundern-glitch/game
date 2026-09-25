import * as THREE from 'three';
import type { Car } from '../vehicles/Car';
import { clamp, damp, dampAngle, lerp } from './math';
import { noise1 } from './rng';

export type CameraMode = 'chase' | 'close' | 'bumper';
export const CAMERA_MODES: CameraMode[] = ['chase', 'close', 'bumper'];

interface ModeCfg {
  dist: number;
  height: number;
  lookAhead: number;
  lookHeight: number;
  posLag: number;
  yawLag: number;
  fov: number;
}

const CFG: Record<Exclude<CameraMode, 'bumper'>, ModeCfg> = {
  chase: { dist: 7.4, height: 2.7, lookAhead: 5, lookHeight: 1.1, posLag: 9, yawLag: 5.5, fov: 64 },
  close: { dist: 5.0, height: 1.75, lookAhead: 6, lookHeight: 0.95, posLag: 12, yawLag: 7.5, fov: 66 },
};

const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();

/** Smooth chase/close/bumper camera with speed FOV, boost kick and shake. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  private yaw = 0;
  private readonly pos = new THREE.Vector3();
  private readonly lookSmoothed = new THREE.Vector3();
  private fov = 64;
  private shake = 0;
  private t = 0;
  private initialized = false;
  /** Optional look-back. */
  lookBack = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(64, aspect, 0.1, 3000);
  }

  cycle(): CameraMode {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    this.initialized = false;
    return this.mode;
  }

  addShake(amount: number) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  snap() {
    this.initialized = false;
  }

  update(car: Car, alpha: number, dt: number) {
    const p = car.physics;
    this.t += dt;
    car.renderPos(alpha, _pos);
    const heading = car.renderHeading(alpha);
    const speedFrac = clamp(p.speed / p.p.topSpeed, 0, 1.3);
    // Blend toward the velocity direction while sliding so the camera swings with drifts.
    const vHead = p.velocityHeading();
    const slideBlend = p.drifting ? 0.45 : 0.15;
    let targetYaw = heading + ((((vHead - heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * slideBlend);
    if (p.vLong < -2) targetYaw = heading; // reversing
    if (this.lookBack) targetYaw += Math.PI;

    if (this.mode === 'bumper') {
      const fx = Math.sin(heading);
      const fz = Math.cos(heading);
      const hood = car.visual.shape.length * 0.5 - 0.35;
      const h = car.visual.shape.bodyHeight + 0.28;
      this.camera.position.set(_pos.x + fx * hood, _pos.y + h + p.bounce * 0.3, _pos.z + fz * hood);
      const dir = this.lookBack ? -1 : 1;
      _look.set(this.camera.position.x + fx * 20 * dir, this.camera.position.y - 0.4 + p.pitch * -8, this.camera.position.z + fz * 20 * dir);
      this.camera.lookAt(_look);
      this.camera.rotateZ(p.roll * 1.2);
      this.fov = damp(this.fov, 72 + speedFrac * 14 + (p.boosting ? 8 : 0), 4, dt);
      car.visual.root.visible = false;
    } else {
      car.visual.root.visible = car.visible;
      const c = CFG[this.mode];
      if (!this.initialized) {
        this.yaw = targetYaw;
      }
      this.yaw = dampAngle(this.yaw, targetYaw, c.yawLag, dt);
      const dist = c.dist + speedFrac * 1.2 + (p.boosting ? 0.8 : 0);
      const height = c.height + speedFrac * 0.25;
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      const target = _look.set(_pos.x - fx * dist, _pos.y + height, _pos.z - fz * dist);
      // Keep the camera above the ground (hills/ramps).
      target.y = Math.max(target.y, _pos.y + 0.8);
      if (!this.initialized) {
        this.pos.copy(target);
        this.lookSmoothed.set(_pos.x + fx * c.lookAhead, _pos.y + c.lookHeight, _pos.z + fz * c.lookAhead);
        this.initialized = true;
      }
      this.pos.x = damp(this.pos.x, target.x, c.posLag, dt);
      this.pos.z = damp(this.pos.z, target.z, c.posLag, dt);
      this.pos.y = damp(this.pos.y, target.y, c.posLag * 0.6, dt);
      const lx = _pos.x + fx * c.lookAhead;
      const ly = _pos.y + c.lookHeight;
      const lz = _pos.z + fz * c.lookAhead;
      this.lookSmoothed.x = damp(this.lookSmoothed.x, lx, 18, dt);
      this.lookSmoothed.y = damp(this.lookSmoothed.y, ly, 10, dt);
      this.lookSmoothed.z = damp(this.lookSmoothed.z, lz, 18, dt);
      this.camera.position.copy(this.pos);
      this.camera.lookAt(this.lookSmoothed);
      this.fov = damp(this.fov, c.fov + speedFrac * 12 + (p.boosting ? 9 : 0), 3.5, dt);
    }

    // Shake: from surface rumble, landings, boost.
    const rumble = p.grounded && !p.onRoad ? 0.08 * clamp(p.speed / 20, 0, 1) : 0;
    const boostShake = p.boosting ? 0.04 : 0;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const amt = this.shake * 0.25 + rumble + boostShake;
    if (amt > 0.001) {
      const t = this.t * 22;
      this.camera.position.x += noise1(t, 1) * amt * 0.5;
      this.camera.position.y += noise1(t, 2) * amt * 0.5;
      this.camera.rotateZ(noise1(t, 3) * amt * 0.03);
    }
    this.camera.fov = lerp(this.camera.fov, this.fov, 1);
    this.camera.updateProjectionMatrix();
  }
}
