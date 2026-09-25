import { Renderer } from './Renderer';
import { Input, type MenuNav } from './Input';
import { Loop } from './Loop';
import { SaveManager } from './Save';
import { RaceSession, type RaceConfig } from '../modes/RaceSession';
import { makeAIBrainFactory } from '../ai/AIDriver';
import { audio } from '../audio/AudioEngine';
import { RaceAudio } from '../audio/RaceAudio';
import { playEvent } from '../audio/SFX';
import { Music } from '../audio/Music';
import { el } from '../ui/dom';
import type { Screen } from '../ui/screens/Screen';
import { SURFACES } from '../tracks/Surfaces';
import type { ModeId } from '../modes/ModeRules';
import { TRACKS, getTrack } from '../tracks';
import { MenuBackground } from '../ui/scenes/MenuBackground';
import { GarageScene } from '../ui/scenes/GarageScene';
import { TrackPreview } from '../ui/scenes/TrackPreview';
import type { GarageScreen } from '../ui/screens/GarageScreen';
import type { TrackSelectScreen } from '../ui/screens/TrackSelectScreen';
import type { PodiumScreen } from '../ui/screens/PodiumScreen';
import { PodiumScene } from '../ui/scenes/PodiumScene';
import { TouchControls, isTouchDevice } from '../ui/TouchControls';
import type { MusicThemeId } from '../tracks/types';

/** A game mode drives one or more races and decides what happens after each. */
export interface ModeController {
  readonly id: ModeId;
  begin(): void;
  restart(): void;
  onRaceOver(session: RaceSession): void;
  /** Optional: leaving the mode mid-way (quit from pause). */
  quit?(): void;
  /** Optional: called right after the race session is built (add ghosts, gates...). */
  onSessionStart?(session: RaceSession): void;
}

interface Background {
  render(dt: number): void;
  dispose(): void;
}

const TIPS = [
  'Hold the handbrake while turning to drift — drifting fills your boost bar!',
  'Tuck in behind a rival to catch their slipstream and charge your boost.',
  'Press throttle just before GO for a perfect start.',
  'Sand and grass slow you down; wet roads are slippery.',
  'Shortcuts can save time — if you can handle the surface.',
  'Press C to switch between chase, close and bumper cameras.',
  'Press R if you get stuck to hop back onto the track.',
  'Rainbow boost pads give a free burst of speed.',
];

/** Top-level app: owns renderer, input, audio, save data, menus and the main loop. */
export class Game {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly loop: Loop;
  readonly save: SaveManager;
  readonly music = new Music(audio);
  readonly touch: TouchControls;
  session: RaceSession | null = null;
  mode: ModeController | null = null;
  screen: Screen | null = null;
  paused = false;
  readonly params: URLSearchParams;
  autotest: string | null;
  private background: Background | null = null;
  private menuBg: MenuBackground | null = null;
  private debugEl: HTMLDivElement | null = null;
  private readonly fpsEl: HTMLDivElement;
  private overTimer: number | null = null;
  private previewTimer: number | null = null;

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
    if (this.params.has('mute')) audio.muted = true;
    this.loop = new Loop(
      (dt) => this.fixedUpdate(dt),
      (alpha, dt) => this.frame(alpha, dt),
    );
    const fast = Number(this.params.get('fast') || 1);
    if (fast > 1) this.loop.timeScale = fast;
    this.fpsEl = el('div', { class: 'fps-counter' + (s.showFps ? '' : ' hidden') });
    this.touch = new TouchControls(this.input, ui);
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
    // Start music as soon as audio is allowed.
    window.addEventListener('pointerdown', () => this.ensureMusic(), { passive: true });
    window.addEventListener('keydown', () => this.ensureMusic());
  }

  start() {
    this.loop.start();
    if (this.autotest) this.runAutotest();
    else this.toMenu();
  }

  // --- Music -------------------------------------------------------------------------------
  private wantedMusic: MusicThemeId = 'menu';
  private playMusic(id: MusicThemeId) {
    this.wantedMusic = id;
    if (audio.ctx) this.music.play(id);
  }
  private ensureMusic() {
    if (!this.music.playing && audio.ensure()) setTimeout(() => this.music.play(this.wantedMusic), 50);
  }

  // --- Screens & backgrounds --------------------------------------------------------------
  showScreen(screen: Screen | null) {
    this.screen?.unmount();
    this.screen = screen;
    if (screen) {
      screen.mount(this.ui);
      this.input.menuMode = true;
    }
    this.updateTouch();
  }

  private setBackground(bg: Background | null) {
    if (this.background && this.background !== bg && this.background !== this.menuBg) this.background.dispose();
    this.background = bg;
  }

  private disposeMenuBackground() {
    if (this.background === this.menuBg) this.background = null;
    this.menuBg?.dispose();
    this.menuBg = null;
  }

  /** Shows a screen over the attract-mode race. */
  showScreenWithBackground(screen: Screen) {
    this.ensureMenuBackground();
    this.setBackground(this.menuBg);
    this.showScreen(screen);
  }

  private ensureMenuBackground() {
    if (this.menuBg) return;
    const unlocked = TRACKS.filter((t) => this.save.isTrackUnlocked(t.id));
    const t = unlocked[Math.floor(Math.random() * unlocked.length)] ?? TRACKS[0];
    try {
      this.menuBg = new MenuBackground(this.renderer, t);
    } catch (err) {
      console.error(err);
      this.menuBg = null;
    }
  }

  showGarage(screen: GarageScreen) {
    let scene = this.background instanceof GarageScene ? this.background : null;
    if (!scene) {
      scene = new GarageScene(this.renderer);
      this.setBackground(scene);
    }
    screen.attachScene(scene);
    this.showScreen(screen);
  }

  showTrackSelect(screen: TrackSelectScreen) {
    const load = (id: string) => {
      if (this.previewTimer !== null) clearTimeout(this.previewTimer);
      this.previewTimer = window.setTimeout(() => {
        this.previewTimer = null;
        if (this.screen !== screen) return;
        try {
          this.setBackground(new TrackPreview(this.renderer, getTrack(id)));
        } catch (err) {
          console.error(err);
        }
      }, 220);
    };
    screen.onPreview = load;
    this.showScreen(screen);
    load(screen.trackId);
  }

  /** Grand Prix finale: 3D podium background + podium screen. */
  showPodium(screen: PodiumScreen) {
    this.endSession();
    this.disposeMenuBackground();
    try {
      this.setBackground(new PodiumScene(this.renderer, screen.order.slice(0, 3)));
    } catch (err) {
      console.error(err);
    }
    this.playMusic('podium');
    this.sfx('podium');
    this.showScreen(screen);
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

  showLoading(label: string): HTMLDivElement {
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    const l = el('div', { class: 'loading' }, [el('div', {}, [el('div', { class: 'spinner' }), el('div', { class: 'label', text: label }), el('div', { class: 'tip', text: tip })])]);
    this.ui.append(l);
    return l;
  }

  /** Returns to the main menu over the attract-mode race. */
  toMenu() {
    this.endSession();
    this.mode = null;
    this.playMusic('menu');
    this.music.setMuffled(false);
    const show = () => {
      import('../ui/screens/MainMenu').then(({ MainMenu }) => this.showScreenWithBackground(new MainMenu(this)));
    };
    if (!this.menuBg) {
      this.showScreen(null);
      this.setBackground(null);
      const loading = this.showLoading('Prism Rush');
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          this.ensureMenuBackground();
          show();
          loading.style.opacity = '0';
          setTimeout(() => loading.remove(), 300);
        }),
      );
    } else show();
  }

  // --- Races -------------------------------------------------------------------------------
  startRace(config: RaceConfig, mode: ModeController) {
    this.mode = mode;
    this.showScreen(null);
    const loading = this.showLoading(config.track.name);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.endSession();
        this.setBackground(null);
        this.disposeMenuBackground();
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
          mode.onSessionStart?.(session);
          this.paused = false;
          this.input.menuMode = false;
          this.renderer.dynScale = 1;
          this.playMusic(config.track.music);
          this.music.setMuffled(false);
          this.updateTouch();
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
    this.updateTouch();
  }

  pause() {
    if (!this.session || this.paused || this.session.sim.over) return;
    this.paused = true;
    this.music.setMuffled(true);
    import('../ui/screens/PauseScreen').then(({ PauseScreen }) => this.showScreen(new PauseScreen(this)));
  }

  resume() {
    this.paused = false;
    this.music.setMuffled(false);
    this.showScreen(null);
    this.input.menuMode = false;
  }

  restartRace() {
    this.mode?.restart();
  }

  quitRace() {
    if (this.mode?.quit) this.mode.quit();
    else this.toMenu();
  }

  // --- Touch -------------------------------------------------------------------------------
  refreshTouch = () => this.updateTouch();

  private updateTouch() {
    const pref = this.save.data.settings.touch;
    const want = pref === 'on' || (pref === 'auto' && isTouchDevice());
    const racing = !!this.session && !this.screen;
    if (want && racing) this.touch.show();
    else this.touch.hide();
  }

  // --- Autotest (used by scripts/smoke.mjs) -------------------------------------------------
  private runAutotest() {
    import('../modes/autotest').then(({ runAutotest }) => runAutotest(this));
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

  setShowFps(on: boolean) {
    this.fpsEl.classList.toggle('hidden', !on);
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
