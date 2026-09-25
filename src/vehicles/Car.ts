import * as THREE from 'three';
import type { CarDef } from './CarDefs';
import { VehiclePhysics, makeInput, type DriveInput } from './VehiclePhysics';
import { buildCarModel, type CarVisual } from './CarModel';
import { TrackGround, type Track } from '../tracks/Track';
import { SURFACES } from '../tracks/Surfaces';
import type { Effects } from '../core/Particles';
import { clamp, lerp, wrapAngle } from '../core/math';
import type { Quality } from '../core/Renderer';

export type Controller = 'human' | 'ai' | 'ghost';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();

/** A car in the world: physics + visual + effects. Race bookkeeping lives in RaceSession. */
export class Car {
  readonly physics: VehiclePhysics;
  readonly visual: CarVisual;
  readonly ground: TrackGround;
  readonly input: DriveInput = makeInput();
  /** Previous physics state for render interpolation. */
  private px = 0;
  private py = 0;
  private pz = 0;
  private ph = 0;
  /** Smoothed ground normal for the visual. */
  private readonly normal = new THREE.Vector3(0, 1, 0);
  private airPitch = 0;
  private emitAcc = 0;
  /** Fade-out for eliminated cars. */
  opacity = 1;
  visible = true;

  constructor(
    readonly def: CarDef,
    public color: string,
    readonly track: Track,
    public name: string,
    public controller: Controller,
    quality: Quality,
  ) {
    this.physics = new VehiclePhysics(def);
    this.visual = buildCarModel(def, color, quality);
    this.ground = new TrackGround(track);
  }

  get object(): THREE.Group {
    return this.visual.root;
  }

  place(x: number, y: number, z: number, heading: number) {
    this.physics.place(x, y, z, heading);
    this.ground.reset();
    this.ground.sample(x, z, 1, { ground: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt', onRoad: true, penetration: 0, wallNx: 0, wallNz: 0, tx: 0, tz: 1 });
    this.physics.y = this.ground.q.ground;
    this.savePrev();
    this.normal.set(0, 1, 0);
  }

  savePrev() {
    const p = this.physics;
    this.px = p.x;
    this.py = p.y;
    this.pz = p.z;
    this.ph = p.heading;
  }

  step(dt: number) {
    this.savePrev();
    this.physics.step(dt, this.input, this.ground);
  }

  /** Interpolated render position. */
  renderPos(alpha: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.physics;
    return out.set(lerp(this.px, p.x, alpha), lerp(this.py, p.y, alpha), lerp(this.pz, p.z, alpha));
  }

  renderHeading(alpha: number): number {
    return this.ph + wrapAngle(this.physics.heading - this.ph) * alpha;
  }

  /** Updates the mesh transform, wheels, lights and flames. */
  sync(alpha: number, dt: number, time: number) {
    const p = this.physics;
    const v = this.visual;
    const root = v.root;
    root.visible = this.visible;
    if (!this.visible) return;
    this.renderPos(alpha, root.position);
    const heading = this.renderHeading(alpha);
    const q = this.ground.q;
    // Smooth ground normal (so the car doesn't twitch over bumps).
    if (p.grounded) _v.set(q.nx, q.ny, q.nz);
    else _v.set(0, 1, 0);
    this.normal.lerp(_v, clamp(dt * 10, 0, 1)).normalize();
    _up.copy(this.normal);
    _fwd.set(Math.sin(heading), 0, Math.cos(heading));
    _right.crossVectors(_fwd, _up).normalize();
    _fwd.crossVectors(_up, _right).normalize();
    // Basis: x = -right (left), y = up, z = forward.
    _m.makeBasis(_right.negate(), _up, _fwd);
    root.quaternion.setFromRotationMatrix(_m);
    // Air pitch: nose follows the vertical velocity a little.
    const targetAir = p.grounded ? 0 : clamp(-p.vy * 0.03, -0.35, 0.35);
    this.airPitch = lerp(this.airPitch, targetAir, clamp(dt * 4, 0, 1));
    // +x rotation dips the nose (braking); +z rotation raises the left side.
    _e.set(p.pitch + this.airPitch, 0, p.roll);
    _q.setFromEuler(_e);
    v.body.quaternion.copy(_q);
    v.body.position.y = p.bounce * 0.4;

    // Wheels: spin and steer.
    for (const w of v.wheels) {
      w.spin.rotation.x = w.front ? p.wheelRot : p.rearWheelRot;
      w.pivot.rotation.y = w.front ? p.steerAngle : 0;
      const baseY = v.shape.wheelRadius;
      w.pivot.position.y = baseY + (p.grounded ? 0 : -0.08);
    }
    // Brake lights.
    const braking = this.input.brake > 0.1 && p.vLong > 1;
    v.tailLights.emissiveIntensity = braking ? 3.2 : 0.9;
    // Boost flames.
    const boosting = p.boosting;
    for (let i = 0; i < v.flames.length; i++) {
      const f = v.flames[i];
      f.visible = boosting;
      if (boosting) {
        const flick = 0.75 + Math.sin(time * 60 + i * 2.1) * 0.15 + Math.sin(time * 37 + i) * 0.1;
        f.scale.set(1 + flick * 0.3, 1 + flick * 0.3, 0.8 + flick * 1.1);
      }
    }
    v.flameMat.color.setHSL(0.55 - (p.padBoost > 0 ? 0.45 : 0) + Math.sin(time * 20) * 0.03, 1, 0.65);
    if (this.opacity < 1) v.setOpacity(this.opacity);
  }

  /** Emits smoke, dust, sparks and spray based on the physics state. Call once per render frame. */
  emitEffects(fx: Effects, dt: number) {
    const p = this.physics;
    if (!this.visible || !p.enabled) return;
    const surf = SURFACES[p.surface];
    const v = this.visual;
    const root = v.root;
    this.emitAcc += dt;
    const speed = p.speed;
    const slip = p.drifting ? 1 : clamp((p.rearSlip - 0.14) * 3, 0, 1);
    const spin = p.wheelSpin;
    const intensity = Math.max(slip, spin) * clamp(speed / 12, 0.3, 1);

    for (const local of v.rearContacts) {
      _v.copy(local).applyMatrix4(root.matrixWorld);
      if (!p.grounded) continue;
      // Tyre smoke on asphalt.
      if (surf.particle === 'smoke' && intensity > 0.05 && fx.chance(intensity * 0.9)) {
        const c = 0.92;
        fx.smoke.emit({
          x: _v.x,
          y: _v.y + 0.2,
          z: _v.z,
          vx: p.vx * 0.15 + (fx.smoke.random() - 0.5) * 2,
          vy: 0.8 + fx.smoke.random() * 0.8,
          vz: p.vz * 0.15 + (fx.smoke.random() - 0.5) * 2,
          spread: 0.4,
          life: 1.3,
          size: 1.1,
          endSize: 4.2,
          r: c,
          g: c,
          b: c + 0.03,
          alpha: 0.42 * intensity + 0.1,
          drag: 1.4,
          gravity: -0.4,
        });
      }
      // Dust / grass / spray from loose surfaces.
      const kick = surf.kicksUp ? clamp(speed / 25, 0, 1) : 0;
      if (surf.particle !== 'smoke' && surf.particle !== 'none' && (kick > 0.1 || intensity > 0.1) && fx.chance(Math.max(kick * 0.7, intensity))) {
        let r = 0.85,
          g = 0.72,
          b = 0.5,
          a = 0.5;
        if (surf.particle === 'grass') {
          r = 0.55;
          g = 0.75;
          b = 0.35;
          a = 0.45;
        } else if (surf.particle === 'spray') {
          r = 0.85;
          g = 0.93;
          b = 1.0;
          a = 0.35;
        } else if (p.surface === 'dirt') {
          r = 0.66;
          g = 0.5;
          b = 0.34;
        }
        fx.dust.emit({
          x: _v.x,
          y: _v.y + 0.15,
          z: _v.z,
          vx: -p.vx * 0.05 + (fx.dust.random() - 0.5) * 3,
          vy: 1.2 + fx.dust.random() * 1.5,
          vz: -p.vz * 0.05 + (fx.dust.random() - 0.5) * 3,
          spread: 0.5,
          life: surf.particle === 'spray' ? 0.6 : 1.1,
          size: 0.9,
          endSize: surf.particle === 'spray' ? 2.2 : 3.5,
          r,
          g,
          b,
          alpha: a,
          drag: 1.8,
          gravity: surf.particle === 'spray' ? 6 : 0.6,
        });
      }
    }
    // Wall sparks.
    if (p.events.scraping || p.events.wallImpact > 1) {
      const n = Math.min(10, 2 + Math.floor(p.events.wallImpact));
      const q = this.ground.q;
      const wx = p.x + q.wallNx * p.p.halfWidth;
      const wz = p.z + q.wallNz * p.p.halfWidth;
      for (let i = 0; i < n; i++) {
        if (!fx.chance(0.85)) continue;
        fx.sparks.emit({
          x: wx,
          y: p.y + 0.4,
          z: wz,
          vx: p.vx * 0.6 + (fx.sparks.random() - 0.5) * 8,
          vy: 2 + fx.sparks.random() * 5,
          vz: p.vz * 0.6 + (fx.sparks.random() - 0.5) * 8,
          life: 0.45,
          size: 0.28,
          endSize: 0.08,
          r: 4,
          g: 2.4,
          b: 0.8,
          alpha: 1,
          drag: 1.2,
          gravity: 14,
        });
      }
    }
    // Boost glow trail.
    if (p.boosting) {
      for (const e of v.exhausts) {
        if (!fx.chance(0.8)) continue;
        _v.copy(e).applyMatrix4(v.body.matrixWorld);
        const pad = p.padBoost > 0;
        fx.glow.emit({
          x: _v.x,
          y: _v.y,
          z: _v.z,
          vx: p.vx * 0.5,
          vy: 0.2,
          vz: p.vz * 0.5,
          spread: 0.15,
          life: 0.35,
          size: 0.8,
          endSize: 0.2,
          r: pad ? 2.2 : 0.8,
          g: pad ? 1.2 : 1.6,
          b: pad ? 0.4 : 2.4,
          alpha: 0.8,
          drag: 3,
        });
      }
    }
  }

  dispose() {
    this.visual.dispose();
  }
}
