import type { Game, ModeController } from '../core/Game';
import type { RaceConfig, RaceSession } from './RaceSession';
import type { ModeRules } from './ModeRules';
import type { RaceCar, RaceSim } from './RaceSim';
import { getTrack } from '../tracks';
import { GhostPlayer, GhostRecorder, decodeGhost, encodeGhost, type GhostData } from '../vehicles/Ghost';
import { ResultsScreen } from '../ui/screens/ResultsScreen';
import { formatTime } from '../core/math';

export interface TimeTrialOptions {
  trackId: string;
  carId: string;
  color: string;
}

/**
 * Time Trial: solo laps against the ghost of your best lap. The best lap (and its ghost)
 * is saved per track in localStorage.
 */
export class TimeTrial implements ModeController {
  readonly id = 'timetrial' as const;
  private recorder = new GhostRecorder();
  private best: GhostData | null = null;
  private ghost: GhostPlayer | null = null;
  private session: RaceSession | null = null;
  private lastDelta = 0;
  private deltaTimer = 0;
  static readonly LAPS = 5;
  /** Test hook: shorter sessions in automated runs. */
  static LAPS_OVERRIDE = 0;

  constructor(
    private readonly game: Game,
    readonly opts: TimeTrialOptions,
  ) {}

  private rules(): ModeRules {
    return {
      id: 'timetrial',
      laps: TimeTrial.LAPS_OVERRIDE || TimeTrial.LAPS,
      showPosition: false,
      update: (sim, dt) => this.update(sim, dt),
      onLap: (_sim, rc, lapTime) => this.onLap(rc, lapTime),
      hud: (session, dt) => this.hud(session, dt),
    };
  }

  config(): RaceConfig {
    const s = this.game.save.data.settings;
    return {
      track: getTrack(this.opts.trackId),
      participants: [{ kind: 'human', player: 0, carId: this.opts.carId, color: this.opts.color, name: 'You' }],
      rules: this.rules(),
      difficulty: 'normal',
      split: false,
      countdown: true,
      units: s.units,
      cameraMode: s.camera,
    };
  }

  begin() {
    this.recorder.reset();
    const rec = this.game.save.data.records[this.opts.trackId];
    this.best = decodeGhost(rec?.ghost);
    this.game.startRace(this.config(), this);
  }

  restart() {
    this.begin();
  }

  onSessionStart(session: RaceSession) {
    this.session = session;
    this.ghost?.dispose();
    this.ghost = null;
    if (this.best) this.attachGhost(this.best);
  }

  private attachGhost(data: GhostData) {
    if (!this.session) return;
    if (this.ghost) {
      this.session.world.scene.remove(this.ghost.object);
      this.ghost.dispose();
    }
    this.ghost = new GhostPlayer(data, this.game.renderer.quality);
    this.session.world.scene.add(this.ghost.object);
  }

  private lapDistance(sim: RaceSim, rc: RaceCar) {
    return rc.progress - rc.lapsDone * sim.track.length;
  }

  private update(sim: RaceSim, dt: number) {
    const rc = sim.humanCars[0];
    if (!rc || sim.phase !== 'racing' || rc.finished) return;
    const p = rc.car.physics;
    this.recorder.step(dt, p.x, p.y, p.z, p.heading, this.lapDistance(sim, rc));
  }

  private onLap(rc: RaceCar, lapTime: number) {
    const data = this.recorder.finish(rc.car.def.id, rc.car.color, lapTime);
    this.recorder.reset();
    const save = this.game.save;
    const rec = save.record(this.opts.trackId);
    if (rec.bestLap === 0 || lapTime < rec.bestLap) {
      const improved = rec.bestLap > 0;
      rec.bestLap = lapTime;
      rec.ghost = encodeGhost(data);
      rec.ghostCar = data.car;
      save.save();
      this.best = data;
      this.attachGhost(data);
      this.session?.popup(rc, improved ? `NEW BEST ${formatTime(lapTime)}!` : `LAP ${formatTime(lapTime)}`, 'cyan');
      this.session?.sound('perfect', 1, rc);
    } else {
      this.session?.popup(rc, `LAP ${formatTime(lapTime)} (+${(lapTime - rec.bestLap).toFixed(2)})`, '');
    }
  }

  private hud(session: RaceSession, dt: number) {
    const sim = session.sim;
    const rc = sim.humanCars[0];
    const pv = session.players[0];
    if (!rc || !pv) return;
    const lapT = sim.phase === 'countdown' ? 0 : sim.time - rc.lapStart;
    if (this.ghost) {
      this.ghost.update(sim.phase === 'countdown' ? 0 : lapT);
      // Live delta against the ghost at the same point of the lap.
      this.deltaTimer -= dt;
      if (this.deltaTimer <= 0 && sim.phase === 'racing' && !rc.finished) {
        this.deltaTimer = 0.25;
        const d = this.lapDistance(sim, rc);
        if (d > 30) this.lastDelta = lapT - this.ghost.timeAt(d);
        pv.hud.setDelta(d > 30 ? this.lastDelta : null);
      }
    } else pv.hud.setDelta(null);
  }

  onRaceOver(session: RaceSession) {
    this.ghost?.dispose();
    const rc = session.sim.humanCars[0];
    const best = this.game.save.data.records[this.opts.trackId]?.bestLap ?? 0;
    const laps = rc ? rc.lapTimes.map((t, i) => `Lap ${i + 1}: ${formatTime(t)}${t === best ? ' ★' : ''}`).join('   ') : '';
    this.game.showScreen(
      new ResultsScreen(this.game, session, {
        title: 'Time Trial',
        newRecord: !!rc && rc.bestLap === best,
        note: `${laps}\nTrack record: ${best ? formatTime(best) : '--'}`,
        onRestart: () => this.restart(),
        onContinue: () => this.game.toMenu(),
        continueLabel: 'Main Menu',
      }),
    );
  }
}
