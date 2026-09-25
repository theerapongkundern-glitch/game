import * as THREE from 'three';
import type { Game, ModeController } from '../core/Game';
import type { RaceConfig, RaceSession } from './RaceSession';
import type { ModeRules } from './ModeRules';
import type { RaceSim } from './RaceSim';
import { getTrack } from '../tracks';
import { ResultsScreen } from '../ui/screens/ResultsScreen';
import { makeFrame } from '../tracks/Track';
import { formatTime } from '../core/math';

export const RUSH_GATES_PER_LAP = 8;
export const RUSH_LAPS = 3;

export interface RushState {
  timeLeft: number;
  nextGate: number;
  gatesPassed: number;
  timedOut: boolean;
}

/**
 * Checkpoint Rush rules: the clock counts down; every gate (8 per lap) adds seconds.
 * Finish 3 laps before the timer hits zero.
 */
export function rushRules(start: number, perGate: number, state: RushState, onGate?: (sim: RaceSim, bonus: number) => void): ModeRules {
  return {
    id: 'rush',
    laps: RUSH_LAPS,
    showPosition: false,
    onStart: () => {
      state.timeLeft = start;
      state.nextGate = 1;
      state.gatesPassed = 0;
      state.timedOut = false;
    },
    update: (sim, dt) => {
      const rc = sim.humanCars[0] ?? sim.cars[0];
      if (!rc || state.timedOut) return;
      if (!rc.finished) state.timeLeft -= dt;
      const L = sim.track.length;
      const spacing = L / RUSH_GATES_PER_LAP;
      while (rc.progress >= state.nextGate * spacing && state.nextGate <= RUSH_GATES_PER_LAP * RUSH_LAPS) {
        state.nextGate++;
        state.gatesPassed++;
        // No bonus for the finish line itself.
        if (state.nextGate <= RUSH_GATES_PER_LAP * RUSH_LAPS) {
          state.timeLeft += perGate;
          onGate?.(sim, perGate);
        }
      }
      if (state.timeLeft <= 0 && !rc.finished) {
        state.timeLeft = 0;
        state.timedOut = true;
        rc.car.physics.enabled = false;
      }
    },
    isOver: (sim) => state.timedOut || sim.cars.every((c) => c.finished),
  };
}

export class CheckpointRush implements ModeController {
  readonly id = 'rush' as const;
  private state: RushState = { timeLeft: 0, nextGate: 1, gatesPassed: 0, timedOut: false };
  private gates: THREE.Group | null = null;
  private gateMats: THREE.MeshBasicMaterial[] = [];

  constructor(
    private readonly game: Game,
    readonly opts: { trackId: string; carId: string; color: string },
  ) {}

  config(): RaceConfig {
    const s = this.game.save.data.settings;
    const track = getTrack(this.opts.trackId);
    const rush = track.rush ?? { start: 28, perGate: 7 };
    const rules = rushRules(rush.start, rush.perGate, this.state, (sim, bonus) => {
      sim.ui.popup(null, `+${bonus.toFixed(1)}s`, 'cyan');
      sim.ui.sound('gate');
    });
    rules.hud = (session, dt) => this.hud(session, dt);
    return {
      track,
      participants: [{ kind: 'human', player: 0, carId: this.opts.carId, color: this.opts.color, name: 'You' }],
      rules,
      difficulty: 'normal',
      split: false,
      countdown: true,
      units: s.units,
      cameraMode: s.camera,
    };
  }

  begin() {
    this.game.startRace(this.config(), this);
  }

  restart() {
    this.begin();
  }

  /** Builds rainbow gate arches around the track. */
  onSessionStart(session: RaceSession) {
    const track = session.track;
    const main = track.main;
    const g = new THREE.Group();
    const f = makeFrame();
    this.gateMats = [];
    const colors = ['#ff4fa3', '#ff8a3d', '#ffd23f', '#a4e635', '#3de0ff', '#7b5cff', '#b44dff', '#ff5a36'];
    for (let k = 0; k < RUSH_GATES_PER_LAP; k++) {
      const s = ((k + 1) * track.length) / RUSH_GATES_PER_LAP;
      main.frameAt(s % track.length, f);
      const w = Math.max(main.limitL[f.index], main.limitR[f.index]) + 0.5;
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(colors[k]).multiplyScalar(1.8), transparent: true, opacity: 0.9 });
      this.gateMats.push(mat);
      const arch = new THREE.Mesh(new THREE.TorusGeometry(w, 0.45, 8, 32, Math.PI), mat);
      arch.position.set(f.x, f.y, f.z);
      arch.rotation.y = f.heading + Math.PI / 2;
      g.add(arch);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(colors[k]), transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
      flag.position.set(f.x, f.y + w - 0.9, f.z);
      flag.rotation.y = f.heading;
      g.add(flag);
    }
    session.world.scene.add(g);
    this.gates = g;
  }

  private hud(session: RaceSession, _dt: number) {
    const pv = session.players[0];
    if (!pv) return;
    pv.hud.setRushTimer(this.state.timeLeft);
    // Highlight the next gate.
    const next = (this.state.nextGate - 1) % RUSH_GATES_PER_LAP;
    const t = performance.now() / 1000;
    this.gateMats.forEach((m, i) => {
      m.opacity = i === next ? 0.95 : 0.35;
      const s = i === next ? 1 + Math.sin(t * 6) * 0.08 : 1;
      this.gates?.children[i * 2]?.scale.setScalar(s);
    });
  }

  onRaceOver(session: RaceSession) {
    const rc = session.sim.humanCars[0];
    const success = !!rc?.finished && !this.state.timedOut;
    const save = this.game.save;
    let newBest = false;
    if (success && rc) {
      const rec = save.record(this.opts.trackId);
      if (rec.rushBest === 0 || rc.finishTime < rec.rushBest) {
        rec.rushBest = rc.finishTime;
        newBest = true;
      }
      save.save();
    }
    this.gates = null;
    this.game.showScreen(
      new ResultsScreen(this.game, session, {
        title: success ? 'Rush complete!' : "Time's up!",
        newRecord: newBest,
        note: `Gates passed: ${this.state.gatesPassed}/${RUSH_GATES_PER_LAP * RUSH_LAPS}${success && rc ? ` · Finish time ${formatTime(rc.finishTime)} with ${this.state.timeLeft.toFixed(1)}s to spare` : ''}`,
        onRestart: () => this.restart(),
        onContinue: () => this.game.toMenu(),
        continueLabel: 'Main Menu',
      }),
    );
  }
}
