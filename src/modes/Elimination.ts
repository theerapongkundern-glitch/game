import type { Game, ModeController } from '../core/Game';
import type { RaceConfig, RaceSession } from './RaceSession';
import type { Difficulty, ModeRules } from './ModeRules';
import type { RaceSim } from './RaceSim';
import { buildOpponents } from './opponents';
import { getTrack } from '../tracks';
import { ResultsScreen } from '../ui/screens/ResultsScreen';

/**
 * Elimination: every time the leader starts a new lap, whoever is last is out.
 * Last car standing wins. Eliminated cars politely fade away in a confetti puff.
 */
export function eliminationRules(onOut?: (sim: RaceSim, name: string, isHuman: boolean) => void): ModeRules {
  let leaderLaps = 0;
  return {
    id: 'elimination',
    laps: 0,
    showPosition: true,
    lapLabel: 'LAP',
    onStart: () => {
      leaderLaps = 0;
    },
    update: (sim) => {
      const active = sim.activeCars;
      if (active.length <= 1) return;
      const lead = Math.max(...active.map((c) => c.lapsDone));
      if (lead > leaderLaps) {
        leaderLaps = lead;
        const last = [...active].sort((a, b) => a.position - b.position)[active.length - 1];
        sim.eliminate(last);
        onOut?.(sim, last.participant.name, last.isHuman);
        if (active.length - 1 === 1) {
          const winner = sim.activeCars[0];
          sim.finishCar(winner);
        }
      }
    },
    isOver: (sim) => sim.activeCars.length <= 1 || (sim.humanCars.length > 0 && sim.humanCars.every((h) => h.eliminated)),
  };
}

export class Elimination implements ModeController {
  readonly id = 'elimination' as const;
  private seed = Date.now();

  constructor(
    private readonly game: Game,
    readonly opts: { trackId: string; carId: string; color: string; difficulty: Difficulty },
  ) {}

  config(): RaceConfig {
    const s = this.game.save.data.settings;
    const rules = eliminationRules((sim, name, isHuman) => {
      const ui = sim.ui;
      if (isHuman) {
        ui.message(null, 'YOU ARE OUT!', 3, 'warn');
      } else {
        ui.message(null, `${name} is OUT!`, 2.2);
      }
      ui.sound('eliminated');
    });
    // The lap counter shows how many eliminations remain.
    rules.hud = (session) => {
      const active = session.sim.activeCars.length;
      for (const pv of session.players) pv.hud.setLap(Math.max(1, pv.rc.lapsDone + 1), Math.max(1, pv.rc.lapsDone + active - 1), 'LAP');
    };
    return {
      track: getTrack(this.opts.trackId),
      participants: [{ kind: 'human', player: 0, carId: this.opts.carId, color: this.opts.color, name: 'You' }, ...buildOpponents(5, [this.opts.color], this.seed)],
      rules,
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
    this.game.save.data.stats.races++;
    if (me?.place === 1) this.game.save.data.stats.wins++;
    this.game.save.save();
    this.game.showScreen(
      new ResultsScreen(this.game, session, {
        title: me?.place === 1 ? 'Last one standing!' : me?.eliminated ? 'Eliminated!' : 'Elimination',
        onRestart: () => this.restart(),
        onContinue: () => this.game.toMenu(),
        continueLabel: 'Main Menu',
        note: 'Every lap, the car in last place is knocked out of the race.',
      }),
    );
  }
}
