import type { CarDef } from './CarDefs';
import { SURFACES, type SurfaceType } from '../tracks/Surfaces';
import { clamp, lerp, smoothstep, wrapAngle } from '../core/math';

/** Input for one physics step. `steer` is +1 = right. */
export interface DriveInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  boost: boolean;
}

export function makeInput(): DriveInput {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
}

/** What the physics needs from the world under a point. Implemented by Track (and test grounds). */
export interface GroundInfo {
  ground: number;
  nx: number;
  ny: number;
  nz: number;
  surface: SurfaceType;
  onRoad: boolean;
  /** Barrier contact: penetration > 0 means the car body is inside the wall. */
  penetration: number;
  /** Outward wall normal (horizontal). */
  wallNx: number;
  wallNz: number;
  /** Track tangent, used to straighten the car after wall hits. */
  tx: number;
  tz: number;
}

export interface Ground {
  sample(x: number, z: number, radius: number, out: GroundInfo): GroundInfo;
}

export function makeGroundInfo(): GroundInfo {
  return { ground: 0, nx: 0, ny: 1, nz: 0, surface: 'asphalt', onRoad: true, penetration: -1, wallNx: 0, wallNz: 0, tx: 0, tz: 1 };
}

/** Derived tuning parameters (computed once per car from its 1–10 stats). */
export interface VehicleParams {
  mass: number;
  wheelbase: number;
  a: number;
  b: number;
  cgHeight: number;
  inertia: number;
  topSpeed: number;
  forceMax: number;
  power: number;
  dragC: number;
  rollC: number;
  brakeDecel: number;
  mu: number;
  downforce: number;
  cornerF: number;
  cornerR: number;
  steerLow: number;
  steerHigh: number;
  handbrakeGrip: number;
  driftGrip: number;
  driftFill: number;
  driftYaw: number;
  maxDriftAngle: number;
  assist: number;
  offroad: number;
  halfWidth: number;
  drive: 'rwd' | 'awd' | 'fwd';
}

export const GRAVITY = 9.81;
const JUMP_GRAVITY = 1.45;

export function deriveParams(def: CarDef): VehicleParams {
  const s = def.stats;
  const n = (v: number) => clamp((v - 1) / 9, 0, 1);
  const mass = def.mass;
  const wheelbase = def.shape.wheelbase;
  const a = wheelbase * 0.5;
  const b = wheelbase * 0.5;
  const topSpeed = lerp(52, 76, n(s.speed));
  const t100 = lerp(5.4, 2.9, n(s.accel));
  const forceMax = mass * (27.8 / t100) * 1.3;
  const knee = 0.42 * topSpeed;
  const power = forceMax * knee;
  const rollC = mass * 0.015;
  const dragAtTop = power / topSpeed - rollC * topSpeed;
  const dragC = dragAtTop / (topSpeed * topSpeed);
  const mu = lerp(1.5, 1.9, n(s.handling));
  const staticF = (mass * GRAVITY * b) / wheelbase;
  const staticR = (mass * GRAVITY * a) / wheelbase;
  return {
    mass,
    wheelbase,
    a,
    b,
    cgHeight: 0.45,
    inertia: mass * a * b * 1.05,
    topSpeed,
    forceMax,
    power,
    dragC,
    rollC,
    brakeDecel: GRAVITY * lerp(1.15, 1.35, n(s.handling)),
    mu,
    downforce: 0.45 / (topSpeed * topSpeed),
    cornerF: staticF * mu * 9.5,
    cornerR: staticR * mu * 10,
    steerLow: lerp(0.5, 0.62, n(s.handling)),
    steerHigh: lerp(0.085, 0.13, n(s.handling)),
    handbrakeGrip: lerp(0.5, 0.28, n(s.drift)),
    driftGrip: lerp(0.8, 0.62, n(s.drift)),
    driftFill: lerp(0.1, 0.24, n(s.drift)),
    driftYaw: lerp(1.6, 2.6, n(s.drift)),
    maxDriftAngle: lerp(0.62, 0.85, n(s.drift)),
    assist: lerp(0.35, 0.6, n(s.handling)),
    offroad: def.offroad,
    halfWidth: def.shape.width / 2,
    drive: def.drive,
  };
}

/** Per-step events the car entity turns into sparks, sounds and camera shake. */
export interface PhysicsEvents {
  wallImpact: number;
  scraping: boolean;
  landed: number;
  boostPad: boolean;
  driftEnded: number;
}

/**
 * Arcade vehicle model: a bicycle-model tyre simulation (slip angles, load transfer,
 * friction circle) with an arcade layer for drifting, boost, jumps and stability.
 * Units: metres, seconds, kilograms. Heading 0 faces +Z; heading increases to the LEFT.
 */
export class VehiclePhysics {
  readonly p: VehicleParams;
  x = 0;
  y = 0;
  z = 0;
  heading = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yawRate = 0;
  steerAngle = 0;

  vLong = 0;
  vLat = 0;
  speed = 0;
  accelLong = 0;
  accelLat = 0;
  grounded = true;
  airTime = 0;
  surface: SurfaceType = 'asphalt';
  onRoad = true;

  drifting = false;
  /** Body slip angle (rad): velocity direction relative to heading, left-positive. */
  driftAngle = 0;
  driftTime = 0;
  /** +1 drifting through a left turn, -1 a right turn. */
  driftDir = 1;
  /** Current nose-in angle while drifting (rad). */
  driftMag = 0;
  private driftExitTimer = 0;
  private rearGripMul = 1;

  boost = 0.25;
  boosting = false;
  padBoost = 0;
  launchBoost = 0;
  /** 0..1 slipstream strength, set by the race session each step. */
  draft = 0;
  rearSlip = 0;
  frontSlip = 0;
  wheelSpin = 0;
  rpm = 0.1;
  gear = 1;
  /** Visual suspension state. */
  pitch = 0;
  roll = 0;
  bounce = 0;
  private pitchVel = 0;
  private rollVel = 0;
  private bounceVel = 0;
  wheelRot = 0;
  rearWheelRot = 0;

  readonly events: PhysicsEvents = { wallImpact: 0, scraping: false, landed: 0, boostPad: false, driftEnded: 0 };
  private readonly g: GroundInfo = makeGroundInfo();
  /** Set false to freeze a car (e.g. during the countdown). */
  enabled = true;
  /** Multiplier on engine power (AI rubber-banding, difficulty). */
  powerScale = 1;
  /** Ignores wall collisions (ghosts, eliminated cars). */
  noWalls = false;

  constructor(def: CarDef) {
    this.p = deriveParams(def);
  }

  place(x: number, y: number, z: number, heading: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.heading = heading;
    this.vx = this.vy = this.vz = 0;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.speed = this.vLong = this.vLat = 0;
    this.drifting = false;
    this.driftAngle = 0;
    this.rearGripMul = 1;
    this.grounded = true;
    this.airTime = 0;
    this.padBoost = 0;
    this.pitch = this.roll = this.bounce = 0;
    this.pitchVel = this.rollVel = this.bounceVel = 0;
  }

  get forwardX() {
    return Math.sin(this.heading);
  }
  get forwardZ() {
    return Math.cos(this.heading);
  }

  step(dt: number, input: DriveInput, world: Ground) {
    const ev = this.events;
    ev.wallImpact = 0;
    ev.scraping = false;
    ev.landed = 0;
    ev.boostPad = false;
    ev.driftEnded = 0;
    if (!this.enabled) {
      this.updateRpm(dt, input);
      return;
    }
    const p = this.p;
    const g = world.sample(this.x, this.z, p.halfWidth, this.g);
    const surf = SURFACES[g.surface];
    this.surface = g.surface;
    this.onRoad = g.onRoad;
    const offPenalty = 1 - p.offroad * 0.6;
    const gripMul = 1 - (1 - surf.grip) * offPenalty;
    const surfDrag = surf.drag * offPenalty;
    const surfCap = 1 - (1 - surf.maxSpeed) * offPenalty;

    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const lx = fz;
    const lz = -fx;
    let vLong = this.vx * fx + this.vz * fz;
    let vLat = this.vx * lx + this.vz * lz;
    const speed = Math.hypot(this.vx, this.vz);
    const speedFrac = clamp(Math.abs(vLong) / p.topSpeed, 0, 1.3);
    const m = p.mass;

    // --- Boost bookkeeping ----------------------------------------------------------
    if (g.surface === 'boost' && this.grounded) {
      if (this.padBoost <= 0.2) ev.boostPad = true;
      this.padBoost = 1.1;
    }
    this.padBoost = Math.max(0, this.padBoost - dt);
    this.launchBoost = Math.max(0, this.launchBoost - dt);
    const wantsBoost = input.boost && this.boost > 0.01;
    this.boosting = wantsBoost || this.padBoost > 0 || this.launchBoost > 0;
    if (wantsBoost && this.padBoost <= 0 && this.launchBoost <= 0) this.boost = Math.max(0, this.boost - dt * 0.34);

    // --- Steering --------------------------------------------------------------------
    const steerIn = -clamp(input.steer, -1, 1); // left-positive internally
    const maxSteer = lerp(p.steerLow, p.steerHigh, Math.pow(clamp(speedFrac, 0, 1), 0.65));
    const beta = speed > 1.5 ? Math.atan2(vLat, Math.max(Math.abs(vLong), 0.5)) : 0;
    let targetSteer = steerIn * maxSteer;
    // Counter-steer assist: gently steer into the slide when the driver isn't fighting it.
    if (!this.drifting && Math.abs(beta) > 0.05 && speed > 6) {
      targetSteer += beta * p.assist * (1 - Math.abs(steerIn) * 0.5);
    }
    if (vLong < -0.5) targetSteer = steerIn * p.steerLow * 0.8;
    const steerRate = 5.5;
    this.steerAngle += clamp(targetSteer - this.steerAngle, -steerRate * dt, steerRate * dt);
    const delta = this.steerAngle;

    // --- Drift entry -------------------------------------------------------------------
    if (!this.drifting && this.grounded && input.handbrake && Math.abs(steerIn) > 0.3 && vLong > 13) {
      this.drifting = true;
      this.driftDir = Math.sign(steerIn);
      this.driftTime = 0;
      this.driftExitTimer = 0;
      // Start from the current slip (nose-in angle measured in the drift direction).
      this.driftMag = clamp(-beta * this.driftDir, -0.3, p.maxDriftAngle);
    }
    this.rearGripMul += (1 - this.rearGripMul) * clamp(dt * 2.5, 0, 1);

    if (this.grounded && this.drifting) {
      this.stepDrift(dt, input, steerIn, gripMul, surfDrag, surfCap);
    } else if (this.grounded) {
      // --- Loads with longitudinal weight transfer ----------------------------------------
      const L = p.wheelbase;
      const transfer = (p.cgHeight / L) * m * clamp(this.accelLong, -14, 14) * 0.85;
      const df = 1 + p.downforce * speed * speed;
      const Wf = Math.max(m * GRAVITY * 0.15, (m * GRAVITY * p.b) / L - transfer) * df;
      const Wr = Math.max(m * GRAVITY * 0.15, (m * GRAVITY * p.a) / L + transfer) * df;
      const hb = input.handbrake ? p.handbrakeGrip : 1;
      const muF = p.mu * gripMul;
      const muR = p.mu * gripMul * 1.08 * hb * this.rearGripMul;

      // --- Longitudinal drive --------------------------------------------------------
      let drive = 0;
      const boostOn = this.boosting;
      const topCap = p.topSpeed * surfCap * (boostOn ? 1.25 : 1);
      if (input.throttle > 0.01) {
        const v = Math.max(Math.abs(vLong), 1);
        drive = input.throttle * Math.min(p.forceMax, p.power / v) * this.powerScale;
        if (boostOn) drive += p.forceMax * (this.padBoost > 0 || this.launchBoost > 0 ? 0.75 : 0.55);
        if (vLong < -0.5) drive += input.throttle * p.forceMax * 0.4;
      }
      let brakeF = 0;
      if (input.brake > 0.01) {
        if (vLong > 0.8) brakeF = -input.brake * p.brakeDecel * m * gripMul;
        else if (input.throttle < 0.1) {
          drive = -input.brake * p.forceMax * 0.45; // reverse
          if (vLong < -13) drive = 0;
        }
      }
      if (input.handbrake && Math.abs(vLong) > 0.5) brakeF -= Math.sign(vLong) * m * GRAVITY * 0.4 * gripMul;
      // Traction limit (lower on slippery surfaces).
      const tractionW = p.drive === 'awd' ? Wf + Wr : p.drive === 'fwd' ? Wf : Wr;
      const tractionMax = tractionW * (p.drive === 'rwd' ? muR : muF) * 1.35;
      const driveClamped = clamp(drive, -tractionMax, tractionMax);
      this.wheelSpin = clamp((Math.abs(drive) - Math.abs(driveClamped)) / (p.forceMax + 1), 0, 1);
      const drag = -p.dragC * (1 - this.draft * 0.35) * vLong * Math.abs(vLong);
      const roll = -p.rollC * vLong;
      const surfRes = -surfDrag * m * vLong;
      const coast = input.throttle < 0.05 && Math.abs(vLong) > 0.3 ? -Math.sign(vLong) * m * 0.9 : 0;
      let capF = 0;
      if (Math.abs(vLong) > topCap) capF = -Math.sign(vLong) * (Math.abs(vLong) - topCap) * m * 1.6;
      let forceLong = driveClamped + brakeF + drag + roll + surfRes + coast + capF;

      // --- Lateral tyre forces (slip angles) ------------------------------------------
      const vAbs = Math.max(Math.abs(vLong), 2.0);
      const dirSign = vLong >= -0.5 ? 1 : -1;
      const alphaF = Math.atan2(vLat + this.yawRate * p.a, vAbs) - delta * dirSign;
      const alphaR = Math.atan2(vLat - this.yawRate * p.b, vAbs);
      this.frontSlip = Math.abs(alphaF);
      this.rearSlip = Math.abs(alphaR) + (input.handbrake && speed > 3 ? 0.3 : 0);
      const maxF = muF * Wf;
      // Rear friction circle: driving force eats a little into lateral grip (power oversteer).
      const rearLong = p.drive === 'awd' ? driveClamped * 0.5 : p.drive === 'fwd' ? 0 : driveClamped;
      const maxRbase = muR * Wr;
      const maxR = Math.sqrt(Math.max(maxRbase * maxRbase * 0.5, maxRbase * maxRbase - rearLong * rearLong * 0.15));
      let Ffy = clamp(-p.cornerF * alphaF, -maxF, maxF);
      let Fry = clamp(-p.cornerR * hb * alphaR, -maxR, maxR);
      const lowFade = smoothstep(0.3, 3, speed);
      Ffy *= lowFade;
      Fry *= lowFade;

      forceLong += -Ffy * Math.sin(delta);
      // Tyre scrub: sliding tyres bleed speed (hard cornering costs momentum).
      forceLong -= Math.sign(vLong) * (Math.abs(Ffy * Math.sin(alphaF)) + Math.abs(Fry * Math.sin(alphaR))) * 0.6;
      const forceLat = Ffy * Math.cos(delta) + Fry;
      let torque = p.a * Ffy * Math.cos(delta) - p.b * Fry;
      // Yaw damping keeps the car composed.
      torque -= this.yawRate * p.inertia * 1.6 * (0.3 + speedFrac);

      if (this.draft > 0) this.boost = Math.min(1, this.boost + dt * 0.11 * this.draft);

      // Slope gravity (tangential component of gravity on the road plane).
      const gt = GRAVITY * g.ny;
      const ax = gt * g.nx;
      const az = gt * g.nz;

      const invM = 1 / m;
      const axL = forceLong * invM;
      const ayL = forceLat * invM;
      this.vx += (fx * axL + lx * ayL + ax) * dt;
      this.vz += (fz * axL + lz * ayL + az) * dt;
      this.accelLong = axL;
      this.accelLat = ayL;
      this.yawRate += (torque / p.inertia) * dt;

      // Arcade slip limiter: never let the car spin out.
      vLong = this.vx * fx + this.vz * fz;
      vLat = this.vx * lx + this.vz * lz;
      const b2 = Math.atan2(vLat, Math.max(Math.abs(vLong), 0.5));
      const limit = 0.5;
      if (speed > 5 && Math.abs(b2) > limit) {
        const excess = Math.abs(b2) - limit;
        const rot = -Math.sign(b2) * Math.min(excess, excess * dt * 10);
        this.rotateVelocity(rot);
        if (Math.sign(this.yawRate) === Math.sign(b2)) this.yawRate *= 1 - clamp(dt * 6, 0, 1);
      }

      // Low-speed kinematic blend (stable parking-speed steering).
      const kin = smoothstep(4, 0.5, speed);
      if (kin > 0) {
        const omegaKin = (vLong * Math.tan(delta)) / p.wheelbase;
        this.yawRate += (omegaKin - this.yawRate) * kin * clamp(dt * 12, 0, 1);
        vLat *= 1 - kin * clamp(dt * 8, 0, 1);
        this.vx = fx * vLong + lx * vLat;
        this.vz = fz * vLong + lz * vLat;
      }
      if (speed < 0.35 && input.throttle < 0.05 && input.brake < 0.05) {
        this.vx *= 0.9;
        this.vz *= 0.9;
      }
    } else {
      // --- Airborne -----------------------------------------------------------------
      this.airTime += dt;
      this.vx *= 1 - 0.02 * dt;
      this.vz *= 1 - 0.02 * dt;
      this.yawRate += (steerIn * 0.9 - this.yawRate) * clamp(dt * 3, 0, 1);
      this.rearSlip = 0;
      this.frontSlip = 0;
      this.accelLong = 0;
      this.accelLat = 0;
      if (this.boosting) {
        this.vx += ((fx * p.forceMax * 0.25) / m) * dt;
        this.vz += ((fz * p.forceMax * 0.25) / m) * dt;
      }
    }

    this.yawRate = clamp(this.yawRate, -4, 4);
    if (!this.drifting || !this.grounded) this.heading = wrapAngle(this.heading + this.yawRate * dt);
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // --- Ground following, jumps and landing ------------------------------------------
    const g2 = world.sample(this.x, this.z, p.halfWidth, this.g);
    if (this.grounded) {
      const drop = this.y - g2.ground;
      if (drop > 0.18 && this.vy > -1) {
        // The ground fell away (ramp lip or crest): take off with current vertical speed.
        this.grounded = false;
        this.airTime = 0;
        this.vy = clamp(this.vy, 0, 14);
        if (this.drifting) this.endDrift();
      } else {
        const newVy = (g2.ground - this.y) / dt;
        this.vy = clamp(newVy, -30, 30);
        this.y = g2.ground;
      }
    } else {
      this.vy -= GRAVITY * JUMP_GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= g2.ground) {
        ev.landed = Math.max(0, -this.vy);
        this.bounceVel -= Math.min(6, -this.vy * 0.6);
        this.y = g2.ground;
        this.vy = 0;
        this.grounded = true;
        this.airTime = 0;
      }
    }

    // --- Barrier collision (soft, no damage) -------------------------------------------
    if (!this.noWalls && g2.penetration > 0) {
      const nx = g2.wallNx;
      const nz = g2.wallNz;
      this.x -= nx * (g2.penetration + 0.01);
      this.z -= nz * (g2.penetration + 0.01);
      const vn = this.vx * nx + this.vz * nz;
      if (vn > 0) {
        const restitution = 0.25;
        this.vx -= (1 + restitution) * vn * nx;
        this.vz -= (1 + restitution) * vn * nz;
        const scrape = clamp(1 - vn * 0.03, 0.8, 1);
        this.vx *= scrape;
        this.vz *= scrape;
        ev.wallImpact = vn;
        // Nudge the nose back along the track so repeated hits don't happen.
        const trackHeading = Math.atan2(g2.tx, g2.tz);
        const dir = Math.cos(wrapAngle(trackHeading - this.heading)) >= 0 ? trackHeading : wrapAngle(trackHeading + Math.PI);
        this.heading = wrapAngle(this.heading + wrapAngle(dir - this.heading) * clamp(vn * 0.03, 0.05, 0.35));
        this.yawRate *= 0.5;
        if (this.drifting && vn > 4) this.endDrift();
      }
      ev.scraping = this.speed > 4;
    }

    // --- Derived values -----------------------------------------------------------------
    const fx2 = Math.sin(this.heading);
    const fz2 = Math.cos(this.heading);
    this.vLong = this.vx * fx2 + this.vz * fz2;
    this.vLat = this.vx * fz2 - this.vz * fx2;
    this.speed = Math.hypot(this.vx, this.vz);
    this.driftAngle = this.speed > 1.5 ? Math.atan2(this.vLat, Math.max(Math.abs(this.vLong), 0.5)) : 0;

    this.updateVisuals(dt, input);
    this.updateRpm(dt, input);
  }

  /**
   * Arcade drift: the velocity direction turns at a grip-limited rate while the nose holds
   * an angle into the corner that the driver controls with steering (in = tighter,
   * counter-steer = straighten out). Very controllable, never spins.
   */
  private stepDrift(dt: number, input: DriveInput, steerIn: number, gripMul: number, surfDrag: number, surfCap: number) {
    const p = this.p;
    const m = p.mass;
    this.driftTime += dt;
    const dir = this.driftDir;
    const into = steerIn * dir; // +1 steering into the drift, -1 counter-steering
    const speed = Math.hypot(this.vx, this.vz);
    const inFrac = clamp((into + 1) / 2, 0, 1);
    // Releasing the steering (or counter-steering) without the handbrake straightens the car out.
    if (!input.handbrake && into < 0.15) this.driftExitTimer += dt * (1 + Math.max(0, -into) * 3);
    else this.driftExitTimer = 0;
    const exiting = this.driftExitTimer > 0.12;
    let target = lerp(0.1, p.maxDriftAngle, Math.pow(inFrac, 1.4));
    if (input.handbrake) target = Math.min(p.maxDriftAngle + 0.08, target + 0.12);
    if (input.throttle < 0.2 && !input.handbrake) target *= 0.6;
    if (exiting) target = 0;
    this.driftMag += (target - this.driftMag) * clamp(dt * (target > this.driftMag ? 5 : 4), 0, 1);

    // Turn the velocity vector: tighter when steering in, wider when counter-steering.
    const turnGrip = p.mu * gripMul * GRAVITY * lerp(0.3, 1.3, inFrac) * (0.85 + (0.15 * p.driftYaw) / 2.6);
    const turnRate = (dir * turnGrip) / Math.max(speed, 6);
    this.rotateVelocity(turnRate * dt);

    // Speed: throttle keeps it going, the slide angle scrubs a little.
    const vHead = Math.atan2(this.vx, this.vz);
    const drive = input.throttle * Math.min(p.forceMax, p.power / Math.max(speed, 1)) * 0.8 * this.powerScale;
    const boost = this.boosting ? p.forceMax * 0.5 : 0;
    const drag = p.dragC * speed * speed + p.rollC * speed + surfDrag * m * speed;
    const scrub = m * GRAVITY * 0.22 * this.driftMag * gripMul;
    let accel = (drive + boost - drag - scrub) / m;
    const cap = p.topSpeed * surfCap * (this.boosting ? 1.25 : 1);
    if (speed > cap) accel -= (speed - cap) * 1.6;
    if (input.brake > 0.1) accel -= input.brake * GRAVITY * 0.8;
    const newSpeed = Math.max(0, speed + accel * dt);
    this.vx = Math.sin(vHead) * newSpeed;
    this.vz = Math.cos(vHead) * newSpeed;
    this.accelLong = accel;
    this.accelLat = dir * turnGrip;

    // Heading = velocity heading + the drift angle into the turn.
    const newHeading = wrapAngle(vHead + dir * this.driftMag);
    this.yawRate = wrapAngle(newHeading - this.heading) / dt;
    this.heading = newHeading;
    this.steerAngle += (-dir * 0.2 * (1 - into) - this.steerAngle) * clamp(dt * 8, 0, 1); // visual counter-steer
    this.rearSlip = 0.35 + this.driftMag;
    this.frontSlip = 0.1;
    this.wheelSpin = 0.2;

    // Drift fills the boost meter.
    if (speed > 12) {
      const angleFactor = clamp(this.driftMag / 0.45, 0.25, 1.2);
      this.boost = Math.min(1, this.boost + dt * p.driftFill * angleFactor * clamp(speed / 30, 0.4, 1.1));
    }
    if (this.draft > 0) this.boost = Math.min(1, this.boost + dt * 0.11 * this.draft);

    // Exit once the car has straightened out (or on hard braking / low speed).
    if ((this.driftMag < 0.12 && this.driftTime > 0.25) || speed < 9 || input.brake > 0.6) this.endDrift();
  }

  private endDrift() {
    if (!this.drifting) return;
    this.events.driftEnded = this.driftTime;
    this.drifting = false;
    this.rearGripMul = 0.8; // grip returns smoothly
    this.driftMag = 0;
  }

  private rotateVelocity(angle: number) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // Rotation about +Y by `angle` (left-positive heading convention).
    const vx = this.vx * c + this.vz * s;
    const vz = -this.vx * s + this.vz * c;
    this.vx = vx;
    this.vz = vz;
  }

  private updateVisuals(dt: number, input: DriveInput) {
    const k = 60;
    const c = 11;
    const targetPitch = clamp(-this.accelLong * 0.0065, -0.07, 0.07);
    const targetRoll = clamp(this.accelLat * 0.0075, -0.09, 0.09);
    this.pitchVel += (k * (targetPitch - this.pitch) - c * this.pitchVel) * dt;
    this.pitch += this.pitchVel * dt;
    this.rollVel += (k * (targetRoll - this.roll) - c * this.rollVel) * dt;
    this.roll += this.rollVel * dt;
    this.bounceVel += (90 * (0 - this.bounce) - 10 * this.bounceVel) * dt;
    this.bounce += this.bounceVel * dt;
    this.bounce = clamp(this.bounce, -0.25, 0.25);
    const r = 0.36;
    this.wheelRot += (this.vLong / r) * dt;
    if (!input.handbrake) this.rearWheelRot += ((this.vLong / r) * (1 + this.wheelSpin * 2)) * dt;
  }

  private updateRpm(dt: number, input: DriveInput) {
    const frac = clamp(Math.abs(this.vLong) / (this.p.topSpeed * 1.05), 0, 1.2);
    const gears = [0, 0.16, 0.3, 0.46, 0.63, 0.81, 1.25];
    let gear = 1;
    while (gear < gears.length - 2 && frac > gears[gear]) gear++;
    const lo = gears[gear - 1];
    const hi = gears[gear];
    let target = 0.18 + 0.8 * clamp((frac - lo) / (hi - lo), 0, 1);
    if (!this.enabled || this.speed < 1) target = 0.14 + input.throttle * 0.7;
    if (this.wheelSpin > 0.1 || !this.grounded) target = Math.min(1, target + 0.25 * input.throttle);
    this.gear = gear;
    this.rpm += (target - this.rpm) * clamp(dt * 9, 0, 1);
  }

  /** Unit vector from the car toward its velocity (or forward when stopped). */
  velocityHeading(): number {
    if (this.speed < 2) return this.heading;
    return Math.atan2(this.vx, this.vz);
  }
}
