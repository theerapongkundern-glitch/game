import { Renderer, type Quality } from './Renderer';
import { Input } from './Input';
import { Loop } from './Loop';
import { RaceSession, type RaceConfig } from '../modes/RaceSession';
import { testTrack } from '../tracks/defs/testTrack';
import { CAR_DEFS } from '../vehicles/CarDefs';
import { el } from '../ui/dom';
import { SURFACES } from '../tracks/Surfaces';

/** Top-level app: owns renderer, input and the main loop; runs the current session. */
export class Game {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly loop: Loop;
  session: RaceSession | null = null;
  paused = false;
  private debugEl: HTMLDivElement | null = null;
  private fpsEl: HTMLDivElement;
  private carIndex = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly ui: HTMLElement,
  ) {
    const params = new URLSearchParams(location.search);
    const quality = (params.get('quality') as Quality) || 'high';
    this.renderer = new Renderer(canvas, quality);
    this.input = new Input();
    this.loop = new Loop(
      (dt) => this.fixedUpdate(dt),
      (alpha, dt) => this.frame(alpha, dt),
    );
    // Test hook: ?fast=N runs the simulation N times faster (used by the smoke tests).
    const fast = Number(params.get('fast') || 1);
    if (fast > 1) this.loop.timeScale = fast;
    this.fpsEl = el('div', { class: 'fps-counter' });
    ui.append(this.fpsEl);
    if (params.has('debug')) this.toggleDebug();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggleDebug();
      }
      if (/^Digit[1-6]$/.test(e.code) && this.session) {
        this.carIndex = Number(e.code.slice(5)) - 1;
        this.startFreeDrive();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.paused = true;
      else this.paused = false;
    });
  }

  start() {
    this.startFreeDrive();
    this.loop.start();
  }

  startFreeDrive() {
    const cam = this.session?.players[0]?.rig.mode ?? 'chase';
    this.session?.dispose();
    const def = CAR_DEFS[this.carIndex % CAR_DEFS.length];
    const config: RaceConfig = {
      track: testTrack,
      participants: [{ kind: 'human', player: 0, carId: def.id, color: def.defaultColor, name: 'You' }],
      rules: { id: 'free', laps: 0, showPosition: false },
      difficulty: 'normal',
      split: false,
      countdown: true,
      units: 'kmh',
      cameraMode: cam,
    };
    this.input.menuMode = false;
    this.session = new RaceSession(this.renderer, this.input, config, this.ui);
    this.session.onPause = () => (this.paused = !this.paused);
  }

  private toggleDebug() {
    if (this.debugEl) {
      this.debugEl.remove();
      this.debugEl = null;
    } else {
      this.debugEl = el('div', { class: 'debug-overlay' });
      this.ui.append(this.debugEl);
    }
  }

  private fixedUpdate(dt: number) {
    if (this.paused || !this.session) return;
    this.session.step(dt);
  }

  private frame(alpha: number, dt: number) {
    this.input.poll(dt);
    const s = this.session;
    if (s) {
      const views = s.render(alpha, this.paused ? 0 : dt);
      this.renderer.render(s.world.scene, views, dt, s.frameFX());
      if (this.debugEl) {
        const p = s.players[0]?.rc.car.physics;
        const q = s.players[0]?.rc.car.ground.q;
        const info = this.renderer.info();
        if (p && q) {
          this.debugEl.textContent =
            `car ${p.p.topSpeed.toFixed(0)}m/s  speed ${(p.speed * 3.6).toFixed(0)} km/h  vLong ${p.vLong.toFixed(1)} vLat ${p.vLat.toFixed(1)}\n` +
            `slip β ${(p.driftAngle * 57.3).toFixed(0)}°  drift ${p.drifting ? 'YES ' + (p.driftMag * 57.3).toFixed(0) + '°' : 'no'}  yaw ${p.yawRate.toFixed(2)}  steer ${(p.steerAngle * 57.3).toFixed(1)}°\n` +
            `surface ${SURFACES[p.surface].label}  onRoad ${q.onRoad}  path ${q.path}  lat ${q.lateral.toFixed(1)}  pen ${q.penetration.toFixed(2)}  air ${!p.grounded}\n` +
            `boost ${(p.boost * 100).toFixed(0)}%  draft ${p.draft.toFixed(2)}  rpm ${p.rpm.toFixed(2)} gear ${p.gear}  progress ${s.players[0].rc.progress.toFixed(0)}\n` +
            `draw calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k  frame ${this.loop.frameTime.toFixed(1)}ms  res ${this.renderer.dynScale.toFixed(1)}`;
        }
      }
    }
    this.fpsEl.textContent = `${Math.round(this.loop.fps)} FPS`;
    this.renderer.trackFrame(this.loop.frameTime);
    this.input.endFrame();
  }
}
