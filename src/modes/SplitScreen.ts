import type { Game, ModeController } from '../core/Game';
import type { RaceConfig, RaceSession } from './RaceSession';
import type { Difficulty } from './ModeRules';
import { buildOpponents } from './opponents';
import { getTrack } from '../tracks';
import { ResultsScreen } from '../ui/screens/ResultsScreen';

/** Local 2-player split screen (top/bottom), optionally with AI rivals. */
export class SplitScreen implements ModeController {
  readonly id = 'split' as const;
  private seed = Date.now();

  constructor(
    private readonly game: Game,
    readonly opts: { trackId: string; cars: { carId: string; color: string }[]; difficulty: Difficulty; laps: number; ai: number },
  ) {}

  config(): RaceConfig {
    const s = this.game.save.data.settings;
    const [p1, p2] = this.opts.cars;
    return {
      track: getTrack(this.opts.trackId),
      participants: [
        { kind: 'human', player: 0, carId: p1.carId, color: p1.color, name: 'Player 1' },
        { kind: 'human', player: 1, carId: p2.carId, color: p2.color === p1.color ? '#3de0ff' : p2.color, name: 'Player 2' },
        ...buildOpponents(this.opts.ai, [p1.color, p2.color], this.seed),
      ],
      rules: { id: 'split', laps: this.opts.laps, showPosition: true },
      difficulty: this.opts.difficulty,
      split: true,
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
    const humans = session.sim.humanCars.sort((a, b) => a.place - b.place);
    const winner = humans[0];
    this.game.showScreen(
      new ResultsScreen(this.game, session, {
        title: winner ? `${winner.participant.name} wins!` : 'Results',
        onRestart: () => this.restart(),
        onContinue: () => this.game.toMenu(),
        continueLabel: 'Main Menu',
      }),
    );
  }
}
