import * as THREE from 'three';
import { World } from '../core/World';
import { Car } from '../vehicles/Car';
import { getCarDef } from '../vehicles/CarDefs';
import { CameraRig, type CameraMode } from '../core/CameraRig';
import { SpeedLines } from '../core/SpeedLines';
import type { Renderer, View } from '../core/Renderer';
import type { Input } from '../core/Input';
import type { TrackDef } from '../tracks/types';
import { HUD, type StandingRow } from '../ui/HUD';
import type { MinimapDot } from '../ui/Minimap';
import type { ModeRules, Difficulty } from './ModeRules';
import { makeFrame } from '../tracks/Track';
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

export interface RaceConfig {
  track: TrackDef;
  participants: Participant[];
  rules: ModeRules;
  difficulty: Difficulty;
  split: boolean;
  countdown: boolean;
  units: 'kmh' | 'mph';
  cameraMode: CameraMode;
}

/** Something that drives a car (AI, autopilot for finished humans, ghosts...). */
export interface Brain {
  update(dt: number, car: RaceCar, session: RaceSession): void;
}

/** Audio hooks (implemented by the audio engine; optional so tests can run headless). */
export interface SessionAudio {
  attach(session: RaceSession): void;
  update(session: RaceSession, dt: number): void;
  event(name: 'countdown' | 'go' | 'lap' | 'finalLap' | 'finish' | 'boostPad' | 'wall' | 'land' | 'perfect' | 'eliminated' | 'gate' | 'bump', intensity?: number): void;
  detach(): void;
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
  /** Score used by some modes. */
  score: number;
  driftChain: number;
}

export interface PlayerView {
  player: number;
  rc: RaceCar;
  rig: CameraRig;
  hud: HUD;
  speedLines: SpeedLines;
  rect: { x: number; y: number; w: number; h: number };
  wrongWayShown: boolean;
}

export type Phase = 'intro' | 'countdown' | 'racing' | 'finished';

const _v = new THREE.Vector3();
const _frame = makeFrame();

/**
 * The shared race runner used by every mode: builds the world, places the grid, runs
 * the countdown, steps physics/AI, tracks laps and positions and drives the HUD.
 */
export class RaceSession {
  readonly world: World;
  readonly cars: RaceCar[] = [];
  readonly players: PlayerView[] = [];
  readonly rules: ModeRules;
  phase: Phase = 'countdown';
  /** Race clock (starts at GO). */
  time = 0;
  countdown = 3.6;
  private lastCount = 4;
  finishOrder = 0;
  audio: SessionAudio | null = null;
  /** Called once when the race is over. */
  onOver: (() => void) | null = null;
  private overFired = false;
  /** Called when a human presses pause. */
  onPause: (() => void) | null = null;
  readonly split: boolean;
  private throttleSince: number[] = [-1, -1];
  private readonly autoBrains = new Map<number, Brain>();
  /** Factory for AI brains (injected by the mode so AI code stays in /src/ai). */
  makeBrain: ((rc: RaceCar, session: RaceSession, autopilot: boolean) => Brain) | null = null;
  readonly uiRoot: HTMLElement;
  private started = false;
  private readonly startGrid: { x: number; z: number; y: number; h: number }[] = [];
  elapsed = 0;

  constructor(
    readonly renderer: Renderer,
    readonly input: Input,
    readonly config: RaceConfig,
    uiRoot: HTMLElement,
    world?: World,
  ) {
    this.rules = config.rules;
    this.split = config.split;
    this.uiRoot = uiRoot;
    this.world = world ?? new World(renderer, config.track);
    const track = this.world.track;
    const q = renderer.quality;

    // Build cars.
    config.participants.forEach((p, i) => {
      const def = getCarDef(p.carId);
      const car = new Car(def, p.color, track, p.name, p.kind === 'human' ? 'human' : 'ai', q);
      this.world.scene.add(car.object);
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
      });
    });
    this.placeGrid();

    // Player views.
    const humans = this.cars.filter((c) => c.isHuman).sort((a, b) => a.player - b.player);
    humans.forEach((rc, i) => {
      const rect = this.split ? { x: 0, y: i === 0 ? 0 : 0.5, w: 1, h: 0.5 } : { x: 0, y: 0, w: 1, h: 1 };
      const rig = new CameraRig(renderer.width / renderer.height);
      rig.mode = config.cameraMode;
      this.world.scene.add(rig.camera);
      const speedLines = new SpeedLines(this.split ? 40 : 70);
      rig.camera.add(speedLines.mesh);
      const hud = new HUD(uiRoot, rect, track, { compact: this.split, units: config.units });
      this.players.push({ player: rc.player, rc, rig, hud, speedLines, rect, wrongWayShown: false });
    });
    if (!config.countdown) {
      this.countdown = 0;
      this.phase = 'racing';
    }
  }

  get track() {
    return this.world.track;
  }

  get humanCars() {
    return this.cars.filter((c) => c.isHuman);
  }

  /** Grid: two columns, staggered, behind the start line. */
  private placeGrid() {
    const track = this.world.track;
    const main = track.main;
    const n = this.cars.length;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const s = track.length - 8 - row * 9 - col * 4.5;
      main.frameAt(s, _frame);
      const lat = (col === 0 ? 1 : -1) * Math.min(3.4, _frame.hw * 0.45);
      const x = _frame.x + _frame.nx * lat;
      const z = _frame.z + _frame.nz * lat;
      this.startGrid.push({ x, z, y: _frame.y, h: _frame.heading });
    }
    // Humans at the back in races with AI (arcade tradition), front if alone.
    const order = [...this.cars].sort((a, b) => {
      if (a.isHuman !== b.isHuman && this.cars.length > 2 && this.rules.showPosition) return a.isHuman ? 1 : -1;
      return a.index - b.index;
    });
    order.forEach((rc, slot) => {
      const g = this.startGrid[slot];
      rc.car.place(g.x, g.y, g.z, g.h);
      rc.lastMainS = rc.car.ground.q.mainS;
      rc.progress = rc.lastMainS - track.length;
      rc.car.physics.enabled = !this.config.countdown;
    });
  }

  start() {
    if (this.started) return;
    this.started = true;
    for (const rc of this.cars) {
      if (!rc.isHuman && this.makeBrain) rc.brain = this.makeBrain(rc, this, false);
    }
    this.rules.onStart?.(this);
    this.audio?.attach(this);
    for (const pv of this.players) pv.rig.snap();
  }

  /** Fixed-timestep simulation. */
  step(dt: number) {
    if (!this.started) this.start();
    this.elapsed += dt;
    const input = this.input;
    // Human input.
    for (const pv of this.players) {
      const rc = pv.rc;
      if (rc.finished || rc.eliminated) continue;
      input.readDrive(pv.player, this.split, dt, rc.car.input);
    }

    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown);
      if (c !== this.lastCount && c >= 1 && c <= 3) {
        this.lastCount = c;
        for (const pv of this.players) pv.hud.showCountdown(String(c));
        this.audio?.event('countdown');
      }
      // Track when each human started holding throttle (for the perfect start).
      for (const pv of this.players) {
        const held = pv.rc.car.input.throttle > 0.5;
        if (held && this.throttleSince[pv.player] < 0) this.throttleSince[pv.player] = this.countdown;
        if (!held) this.throttleSince[pv.player] = -1;
      }
      for (const rc of this.cars) rc.car.physics.step(dt, rc.car.input, rc.car.ground); // revs only (disabled)
      if (this.countdown <= 0) this.go();
      return;
    }

    if (this.phase === 'racing' || this.phase === 'finished') {
      this.time += dt;
      // Brains (AI / autopilot).
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
      if (!this.overFired && this.isOver()) {
        this.overFired = true;
        this.phase = 'finished';
        this.finalizeResults();
        this.onOver?.();
      }
    }
  }

  private go() {
    this.phase = 'racing';
    this.time = 0;
    for (const rc of this.cars) {
      rc.car.physics.enabled = true;
      rc.lapStart = 0;
    }
    for (const pv of this.players) {
      pv.hud.showCountdown('GO!', true);
      const since = this.throttleSince[pv.player];
      const held = pv.rc.car.input.throttle > 0.5;
      if (held && since >= 0 && since < 0.55) {
        pv.rc.car.physics.launchBoost = 1.1;
        pv.hud.popup('PERFECT START!', 'cyan');
        this.audio?.event('perfect');
      }
    }
    this.audio?.event('go');
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
      let best = 0;
      const pa = a.car.physics;
      if (pa.speed < 18 || a.eliminated) {
        pa.draft = 0;
        continue;
      }
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
        if (dx0 * dx0 + dz0 * dz0 > 36) continue;
        if (Math.abs(pa.y - pb.y) > 1.6) continue;
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
            if (d2 >= (2 * R) * (2 * R) || d2 < 1e-6) continue;
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
              // A little spin from off-centre hits.
              pa.yawRate += ca * rv * 0.01;
              pb.yawRate -= cb * rv * 0.01;
              if (-rv > 3) {
                if (a.isHuman || b.isHuman) this.audio?.event('bump', clamp(-rv / 15, 0, 1));
                for (const rc of [a, b]) {
                  if (rc.isHuman) {
                    const pv = this.players.find((p) => p.rc === rc);
                    pv?.rig.addShake(clamp(-rv / 20, 0.1, 0.5));
                    this.input.rumble(rc.player, this.split, 0.4, 0.6, 120);
                  }
                }
                const mx = (ax + bx) / 2;
                const mz = (az + bz) / 2;
                for (let k = 0; k < 6; k++) {
                  this.world.effects.sparks.emit({ x: mx, y: pa.y + 0.6, z: mz, vx: (Math.random() - 0.5) * 6, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 6, life: 0.35, size: 0.25, endSize: 0.05, r: 3, g: 2.5, b: 1.2, gravity: 12 });
                }
              }
            }
          }
        }
      }
    }
  }

  private updateProgress(rc: RaceCar, dt: number) {
    if (rc.eliminated) return;
    const L = this.track.length;
    const q = rc.car.ground.q;
    let d = q.mainS - rc.lastMainS;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    if (Math.abs(d) < 60) rc.progress += d;
    rc.lastMainS = q.mainS;

    if (this.phase !== 'racing' && this.phase !== 'finished') return;
    const p = rc.car.physics;
    // Wrong-way detection.
    const along = p.vx * q.tx + p.vz * q.tz;
    if (along < -3 && q.path === 0) rc.wrongWay += dt;
    else rc.wrongWay = Math.max(0, rc.wrongWay - dt * 2);
    // Stuck / lost detection -> auto reset.
    const trying = rc.car.input.throttle > 0.3 || !rc.isHuman;
    if (p.speed < 1.5 && trying) rc.stuck += dt;
    else rc.stuck = Math.max(0, rc.stuck - dt);
    if (rc.stuck > (rc.isHuman ? 3.5 : 2.5) || rc.wrongWay > (rc.isHuman ? 8 : 3) || p.y < q.ground - 8) this.resetCar(rc);

    // Laps.
    const laps = Math.floor(rc.progress / L);
    if (laps > rc.lapsDone && !rc.finished) {
      const lapTime = this.time - rc.lapStart;
      rc.lapsDone = laps;
      rc.lapTimes.push(lapTime);
      rc.lapStart = this.time;
      if (lapTime < rc.bestLap) rc.bestLap = lapTime;
      this.rules.onLap?.(this, rc, lapTime);
      const total = this.rules.laps;
      const pv = this.players.find((v) => v.rc === rc);
      if (total > 0 && laps >= total) {
        this.finishCar(rc);
      } else if (pv) {
        if (total > 0 && laps === total - 1) {
          pv.hud.message('FINAL LAP!', 2);
          this.audio?.event('finalLap');
        } else if (total > 0) {
          pv.hud.message(`LAP ${laps + 1}`, 1.5);
          this.audio?.event('lap');
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
    const pv = this.players.find((v) => v.rc === rc);
    if (pv) {
      pv.hud.message(rc.place === 1 && this.rules.showPosition ? 'YOU WIN!' : 'FINISH!', 4);
      this.audio?.event('finish');
    }
  }

  /** Puts a car back on the track centre, facing forward, briefly non-colliding. */
  resetCar(rc: RaceCar) {
    const track = this.track;
    const s = ((rc.lastMainS - 6) % track.length + track.length) % track.length;
    track.main.frameAt(s, _frame);
    const lat = clamp(rc.car.ground.q.path === 0 ? rc.car.ground.q.lateral : 0, -_frame.hw * 0.5, _frame.hw * 0.5);
    rc.car.place(_frame.x + _frame.nx * lat, _frame.y, _frame.z + _frame.nz * lat, _frame.heading);
    rc.car.physics.enabled = this.phase === 'racing' || this.phase === 'finished';
    rc.lastMainS = rc.car.ground.q.mainS;
    rc.stuck = 0;
    rc.wrongWay = 0;
    rc.ghostTime = 1.5;
    const pv = this.players.find((v) => v.rc === rc);
    pv?.rig.snap();
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
    for (const rc of this.cars) if (rc.eliminated) rc.position = ++k;
  }

  /** Cars ranked by current race position. */
  ranking(): RaceCar[] {
    return [...this.cars].sort((a, b) => a.position - b.position);
  }

  private isOver(): boolean {
    if (this.rules.isOver) return this.rules.isOver(this);
    if (this.rules.laps <= 0) return false;
    return this.humanCars.every((c) => c.finished || c.eliminated);
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
  }

  /** Per-step events (sparks/landings/boost pads) -> shake, rumble, audio, HUD. */
  private handleEvents() {
    for (const pv of this.players) {
      const p = pv.rc.car.physics;
      const ev = p.events;
      if (ev.wallImpact > 2) {
        pv.rig.addShake(clamp(ev.wallImpact / 25, 0.1, 0.6));
        this.input.rumble(pv.player, this.split, 0.5, 0.5, 100);
        this.audio?.event('wall', clamp(ev.wallImpact / 20, 0.1, 1));
      }
      if (ev.landed > 3) {
        pv.rig.addShake(clamp(ev.landed / 20, 0.1, 0.5));
        this.input.rumble(pv.player, this.split, 0.6, 0.3, 140);
        this.audio?.event('land', clamp(ev.landed / 12, 0.1, 1));
      }
      if (ev.boostPad) {
        pv.hud.popup('BOOST PAD!', 'pink');
        this.audio?.event('boostPad');
      }
      // Drift score popups.
      if (p.drifting) pv.rc.driftChain += p.speed * Math.abs(p.driftMag) * Loop.STEP * 10;
      if (ev.driftEnded > 0.6 && pv.rc.driftChain > 40) {
        const score = Math.round(pv.rc.driftChain / 10) * 10;
        pv.hud.popup(`DRIFT +${score}`, score > 400 ? 'pink' : '');
        pv.rc.score += score;
      }
      if (!p.drifting) pv.rc.driftChain = 0;
    }
  }

  /** Per-frame visual update: interpolation, cameras, effects and HUD. */
  render(alpha: number, dt: number): View[] {
    const views: View[] = [];
    for (const rc of this.cars) {
      rc.car.sync(alpha, dt, this.world.time);
      const ghosting = rc.ghostTime > 0;
      if (ghosting) rc.car.visual.setOpacity(0.5 + 0.3 * Math.sin(this.elapsed * 30));
      else if (rc.car.opacity >= 1 && rc.car.visual.paint.opacity < 1) rc.car.visual.setOpacity(1);
    }
    this.world.scene.updateMatrixWorld();
    for (const rc of this.cars) rc.car.emitEffects(this.world.effects, dt);
    const focus = this.players[0]?.rc.car.object.position ?? _v.set(0, 0, 0);
    this.world.update(dt, focus);

    for (const pv of this.players) {
      const rc = pv.rc;
      const p = rc.car.physics;
      // Camera controls.
      if (this.input.actionPressed('camera', pv.player, this.split)) pv.rig.cycle();
      pv.rig.lookBack = this.input.actionDown('lookback', pv.player, this.split);
      if (this.input.actionPressed('reset', pv.player, this.split) && this.phase === 'racing' && !rc.finished) this.resetCar(rc);
      if (this.input.actionPressed('pause', pv.player, this.split)) this.onPause?.();
      // Hide other players' car body when in bumper cam? (only our own car hides)
      pv.rig.update(rc.car, alpha, dt);
      pv.speedLines.update(dt, clamp(p.speed / p.p.topSpeed, 0, 1.3), p.boosting);
      views.push({ camera: pv.rig.camera, x: pv.rect.x, y: 1 - pv.rect.y - pv.rect.h, w: pv.rect.w, h: pv.rect.h });

      // HUD.
      const hud = pv.hud;
      hud.update(dt);
      hud.setSpeed(p.speed * Math.sign(p.vLong || 1), p.p.topSpeed, p.gear, p.boost, p.boosting);
      const total = this.rules.laps;
      const lapNow = Math.max(1, rc.lapsDone + 1);
      hud.setLap(rc.finished ? total : lapNow, total, this.rules.lapLabel ?? 'LAP');
      if (this.rules.showPosition) hud.setPosition(rc.position, this.cars.filter((c) => !c.eliminated).length);
      else hud.setPosition(0, 0);
      const raceT = this.phase === 'countdown' ? 0 : rc.finished ? rc.finishTime : this.time;
      hud.setTimes(raceT, rc.finished ? rc.lapTimes[rc.lapTimes.length - 1] ?? 0 : this.time - rc.lapStart, rc.bestLap);
      const wrong = rc.wrongWay > 1.0 && !rc.finished;
      if (wrong && !pv.wrongWayShown) hud.message('WRONG WAY!', 1.2, 'warn');
      if (wrong) hud.message('WRONG WAY!', 0.3, 'warn');
      pv.wrongWayShown = wrong;
    }
    // Minimap + standings.
    const dots: MinimapDot[] = this.cars.map((rc) => ({
      x: rc.car.physics.x,
      z: rc.car.physics.z,
      color: rc.car.color,
      me: false,
      heading: rc.car.physics.heading,
      hidden: rc.eliminated,
    }));
    const ranking = this.ranking();
    for (const pv of this.players) {
      for (let i = 0; i < dots.length; i++) dots[i].me = this.cars[i] === pv.rc;
      pv.hud.setMinimap(dots);
      if (this.rules.showPosition && !this.split) {
        const rows: StandingRow[] = ranking.map((rc) => ({ name: rc.participant.name, color: rc.car.color, me: rc === pv.rc, out: rc.eliminated }));
        pv.hud.setStandings(rows);
      }
    }
    this.rules.hud?.(this, dt);
    this.audio?.update(this, dt);
    return views;
  }

  /** Post-processing parameters for the (single) main view. */
  frameFX() {
    const pv = this.players[0];
    if (!pv) return { blur: 0, aberration: 0, bloom: this.world.sky.preset.bloom };
    const p = pv.rc.car.physics;
    const sf = clamp(p.speed / p.p.topSpeed, 0, 1.3);
    const blur = clamp((sf - 0.45) * 1.4, 0, 1) * 0.7 + (p.boosting ? 0.5 : 0);
    return { blur, aberration: p.boosting ? 0.8 : 0, bloom: this.world.sky.preset.bloom + (p.boosting ? 0.15 : 0) };
  }

  setCameraMode(mode: CameraMode) {
    for (const pv of this.players) pv.rig.mode = mode;
  }

  /** Heading of the track at a car (used by AI). */
  trackHeadingAt(rc: RaceCar): number {
    const q = rc.car.ground.q;
    return Math.atan2(q.tx, q.tz);
  }

  dispose(keepWorld = false) {
    this.audio?.detach();
    for (const pv of this.players) {
      pv.hud.destroy();
      pv.speedLines.dispose();
    }
    for (const rc of this.cars) {
      this.world.scene.remove(rc.car.object);
      rc.car.dispose();
    }
    if (!keepWorld) this.world.dispose();
  }
}
