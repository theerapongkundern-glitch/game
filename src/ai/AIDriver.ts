import { RacingLine } from './RacingLine';
import { DIFFICULTY, type DifficultyParams } from './Difficulty';
import type { Brain, RaceCar, RaceSim } from '../modes/RaceSim';
import type { Track } from '../tracks/Track';
import { SAMPLE_SPACING } from '../tracks/Track';
import { SURFACES } from '../tracks/Surfaces';
import type { VehicleParams } from '../vehicles/VehiclePhysics';
import { clamp, lerp, mod, wrapAngle } from '../core/math';
import { noise1 } from '../core/rng';
import type { Difficulty } from '../modes/ModeRules';

/** Per-track AI data: racing lines (one per path) and cached speed profiles. */
export class AIContext {
  readonly lines: RacingLine[];
  private readonly profiles = new Map<string, Float32Array[]>();
  private readonly grip: number[][];

  constructor(readonly track: Track) {
    this.lines = track.paths.map((p) => new RacingLine(p));
    this.grip = track.paths.map((p, k) => {
      const line = this.lines[k];
      const g: number[] = [];
      for (let i = 0; i < p.n; i++) g.push(SURFACES[p.surfaceAt(i * SAMPLE_SPACING, line.offset[i])].grip);
      return g;
    });
  }

  profile(params: VehicleParams, pace: number, braking: number): Float32Array[] {
    const key = `${params.mu.toFixed(3)}|${params.topSpeed.toFixed(2)}|${pace}|${braking}`;
    let pr = this.profiles.get(key);
    if (!pr) {
      pr = this.lines.map((line, k) => {
        const v = line.speedProfile(params.mu * 0.94, params.downforce, params.topSpeed * 1.05, params.brakeDecel * braking, this.grip[k]);
        for (let i = 0; i < v.length; i++) v[i] *= pace;
        return v;
      });
      this.profiles.set(key, pr);
    }
    return pr;
  }
}

const contexts = new WeakMap<Track, AIContext>();
export function aiContext(track: Track): AIContext {
  let c = contexts.get(track);
  if (!c) {
    c = new AIContext(track);
    contexts.set(track, c);
  }
  return c;
}

let seedCounter = 1;

/**
 * Racing AI: pure-pursuit steering along the racing line, a braking-aware speed
 * profile, overtaking offsets, boost on straights, shortcut decisions and (Easy only)
 * gentle rubber-banding. Uses exactly the same physics as the player.
 */
export class AIDriver implements Brain {
  private readonly ctx: AIContext;
  private readonly d: DifficultyParams;
  private readonly profiles: Float32Array[];
  private readonly seed = seedCounter++;
  private bias = 0;
  private readonly laneBias: number;
  private readonly paceJitter: number;
  private t = 0;
  /** Shortcut decision per shortcut index for the current lap: 1 take, 0 skip. */
  private decisions = new Map<number, number>();
  private decisionLap = -1;
  private boostHold = 0;

  constructor(
    rc: RaceCar,
    session: RaceSim,
    difficulty: Difficulty,
    readonly autopilot = false,
  ) {
    this.ctx = aiContext(session.track);
    const base = DIFFICULTY[difficulty];
    this.d = autopilot ? { ...DIFFICULTY.normal, pace: 0.86, boost: false, shortcut: 0, rubberBand: 0, wobble: 0.3 } : base;
    // Personality: each rival has a slightly different pace and preferred lane.
    const r = Math.sin(this.seed * 12.9898 + rc.index * 78.233) * 43758.5453;
    const f = r - Math.floor(r);
    this.paceJitter = autopilot ? 0 : (f - 0.5) * 0.04;
    this.laneBias = (f - 0.5) * 1.6;
    this.profiles = this.ctx.profile(rc.car.physics.p, this.d.pace + this.paceJitter, this.d.braking);
    rc.car.physics.powerScale = this.d.power;
  }

  update(dt: number, rc: RaceCar, s: RaceSim) {
    const car = rc.car;
    const p = car.physics;
    const q = car.ground.q;
    const input = car.input;
    this.t += dt;
    if (!p.enabled) {
      input.throttle = 0;
      input.brake = 0;
      input.steer = 0;
      return;
    }
    const track = s.track;
    const L = track.length;
    const speed = p.speed;

    // --- Shortcut decisions (once per lap) --------------------------------------------------
    if (rc.lapsDone !== this.decisionLap) {
      this.decisionLap = rc.lapsDone;
      this.decisions.clear();
      for (let k = 1; k < track.paths.length; k++) {
        const roll = noise1(this.seed * 3.1 + rc.lapsDone * 7.7 + k, 5) * 0.5 + 0.5;
        this.decisions.set(k, roll < this.d.shortcut ? 1 : 0);
      }
    }

    // --- Target point -----------------------------------------------------------------------
    const la = clamp(6 + speed * 0.42, 8, 34);
    let pathId = q.path;
    let idx = q.index;
    let tx = 0;
    let tz = 0;
    let tnx = 0;
    let tnz = 0;
    let thw = 5;
    let aheadIdx = 0;
    let aheadPath = pathId;
    const pick = (pid: number, i: number) => {
      const path = track.paths[pid];
      const line = this.ctx.lines[pid];
      const j = path.idx(i);
      tx = line.x[j];
      tz = line.z[j];
      tnx = path.nx[j];
      tnz = path.nz[j];
      thw = path.hw[j];
      aheadIdx = j;
      aheadPath = pid;
    };
    const steps = Math.round(la / SAMPLE_SPACING);
    if (pathId === 0) {
      // Planning to take a shortcut whose entry is within the lookahead?
      let used = false;
      for (let k = 1; k < track.paths.length; k++) {
        if (this.decisions.get(k) !== 1) continue;
        const sc = track.paths[k];
        const dist = mod(sc.mainFrom - q.mainS, L);
        if (dist < la) {
          const into = Math.max(0, Math.round((la - dist) / SAMPLE_SPACING));
          pick(k, Math.min(sc.n - 1, into));
          used = true;
          break;
        }
      }
      if (!used) pick(0, idx + steps);
    } else {
      const sc = track.paths[pathId];
      if (idx + steps < sc.n - 1) pick(pathId, idx + steps);
      else {
        const over = idx + steps - (sc.n - 1);
        const mainIdx = Math.round((sc.mainFrom + sc.mainSpan) / SAMPLE_SPACING) + over;
        pick(0, mainIdx);
        pathId = 0;
        idx = mainIdx - steps;
      }
    }

    // --- Lateral bias: personality, wobble, overtaking ---------------------------------------
    let wantBias = this.laneBias * 0.6 + noise1(this.t * 0.35, this.seed) * this.d.wobble;
    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    for (const other of s.cars) {
      if (other === rc || other.eliminated || other.ghostTime > 0) continue;
      const op = other.car.physics;
      const dx = op.x - p.x;
      const dz = op.z - p.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < -2 || ahead > 22) continue;
      const left = dx * fz - dz * fx;
      if (Math.abs(left) > 3.6) continue;
      if (op.speed > speed + 2 && ahead > 6) continue;
      const side = left > 0 ? -1 : 1; // pass on the side away from them
      const strength = (1 - Math.abs(left) / 3.6) * (1 - Math.max(0, ahead) / 22);
      wantBias += side * 3.2 * strength;
    }
    this.bias = lerp(this.bias, wantBias, clamp(dt * 2.5, 0, 1));
    const lineOffset = this.ctx.lines[aheadPath].offset[aheadIdx];
    const maxOff = Math.max(0, thw - 1.4);
    const biased = clamp(lineOffset + this.bias, -maxOff, maxOff) - lineOffset;
    tx += tnx * biased;
    tz += tnz * biased;

    // --- Steering (pure pursuit) ------------------------------------------------------------
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.max(4, Math.hypot(dx, dz));
    const alpha = wrapAngle(Math.atan2(dx, dz) - p.heading); // left-positive
    const kappa = (2 * Math.sin(alpha)) / dist;
    let delta = Math.atan(kappa * p.p.wheelbase);
    // Damp yaw oscillation a little.
    delta -= p.yawRate * 0.02;
    const sf = clamp(Math.abs(p.vLong) / p.p.topSpeed, 0, 1);
    const maxSteer = lerp(p.p.steerLow, p.p.steerHigh, Math.pow(sf, 0.65));
    input.steer = clamp(-delta / maxSteer, -1, 1);
    input.handbrake = false;

    // --- Speed control ------------------------------------------------------------------------
    const prof = this.profiles[q.path];
    const lead = Math.ceil((speed * 0.3) / SAMPLE_SPACING);
    const path = track.paths[q.path];
    let vT = prof[path.idx(q.index + lead)];
    if (!path.closed && q.index + lead >= path.n - 1) vT = Math.min(vT, this.profiles[0][track.main.idx(Math.round((path.mainFrom + path.mainSpan) / SAMPLE_SPACING))]);
    // Rubber-banding (Easy only): ease off when far ahead of the human, push a bit when far behind.
    let rubber = 1;
    if (this.d.rubberBand > 0) {
      const humans = s.cars.filter((c) => c.isHuman && !c.finished);
      if (humans.length) {
        const hp = Math.max(...humans.map((h) => h.progress));
        const gap = rc.progress - hp;
        if (gap > 25) rubber = 1 - this.d.rubberBand * clamp((gap - 25) / 120, 0, 1);
        else if (gap < -40) rubber = 1 + this.d.rubberBand * 0.6 * clamp((-gap - 40) / 150, 0, 1);
      }
    }
    vT *= rubber;
    p.powerScale = this.d.power * (rubber > 1 ? rubber : 1);
    // Don't aim to leave the road: slow if we're off it.
    if (!q.onRoad) vT = Math.min(vT, Math.max(18, speed));
    const err = vT - speed;
    if (err > 0) {
      input.throttle = clamp(0.4 + err * 0.3, 0, 1);
      input.brake = 0;
    } else if (err > -2.5) {
      input.throttle = clamp(0.3 + err * 0.12, 0, 0.3);
      input.brake = 0;
    } else {
      input.throttle = 0;
      input.brake = clamp(-err * 0.2, 0.2, 1);
    }
    // Early race: floor it.
    if (s.time < 1.5) {
      input.throttle = 1;
      input.brake = 0;
    }

    // --- Boost on straights ---------------------------------------------------------------------
    this.boostHold = Math.max(0, this.boostHold - dt);
    input.boost = false;
    if (this.d.boost && p.boost > 0.35 && speed > 22 && q.onRoad) {
      const top = p.p.topSpeed * this.d.pace;
      let clear = true;
      for (let k = 10; k < 70; k += 6) {
        if (prof[path.idx(q.index + k)] < top * 0.92) {
          clear = false;
          break;
        }
      }
      if (clear) this.boostHold = 1.2;
    }
    if (this.boostHold > 0 && p.boost > 0.02) input.boost = true;
  }
}

/** Convenience factory used by modes. */
export function makeAIBrainFactory(difficulty: Difficulty) {
  return (rc: RaceCar, session: RaceSim, autopilot: boolean): Brain => new AIDriver(rc, session, difficulty, autopilot);
}
