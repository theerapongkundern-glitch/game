import { Car } from '../vehicles/Car';
import { getCarDef } from '../vehicles/CarDefs';
import type { Track } from '../tracks/Track';
import { makeFrame } from '../tracks/Track';
import type { ModeRules, Difficulty } from './ModeRules';
import { clamp, lerp } from '../core/math';
import { Loop } from '../core/Loop';

export interface Participant {
  kind: 'human' | 'ai';
  /** Human player slot (0 or 1). */
  player?: number;
  carId: string;
  color: string;
  name: string;
}

/** Something that drives a car (AI, autopilot for finished humans, ghosts...). */
export interface Brain {
  update(dt: number, car: RaceCar, sim: RaceSim): void;
}

export interface RaceCar {
  index: number;
  car: Car;
  participant: Participant;
  isHuman: boolean;
  player: number;
  brain: Brain | null;
  /** Unwrapped distance along the main loop (negative before the start line). */
  progress: number;
  lastMainS: number;
  lapsDone: number;
  lapStart: number;
  lapTimes: number[];
  bestLap: number;
  finished: boolean;
  finishTime: number;
  place: number;
  position: number;
  wrongWay: number;
  stuck: number;
  eliminated: boolean;
  /** Seconds of no-collision after a reset. */
  ghostTime: number;
  /** Score used by some modes (drift points etc). */
  score: number;
  driftChain: number;
  /** Mode-specific data. */
  data: Record<string, number>;
}

export type SoundEvent = 'countdown' | 'go' | 'lap' | 'finalLap' | 'finish' | 'boostPad' | 'wall' | 'land' | 'perfect' | 'eliminated' | 'gate' | 'bump' | 'timeout';

/** UI/feedback sink so the simulation can run headless (tests) or drive the HUD/audio. */
export interface SimUI {
  countdown(text: string, go: boolean): void;
  message(rc: RaceCar | null, text: string, seconds?: number, cls?: string): void;
  popup(rc: RaceCar | null, text: string, cls?: string): void;
  sound(name: SoundEvent, intensity?: number, rc?: RaceCar | null): void;
  shake(rc: RaceCar, amount: number): void;
  rumble(rc: RaceCar, strong: number, weak: number, ms: number): void;
  resetView(rc: RaceCar): void;
}

const NULL_UI: SimUI = {
  countdown() {},
  message() {},
  popup() {},
  sound() {},
  shake() {},
  rumble() {},
  resetView() {},
};

export type Phase = 'countdown' | 'racing' | 'finished';

const _frame = makeFrame();

/**
 * Pure race logic (no rendering): grid, countdown, AI/human input, physics, car bumps,
 * drafting, lap/progress tracking, positions, resets and mode rules.
 */
export class RaceSim {
  readonly cars: RaceCar[] = [];
  phase: Phase = 'countdown';
  /** Race clock (starts at GO). */
  time = 0;
  countdown = 3.6;
  elapsed = 0;
  finishOrder = 0;
  ui: SimUI = NULL_UI;
  /** Factory for AI brains (injected so AI code stays in /src/ai). */
  makeBrain: ((rc: RaceCar, sim: RaceSim, autopilot: boolean) => Brain) | null = null;
  /** Called once when the race is over. */
  onOver: (() => void) | null = null;
  over = false;
  private started = false;
  private lastCount = 4;
  private readonly throttleSince: number[] = [-1, -1];
  private readonly autoBrains = new Map<number, Brain>();

  constructor(
    readonly track: Track,
    readonly participants: Participant[],
    readonly rules: ModeRules,
    readonly difficulty: Difficulty,
    opts: { countdown: boolean; quality: 'low' | 'medium' | 'high' },
  ) {
    participants.forEach((p, i) => {
      const def = getCarDef(p.carId);
      const car = new Car(def, p.color, track, p.name, p.kind === 'human' ? 'human' : 'ai', opts.quality);
      this.cars.push({
        index: i,
        car,
        participant: p,
        isHuman: p.kind === 'human',
        player: p.player ?? -1,
        brain: null,
        progress: 0,
        lastMainS: 0,
        lapsDone: 0,
        lapStart: 0,
        lapTimes: [],
        bestLap: Infinity,
        finished: false,
        finishTime: 0,
        place: 0,
        position: i + 1,
        wrongWay: 0,
        stuck: 0,
        eliminated: false,
        ghostTime: 0,
        score: 0,
        driftChain: 0,
        data: {},
      });
    });
    if (!opts.countdown) {
      this.countdown = 0;
      this.phase = 'racing';
    }
    this.placeGrid(opts.countdown);
    this.updatePositions();
  }

  get humanCars() {
    return this.cars.filter((c) => c.isHuman);
  }

  get activeCars() {
    return this.cars.filter((c) => !c.eliminated);
  }

  /** Grid: two columns, staggered, behind the start line. Humans start at the back of a pack. */
  private placeGrid(countdown: boolean) {
    const track = this.track;
    const main = track.main;
    const n = this.cars.length;
    const slots: { x: number; z: number; y: number; h: number }[] = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const s = track.length - 8 - row * 9 - col * 4.5;
      main.frameAt(s, _frame);
      const lat = (col === 0 ? 1 : -1) * Math.min(3.4, _frame.hw * 0.45);
      slots.push({ x: _frame.x + _frame.nx * lat, z: _frame.z + _frame.nz * lat, y: _frame.y, h: _frame.heading });
    }
    const order = [...this.cars].sort((a, b) => {
      if (a.isHuman !== b.isHuman && this.cars.length > 2 && this.rules.showPosition) return a.isHuman ? 1 : -1;
      return a.index - b.index;
    });
    order.forEach((rc, slot) => {
      const g = slots[slot];
      rc.car.place(g.x, g.y, g.z, g.h);
      rc.lastMainS = rc.car.ground.q.mainS;
      rc.progress = rc.lastMainS - track.length;
      rc.car.physics.enabled = !countdown;
    });
  }

  private start() {
    this.started = true;
    for (const rc of this.cars) if (!rc.isHuman && this.makeBrain) rc.brain = this.makeBrain(rc, this, false);
    this.rules.onStart?.(this);
  }

  /**
   * Advances the race by one fixed step. `readHuman` fills a human car's input.
   */
  step(dt: number, readHuman: (rc: RaceCar) => void) {
    if (!this.started) this.start();
    this.elapsed += dt;
    for (const rc of this.cars) {
      if (rc.isHuman && !rc.finished && !rc.eliminated && !rc.brain) readHuman(rc);
    }

    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown);
      if (c !== this.lastCount && c >= 1 && c <= 3) {
        this.lastCount = c;
        this.ui.countdown(String(c), false);
        this.ui.sound('countdown');
      }
      for (const rc of this.humanCars) {
        const slot = Math.max(0, rc.player);
        const held = rc.car.input.throttle > 0.5;
        if (held && this.throttleSince[slot] < 0) this.throttleSince[slot] = this.countdown;
        if (!held) this.throttleSince[slot] = -1;
      }
      for (const rc of this.cars) rc.car.physics.step(dt, rc.car.input, rc.car.ground); // engine revs only
      if (this.countdown <= 0) this.go();
      return;
    }

    this.time += dt;
    for (const rc of this.cars) {
      if (rc.eliminated) continue;
      const brain = rc.brain ?? (rc.finished && rc.isHuman ? this.autopilot(rc) : null);
      brain?.update(dt, rc, this);
    }
    this.updateDrafting();
    for (const rc of this.cars) {
      if (rc.eliminated) continue;
      rc.car.step(dt);
      rc.ghostTime = Math.max(0, rc.ghostTime - dt);
    }
    this.collideCars();
    for (const rc of this.cars) this.updateProgress(rc, dt);
    this.updatePositions();
    this.rules.update?.(this, dt);
    this.handleEvents();
    if (!this.over && this.isOver()) {
      this.over = true;
      this.phase = 'finished';
      this.finalizeResults();
      this.onOver?.();
    }
  }

  private go() {
    this.phase = 'racing';
    this.time = 0;
    for (const rc of this.cars) {
      rc.car.physics.enabled = true;
      rc.lapStart = 0;
    }
    this.ui.countdown('GO!', true);
    for (const rc of this.humanCars) {
      const since = this.throttleSince[Math.max(0, rc.player)];
      const held = rc.car.input.throttle > 0.5;
      if (held && since >= 0 && since < 0.55) {
        rc.car.physics.launchBoost = 1.1;
        this.ui.popup(rc, 'PERFECT START!', 'cyan');
        this.ui.sound('perfect', 1, rc);
      }
    }
    this.ui.sound('go');
  }

  private autopilot(rc: RaceCar): Brain | null {
    let b = this.autoBrains.get(rc.index);
    if (!b && this.makeBrain) {
      b = this.makeBrain(rc, this, true);
      this.autoBrains.set(rc.index, b);
    }
    return b ?? null;
  }

  private updateDrafting() {
    for (const a of this.cars) {
      const pa = a.car.physics;
      if (pa.speed < 18 || a.eliminated) {
        pa.draft = 0;
        continue;
      }
      let best = 0;
      const fx = Math.sin(pa.heading);
      const fz = Math.cos(pa.heading);
      for (const b of this.cars) {
        if (a === b || b.eliminated) continue;
        const pb = b.car.physics;
        const dx = pb.x - pa.x;
        const dz = pb.z - pa.z;
        const ahead = dx * fx + dz * fz;
        if (ahead < 3 || ahead > 16) continue;
        const lat = Math.abs(dx * fz - dz * fx);
        if (lat > 2.4) continue;
        const s = (1 - (ahead - 3) / 13) * (1 - lat / 2.4);
        if (s > best) best = s;
      }
      pa.draft = lerp(pa.draft, best, 0.1);
    }
  }

  /** Soft car-to-car bumps: two circles per car, split by mass. */
  private collideCars() {
    const n = this.cars.length;
    const R = 1.05;
    for (let i = 0; i < n; i++) {
      const a = this.cars[i];
      if (a.eliminated || a.ghostTime > 0) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.cars[j];
        if (b.eliminated || b.ghostTime > 0) continue;
        const pa = a.car.physics;
        const pb = b.car.physics;
        const dx0 = pb.x - pa.x;
        const dz0 = pb.z - pa.z;
        if (dx0 * dx0 + dz0 * dz0 > 36 || Math.abs(pa.y - pb.y) > 1.6) continue;
        const la = a.car.def.shape.wheelbase * 0.42;
        const lb = b.car.def.shape.wheelbase * 0.42;
        for (let ca = -1; ca <= 1; ca += 2) {
          for (let cb = -1; cb <= 1; cb += 2) {
            const ax = pa.x + Math.sin(pa.heading) * la * ca;
            const az = pa.z + Math.cos(pa.heading) * la * ca;
            const bx = pb.x + Math.sin(pb.heading) * lb * cb;
            const bz = pb.z + Math.cos(pb.heading) * lb * cb;
            const dx = bx - ax;
            const dz = bz - az;
            const d2 = dx * dx + dz * dz;
            if (d2 >= 4 * R * R || d2 < 1e-6) continue;
            const d = Math.sqrt(d2);
            const nx = dx / d;
            const nz = dz / d;
            const pen = 2 * R - d;
            const ma = pa.p.mass;
            const mb = pb.p.mass;
            const wa = mb / (ma + mb);
            const wb = ma / (ma + mb);
            pa.x -= nx * pen * wa;
            pa.z -= nz * pen * wa;
            pb.x += nx * pen * wb;
            pb.z += nz * pen * wb;
            const rv = (pb.vx - pa.vx) * nx + (pb.vz - pa.vz) * nz;
            if (rv < 0) {
              const e = 0.35;
              const jimp = (-(1 + e) * rv) / (1 / ma + 1 / mb);
              pa.vx -= (jimp / ma) * nx;
              pa.vz -= (jimp / ma) * nz;
              pb.vx += (jimp / mb) * nx;
              pb.vz += (jimp / mb) * nz;
              pa.yawRate += ca * rv * 0.01;
              pb.yawRate -= cb * rv * 0.01;
              if (-rv > 3) {
                const k = clamp(-rv / 15, 0, 1);
                for (const rc of [a, b]) {
                  if (!rc.isHuman) continue;
                  this.ui.sound('bump', k, rc);
                  this.ui.shake(rc, clamp(-rv / 20, 0.1, 0.5));
                  this.ui.rumble(rc, 0.4, 0.6, 120);
                }
                this.bumpSparks((ax + bx) / 2, pa.y + 0.6, (az + bz) / 2);
              }
            }
          }
        }
      }
    }
  }

  /** Hook for visual bump sparks (set by the renderer-side session). */
  bumpSparks: (x: number, y: number, z: number) => void = () => {};

  private updateProgress(rc: RaceCar, dt: number) {
    if (rc.eliminated) return;
    const L = this.track.length;
    const q = rc.car.ground.q;
    let d = q.mainS - rc.lastMainS;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    if (Math.abs(d) < 60) rc.progress += d;
    rc.lastMainS = q.mainS;
    if (this.phase === 'countdown') return;

    const p = rc.car.physics;
    const along = p.vx * q.tx + p.vz * q.tz;
    if (along < -3 && q.path === 0) rc.wrongWay += dt;
    else rc.wrongWay = Math.max(0, rc.wrongWay - dt * 2);
    const trying = rc.car.input.throttle > 0.3 || !rc.isHuman || rc.finished;
    if (p.speed < 1.5 && trying) rc.stuck += dt;
    else rc.stuck = Math.max(0, rc.stuck - dt);
    const lost = !q.onRoad && Math.abs(q.lateral) > q.halfWidth + 30;
    if (rc.stuck > (rc.isHuman ? 3.5 : 2.5) || rc.wrongWay > (rc.isHuman ? 8 : 3) || p.y < q.ground - 8 || lost) this.resetCar(rc);

    const laps = Math.floor(rc.progress / L);
    if (laps > rc.lapsDone && !rc.finished && !this.over) {
      const lapTime = this.time - rc.lapStart;
      rc.lapsDone = laps;
      rc.lapTimes.push(lapTime);
      rc.lapStart = this.time;
      if (lapTime < rc.bestLap) rc.bestLap = lapTime;
      this.rules.onLap?.(this, rc, lapTime);
      const total = this.rules.laps;
      if (total > 0 && laps >= total && !rc.eliminated) this.finishCar(rc);
      else if (rc.isHuman && total > 0 && !rc.eliminated) {
        if (laps === total - 1) {
          this.ui.message(rc, 'FINAL LAP!', 2);
          this.ui.sound('finalLap', 1, rc);
        } else {
          this.ui.message(rc, `LAP ${laps + 1}`, 1.5);
          this.ui.sound('lap', 1, rc);
        }
      }
    }
  }

  finishCar(rc: RaceCar) {
    if (rc.finished) return;
    rc.finished = true;
    rc.finishTime = this.time;
    rc.place = ++this.finishOrder;
    this.rules.onFinish?.(this, rc);
    if (rc.isHuman) {
      this.ui.message(rc, rc.place === 1 && this.rules.showPosition ? 'YOU WIN!' : 'FINISH!', 4);
      this.ui.sound('finish', 1, rc);
    }
  }

  /** Puts a car back on the track centre, facing forward, briefly non-colliding. */
  resetCar(rc: RaceCar) {
    const track = this.track;
    const s = (((rc.lastMainS - 6) % track.length) + track.length) % track.length;
    track.main.frameAt(s, _frame);
    const q = rc.car.ground.q;
    const lat = clamp(q.path === 0 ? q.lateral : 0, -_frame.hw * 0.5, _frame.hw * 0.5);
    rc.car.place(_frame.x + _frame.nx * lat, _frame.y, _frame.z + _frame.nz * lat, _frame.heading);
    rc.car.physics.enabled = this.phase !== 'countdown';
    rc.lastMainS = rc.car.ground.q.mainS;
    rc.stuck = 0;
    rc.wrongWay = 0;
    rc.ghostTime = 1.5;
    this.ui.resetView(rc);
  }

  private updatePositions() {
    const order = this.cars
      .filter((c) => !c.eliminated)
      .sort((a, b) => {
        if (a.finished && b.finished) return a.place - b.place;
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        return b.progress - a.progress;
      });
    order.forEach((rc, i) => (rc.position = i + 1));
    let k = order.length;
    const out = this.cars.filter((c) => c.eliminated).sort((a, b) => b.finishTime - a.finishTime);
    for (const rc of out) rc.position = ++k;
  }

  ranking(): RaceCar[] {
    return [...this.cars].sort((a, b) => a.position - b.position);
  }

  private isOver(): boolean {
    if (this.rules.isOver) return this.rules.isOver(this);
    if (this.rules.laps <= 0) return false;
    const humans = this.humanCars;
    if (humans.length === 0) return this.cars.every((c) => c.finished || c.eliminated);
    return humans.every((c) => c.finished || c.eliminated);
  }

  /** Assigns places/times to cars that didn't finish, based on progress. */
  private finalizeResults() {
    const L = this.track.length;
    const total = this.rules.laps;
    const unfinished = this.cars.filter((c) => !c.finished && !c.eliminated).sort((a, b) => b.progress - a.progress);
    for (const rc of unfinished) {
      rc.place = ++this.finishOrder;
      if (total > 0) {
        const remaining = Math.max(0, total * L - rc.progress);
        const avg = Math.max(15, rc.progress / Math.max(1, this.time));
        rc.finishTime = this.time + remaining / avg;
      } else rc.finishTime = this.time;
    }
    const elim = this.cars.filter((c) => c.eliminated).sort((a, b) => b.finishTime - a.finishTime);
    for (const rc of elim) rc.place = ++this.finishOrder;
    this.updatePositions();
  }

  /** Per-step physics events (walls, landings, boost pads, drifts) -> feedback. */
  private handleEvents() {
    for (const rc of this.cars) {
      if (!rc.isHuman) continue;
      const p = rc.car.physics;
      const ev = p.events;
      if (ev.wallImpact > 2) {
        this.ui.shake(rc, clamp(ev.wallImpact / 25, 0.1, 0.6));
        this.ui.rumble(rc, 0.5, 0.5, 100);
        this.ui.sound('wall', clamp(ev.wallImpact / 20, 0.1, 1), rc);
      }
      if (ev.landed > 3) {
        this.ui.shake(rc, clamp(ev.landed / 20, 0.1, 0.5));
        this.ui.rumble(rc, 0.6, 0.3, 140);
        this.ui.sound('land', clamp(ev.landed / 12, 0.1, 1), rc);
      }
      if (ev.boostPad) {
        this.ui.popup(rc, 'BOOST PAD!', 'pink');
        this.ui.sound('boostPad', 1, rc);
      }
      if (p.drifting) rc.driftChain += p.speed * Math.abs(p.driftMag) * Loop.STEP * 10;
      if (ev.driftEnded > 0.6 && rc.driftChain > 40) {
        const score = Math.round(rc.driftChain / 10) * 10;
        this.ui.popup(rc, `DRIFT +${score}`, score > 400 ? 'pink' : '');
        rc.score += score;
      }
      if (!p.drifting) rc.driftChain = 0;
    }
  }

  /** Removes a car from the race (Elimination mode). */
  eliminate(rc: RaceCar) {
    if (rc.eliminated) return;
    rc.eliminated = true;
    rc.finishTime = this.time;
    rc.car.physics.enabled = false;
    rc.car.physics.noWalls = true;
  }

  dispose() {
    for (const rc of this.cars) rc.car.dispose();
  }
}
