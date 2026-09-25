import * as THREE from 'three';
import { World } from '../core/World';
import { CameraRig, type CameraMode } from '../core/CameraRig';
import { SpeedLines } from '../core/SpeedLines';
import type { Renderer, View } from '../core/Renderer';
import type { Input } from '../core/Input';
import type { TrackDef } from '../tracks/types';
import { HUD, type StandingRow } from '../ui/HUD';
import type { MinimapDot } from '../ui/Minimap';
import type { ModeRules, Difficulty } from './ModeRules';
import { RaceSim, type Participant, type RaceCar, type SimUI, type SoundEvent, type Brain } from './RaceSim';
import { clamp } from '../core/math';

export type { Participant, RaceCar, Brain };

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

/** Audio hooks (implemented by the audio engine). */
export interface SessionAudio {
  attach(session: RaceSession): void;
  update(session: RaceSession, dt: number): void;
  event(name: SoundEvent, intensity?: number, player?: number): void;
  detach(): void;
}

export interface PlayerView {
  player: number;
  rc: RaceCar;
  rig: CameraRig;
  hud: HUD;
  speedLines: SpeedLines;
  rect: { x: number; y: number; w: number; h: number };
}

const _v = new THREE.Vector3();

/**
 * Rendering side of a race: owns the World, cameras, HUDs and audio, and feeds the
 * RaceSim (pure logic) with player input.
 */
export class RaceSession implements SimUI {
  readonly world: World;
  readonly sim: RaceSim;
  readonly players: PlayerView[] = [];
  readonly rules: ModeRules;
  readonly split: boolean;
  audio: SessionAudio | null = null;
  /** Called when a human presses pause. */
  onPause: (() => void) | null = null;
  /** Extra per-frame render hook (ghost cars, gates...). */
  onRender: ((alpha: number, dt: number) => void) | null = null;
  private wrongWayShown: boolean[] = [];

  constructor(
    readonly renderer: Renderer,
    readonly input: Input,
    readonly config: RaceConfig,
    readonly uiRoot: HTMLElement,
    world?: World,
  ) {
    this.rules = config.rules;
    this.split = config.split;
    this.world = world ?? new World(renderer, config.track);
    this.sim = new RaceSim(this.world.track, config.participants, config.rules, config.difficulty, {
      countdown: config.countdown,
      quality: renderer.quality,
    });
    this.sim.ui = this;
    this.sim.bumpSparks = (x, y, z) => {
      for (let k = 0; k < 6; k++) {
        this.world.effects.sparks.emit({ x, y, z, vx: (Math.random() - 0.5) * 6, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 6, life: 0.35, size: 0.25, endSize: 0.05, r: 3, g: 2.5, b: 1.2, gravity: 12 });
      }
    };
    for (const rc of this.sim.cars) this.world.scene.add(rc.car.object);

    const humans = this.sim.humanCars.sort((a, b) => a.player - b.player);
    humans.forEach((rc, i) => {
      const rect = this.split ? { x: 0, y: i === 0 ? 0 : 0.5, w: 1, h: 0.5 } : { x: 0, y: 0, w: 1, h: 1 };
      const rig = new CameraRig(renderer.width / renderer.height);
      rig.mode = config.cameraMode;
      this.world.scene.add(rig.camera);
      const speedLines = new SpeedLines(this.split ? 40 : 70);
      rig.camera.add(speedLines.mesh);
      const hud = new HUD(uiRoot, rect, this.world.track, { compact: this.split, units: config.units });
      this.players.push({ player: rc.player, rc, rig, hud, speedLines, rect });
      this.wrongWayShown.push(false);
    });
  }

  get track() {
    return this.world.track;
  }

  get cars() {
    return this.sim.cars;
  }

  get phase() {
    return this.sim.phase;
  }

  private viewFor(rc: RaceCar | null): PlayerView[] {
    if (!rc) return this.players;
    return this.players.filter((p) => p.rc === rc);
  }

  // --- SimUI -------------------------------------------------------------------------------
  countdown(text: string, go: boolean) {
    for (const pv of this.players) pv.hud.showCountdown(text, go);
  }
  message(rc: RaceCar | null, text: string, seconds = 1.8, cls = '') {
    for (const pv of this.viewFor(rc)) pv.hud.message(text, seconds, cls);
  }
  popup(rc: RaceCar | null, text: string, cls = '') {
    for (const pv of this.viewFor(rc)) pv.hud.popup(text, cls);
  }
  sound(name: SoundEvent, intensity = 1, rc?: RaceCar | null) {
    this.audio?.event(name, intensity, rc ? rc.player : -1);
  }
  shake(rc: RaceCar, amount: number) {
    for (const pv of this.viewFor(rc)) pv.rig.addShake(amount);
  }
  rumble(rc: RaceCar, strong: number, weak: number, ms: number) {
    if (rc.isHuman) this.input.rumble(rc.player, this.split, strong, weak, ms);
  }
  resetView(rc: RaceCar) {
    for (const pv of this.viewFor(rc)) pv.rig.snap();
  }

  /** Fixed-timestep simulation. */
  step(dt: number) {
    this.sim.step(dt, (rc) => this.input.readDrive(rc.player, this.split, dt, rc.car.input));
  }

  /** Per-frame visual update: interpolation, cameras, effects and HUD. */
  render(alpha: number, dt: number): View[] {
    const sim = this.sim;
    const views: View[] = [];
    for (const rc of sim.cars) {
      rc.car.sync(alpha, dt, this.world.time);
      if (rc.eliminated) {
        // Knocked-out cars pop a confetti puff and fade away (no crashes, ever).
        if (rc.car.visible) {
          if (!rc.data.outFx) {
            rc.data.outFx = 1;
            this.confetti(rc.car.physics.x, rc.car.physics.y + 1, rc.car.physics.z);
          }
          rc.car.opacity = Math.max(0, rc.car.opacity - dt * 0.9);
          rc.car.visual.setOpacity(rc.car.opacity);
          if (rc.car.opacity <= 0) rc.car.visible = false;
        }
        continue;
      }
      if (rc.ghostTime > 0) rc.car.visual.setOpacity(0.5 + 0.3 * Math.sin(sim.elapsed * 30));
      else if (rc.car.opacity >= 1 && rc.car.visual.paint.opacity < 1) rc.car.visual.setOpacity(1);
    }
    this.onRender?.(alpha, dt);
    this.world.scene.updateMatrixWorld();
    if (dt > 0) for (const rc of sim.cars) rc.car.emitEffects(this.world.effects, dt);
    const focus = this.players[0]?.rc.car.object.position ?? _v.set(0, 0, 0);
    this.world.update(dt, focus);

    this.players.forEach((pv, idx) => {
      const rc = pv.rc;
      const p = rc.car.physics;
      if (this.input.actionPressed('camera', pv.player, this.split)) pv.rig.cycle();
      pv.rig.lookBack = this.input.actionDown('lookback', pv.player, this.split);
      if (this.input.actionPressed('reset', pv.player, this.split) && sim.phase === 'racing' && !rc.finished && !rc.eliminated) sim.resetCar(rc);
      if (this.input.actionPressed('pause', pv.player, this.split)) this.onPause?.();
      pv.rig.update(rc.car, alpha, dt);
      pv.speedLines.update(dt, clamp(p.speed / p.p.topSpeed, 0, 1.3), p.boosting);
      views.push({ camera: pv.rig.camera, x: pv.rect.x, y: 1 - pv.rect.y - pv.rect.h, w: pv.rect.w, h: pv.rect.h });

      const hud = pv.hud;
      hud.update(dt);
      hud.setSpeed(p.speed * Math.sign(p.vLong || 1), p.p.topSpeed, p.gear, p.boost, p.boosting);
      const total = this.rules.laps;
      hud.setLap(rc.finished ? total : Math.max(1, rc.lapsDone + 1), total, this.rules.lapLabel ?? 'LAP');
      if (this.rules.showPosition) hud.setPosition(rc.position, sim.activeCars.length);
      else hud.setPosition(0, 0);
      const raceT = sim.phase === 'countdown' ? 0 : rc.finished || rc.eliminated ? rc.finishTime : sim.time;
      const lapT = rc.finished ? rc.lapTimes[rc.lapTimes.length - 1] ?? 0 : sim.phase === 'countdown' ? 0 : sim.time - rc.lapStart;
      hud.setTimes(raceT, lapT, rc.bestLap);
      const wrong = rc.wrongWay > 1.0 && !rc.finished && !rc.eliminated;
      if (wrong) hud.message('WRONG WAY!', 0.3, 'warn');
      this.wrongWayShown[idx] = wrong;
    });

    const dots: MinimapDot[] = sim.cars.map((rc) => ({
      x: rc.car.physics.x,
      z: rc.car.physics.z,
      color: rc.car.color,
      me: false,
      heading: rc.car.physics.heading,
      hidden: rc.eliminated,
    }));
    const ranking = sim.ranking();
    for (const pv of this.players) {
      for (let i = 0; i < dots.length; i++) dots[i].me = sim.cars[i] === pv.rc;
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
    const bloom = this.world.sky.preset.bloom;
    if (!pv) return { blur: 0, aberration: 0, bloom };
    const p = pv.rc.car.physics;
    const sf = clamp(p.speed / p.p.topSpeed, 0, 1.3);
    const blur = clamp((sf - 0.45) * 1.4, 0, 1) * 0.7 + (p.boosting ? 0.5 : 0);
    return { blur, aberration: p.boosting ? 0.8 : 0, bloom: bloom + (p.boosting ? 0.15 : 0) };
  }

  /** Colourful celebration burst. */
  confetti(x: number, y: number, z: number, count = 60) {
    const cols = [
      [1, 0.31, 0.64],
      [1, 0.82, 0.25],
      [0.24, 0.88, 1],
      [0.64, 0.9, 0.21],
      [0.7, 0.3, 1],
    ];
    for (let i = 0; i < count; i++) {
      const c = cols[i % cols.length];
      this.world.effects.sparks.emit({ x, y, z, vx: (Math.random() - 0.5) * 10, vy: 4 + Math.random() * 6, vz: (Math.random() - 0.5) * 10, life: 1.6, size: 0.35, endSize: 0.25, r: c[0] * 1.5, g: c[1] * 1.5, b: c[2] * 1.5, gravity: 6, drag: 1.2 });
    }
  }

  setCameraMode(mode: CameraMode) {
    for (const pv of this.players) pv.rig.mode = mode;
  }

  setUnits(u: 'kmh' | 'mph') {
    for (const pv of this.players) pv.hud.setUnits(u);
  }

  dispose(keepWorld = false) {
    this.audio?.detach();
    for (const pv of this.players) {
      pv.hud.destroy();
      pv.speedLines.dispose();
      this.world.scene.remove(pv.rig.camera);
    }
    for (const rc of this.sim.cars) this.world.scene.remove(rc.car.object);
    this.sim.dispose();
    if (!keepWorld) this.world.dispose();
  }
}
