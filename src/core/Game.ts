import { Renderer } from './Renderer';
import { Input, type MenuNav } from './Input';
import { Loop } from './Loop';
import { SaveManager } from './Save';
import { RaceSession, type RaceConfig } from '../modes/RaceSession';
import { makeAIBrainFactory } from '../ai/AIDriver';
import { audio } from '../audio/AudioEngine';
import { RaceAudio } from '../audio/RaceAudio';
import { playEvent } from '../audio/SFX';
import { el } from '../ui/dom';
import type { Screen } from '../ui/screens/Screen';
import { SURFACES } from '../tracks/Surfaces';
import type { ModeId } from '../modes/ModeRules';
import { QuickRace } from '../modes/QuickRace';
import { TRACKS } from '../tracks';
import { CAR_DEFS } from '../vehicles/CarDefs';

/** A game mode drives one or more races and decides what happens after each. */
export interface ModeController {
  readonly id: ModeId;
  begin(): void;
  restart(): void;
  onRaceOver(session: RaceSession): void;
}

const TIPS = [
  'Hold the handbrake while turning to drift — drifting fills your boost bar!',
  'Tuck in behind a rival to catch their slipstream and charge your boost.',
  'Press throttle just before GO for a perfect start.',
  'Sand and grass slow you down; wet roads are slippery.',
  'Shortcuts can save time — if you can handle the surface.',
  'Press C to switch between chase, close and bumper cameras.',
  'Press R if you get stuck to hop back onto the track.',
];

/** Top-level app: owns renderer, input, audio, save data and the main loop. */
export class Game {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly loop: Loop;
  readonly save: SaveManager;
  session: RaceSession | null = null;
  mode: ModeController | null = null;
  screen: Screen | null = null;
  paused = false;
  readonly params: URLSearchParams;
  autotest: string | null;
  private debugEl: HTMLDivElement | null = null;
  private readonly fpsEl: HTMLDivElement;
  private overTimer: number | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly ui: HTMLElement,
  ) {
    this.params = new URLSearchParams(location.search);
    this.autotest = this.params.get('autotest');
    this.save = new SaveManager();
    const s = this.save.data.settings;
    const q = this.params.get('quality');
    const quality = q === 'low' || q === 'medium' || q === 'high' ? q : s.quality;
    this.renderer = new Renderer(canvas, quality);
    this.renderer.autoResolution = s.autoResolution && !this.autotest;
    this.input = new Input();
    this.input.bindings = s.bindings;
    audio.init();
    audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    this.loop = new Loop(
      (dt) => this.fixedUpdate(dt),
      (alpha, dt) => this.frame(alpha, dt),
    );
    const fast = Number(this.params.get('fast') || 1);
    if (fast > 1) this.loop.timeScale = fast;
    this.fpsEl = el('div', { class: 'fps-counter' + (s.showFps ? '' : ' hidden') });
    ui.append(this.fpsEl);
    if (this.params.has('debug')) this.toggleDebug();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggleDebug();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.session && !this.paused && !this.autotest) this.pause();
    });
    this.input.onNav((nav) => this.onNav(nav));
    window.addEventListener('beforeunload', () => this.save.flush());
  }

  start() {
    this.loop.start();
    if (this.autotest) this.runAutotest();
    else this.toMenu();
  }

  // --- Screens ---------------------------------------------------------------------------
  showScreen(screen: Screen | null) {
    this.screen?.unmount();
    this.screen = screen;
    if (screen) {
      screen.mount(this.ui);
      this.input.menuMode = true;
    }
  }

  private onNav(nav: MenuNav) {
    if (!this.input.menuMode || !this.screen) return;
    this.screen.handleNav(nav);
  }

  toast(text: string) {
    const t = el('div', { class: 'toast', text });
    this.ui.append(t);
    setTimeout(() => t.remove(), 3300);
  }

  sfx(name: Parameters<typeof playEvent>[1]) {
    playEvent(audio, name);
  }

  private showLoading(label: string): HTMLDivElement {
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    const l = el('div', { class: 'loading' }, [el('div', {}, [el('div', { class: 'spinner' }), el('div', { class: 'label', text: label }), el('div', { class: 'tip', text: tip })])]);
    this.ui.append(l);
    return l;
  }

  /** Returns to the main menu (implemented fully in the menu milestone). */
  toMenu() {
    this.endSession();
    this.mode = null;
    import('../ui/screens/MainMenu').then(({ MainMenu }) => this.showScreen(new MainMenu(this)));
  }

  // --- Races -------------------------------------------------------------------------------
  startRace(config: RaceConfig, mode: ModeController) {
    this.mode = mode;
    this.showScreen(null);
    const loading = this.showLoading(config.track.name);
    // Let the loading screen paint before the (synchronous) world build.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.endSession();
        try {
          const session = new RaceSession(this.renderer, this.input, config, this.ui);
          const factory = makeAIBrainFactory(config.difficulty);
          session.sim.makeBrain = factory;
          session.audio = new RaceAudio(audio);
          session.onPause = () => this.pause();
          session.sim.onOver = () => {
            this.overTimer = window.setTimeout(() => {
              this.overTimer = null;
              if (this.session === session) mode.onRaceOver(session);
            }, this.autotest ? 200 : 2600);
          };
          if (this.autotest) for (const rc of session.sim.humanCars) rc.brain = factory(rc, session.sim, false);
          this.session = session;
          this.paused = false;
          this.input.menuMode = false;
          this.renderer.dynScale = 1;
        } catch (err) {
          console.error(err);
          this.toast('Something went wrong loading the track.');
        }
        loading.style.opacity = '0';
        setTimeout(() => loading.remove(), 300);
      }),
    );
  }

  endSession() {
    if (this.overTimer !== null) {
      clearTimeout(this.overTimer);
      this.overTimer = null;
    }
    this.session?.dispose();
    this.session = null;
    this.paused = false;
  }

  pause() {
    if (!this.session || this.paused) return;
    this.paused = true;
    import('../ui/screens/PauseScreen').then(({ PauseScreen }) => this.showScreen(new PauseScreen(this)));
  }

  resume() {
    this.paused = false;
    this.showScreen(null);
    this.input.menuMode = false;
  }

  restartRace() {
    this.mode?.restart();
  }

  // --- Autotest (used by scripts/smoke.mjs) -------------------------------------------------
  private runAutotest() {
    const p = this.params;
    const w = window as unknown as { __autotest?: unknown };
    w.__autotest = { done: false };
    const trackId = p.get('track') ?? TRACKS[0].id;
    const carId = p.get('car') ?? CAR_DEFS[0].id;
    const difficulty = (p.get('difficulty') as 'easy' | 'normal' | 'hard') ?? 'normal';
    const laps = Number(p.get('laps') ?? 1);
    const mode = new QuickRace(this, { trackId, carId, color: '#ff4fa3', difficulty, laps });
    const orig = mode.onRaceOver.bind(mode);
    mode.onRaceOver = (session) => {
      w.__autotest = {
        done: true,
        results: session.sim.ranking().map((rc) => ({ name: rc.participant.name, car: rc.car.def.id, place: rc.place, time: rc.finishTime, finished: rc.finished })),
      };
      orig(session);
    };
    mode.begin();
  }

  // --- Loop ------------------------------------------------------------------------------------
  private toggleDebug() {
    if (this.debugEl) {
      this.debugEl.remove();
      this.debugEl = null;
    } else {
      this.debugEl = el('div', { class: 'debug-overlay' });
      this.ui.append(this.debugEl);
    }
  }

  /** Re-evaluates whether on-screen touch controls should show (set up in the menu milestone). */
  refreshTouch: (() => void) | null = null;

  setShowFps(on: boolean) {
    this.fpsEl.classList.toggle('hidden', !on);
  }

  private fixedUpdate(dt: number) {
    if (this.paused || !this.session) return;
    this.session.step(dt);
  }

  /** Optional background renderer for menus (attract mode, garage). */
  background: { render(dt: number): void } | null = null;

  private frame(alpha: number, dt: number) {
    this.input.poll(dt);
    const s = this.session;
    if (s) {
      const views = s.render(alpha, this.paused ? 0 : dt);
      this.renderer.render(s.world.scene, views, dt, s.frameFX());
      if (this.debugEl) this.updateDebug(s);
    } else if (this.background) {
      this.background.render(dt);
    } else {
      this.renderer.gl.setClearColor('#1b1446');
      this.renderer.gl.clear();
    }
    this.screen?.update(dt);
    this.fpsEl.textContent = `${Math.round(this.loop.fps)} FPS`;
    if (s && !this.paused) this.renderer.trackFrame(this.loop.frameTime);
    this.input.endFrame();
  }

  private updateDebug(s: RaceSession) {
    if (!this.debugEl) return;
    const rc = s.players[0]?.rc;
    if (!rc) return;
    const p = rc.car.physics;
    const q = rc.car.ground.q;
    const info = this.renderer.info();
    this.debugEl.textContent =
      `speed ${(p.speed * 3.6).toFixed(0)} km/h  vLong ${p.vLong.toFixed(1)} vLat ${p.vLat.toFixed(1)}  slip ${(p.driftAngle * 57.3).toFixed(0)}°  drift ${p.drifting ? (p.driftMag * 57.3).toFixed(0) + '°' : '-'}\n` +
      `surface ${SURFACES[p.surface].label}  road ${q.onRoad}  path ${q.path}  lat ${q.lateral.toFixed(1)}  air ${!p.grounded}  boost ${(p.boost * 100).toFixed(0)}%  draft ${p.draft.toFixed(2)}\n` +
      `progress ${rc.progress.toFixed(0)}  pos ${rc.position}  lap ${rc.lapsDone}\n` +
      `draw calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k  cpu ${this.loop.frameTime.toFixed(1)}ms  res ${this.renderer.dynScale.toFixed(1)}`;
  }
}
