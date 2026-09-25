import type { Game, ModeController } from '../core/Game';
import type { RaceConfig, RaceSession } from './RaceSession';
import type { Difficulty, ModeRules } from './ModeRules';
import { buildOpponents } from './opponents';
import { getTrack } from '../tracks';
import { ResultsScreen } from '../ui/screens/ResultsScreen';

export interface QuickRaceOptions {
  trackId: string;
  carId: string;
  color: string;
  difficulty: Difficulty;
  laps: number;
}

/** Quick Race: pick car, track and difficulty; 3 laps against 5 AI rivals. */
export class QuickRace implements ModeController {
  readonly id = 'quick' as const;
  private seed = Date.now();

  constructor(
    private readonly game: Game,
    readonly opts: QuickRaceOptions,
  ) {}

  rules(): ModeRules {
    return { id: 'quick', laps: this.opts.laps, showPosition: true };
  }

  config(): RaceConfig {
    const s = this.game.save.data.settings;
    return {
      track: getTrack(this.opts.trackId),
      participants: [{ kind: 'human', player: 0, carId: this.opts.carId, color: this.opts.color, name: 'You' }, ...buildOpponents(5, [this.opts.color], this.seed)],
      rules: this.rules(),
      difficulty: this.opts.difficulty,
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

  onRaceOver(session: RaceSession) {
    const me = session.sim.humanCars[0];
    const save = this.game.save;
    const rec = save.record(this.opts.trackId);
    let newBest = false;
    if (me && me.finished) {
      if (rec.bestRace === 0 || me.finishTime < rec.bestRace) {
        rec.bestRace = me.finishTime;
        newBest = true;
      }
      if (isFinite(me.bestLap) && (rec.bestLap === 0 || me.bestLap < rec.bestLap)) rec.bestLap = me.bestLap;
    }
    save.data.stats.races++;
    if (me && me.place === 1) save.data.stats.wins++;
    save.save();
    this.game.showScreen(
      new ResultsScreen(this.game, session, {
        title: me && me.place === 1 ? 'Victory!' : 'Race Results',
        newRecord: newBest,
        onRestart: () => this.restart(),
        onContinue: () => this.game.toMenu(),
        continueLabel: 'Main Menu',
      }),
    );
  }
}
