import type { Game, ModeController } from '../core/Game';
import type { RaceConfig, RaceSession } from './RaceSession';
import type { Difficulty } from './ModeRules';
import type { Participant } from './RaceSim';
import type { CupId } from '../core/Save';
import { buildOpponents } from './opponents';
import { TRACKS } from '../tracks';

/** Points for 1st..6th. */
export const GP_POINTS = [10, 8, 6, 4, 2, 1];

export interface GPStanding {
  index: number;
  name: string;
  carId: string;
  color: string;
  isHuman: boolean;
  points: number;
  /** Points per race. */
  races: number[];
  /** Best single-race finish (tie-breaker). */
  wins: number;
}

/** Pure standings update so it can be unit-tested. */
export function applyRaceResult(standings: GPStanding[], placesByIndex: number[]): GPStanding[] {
  for (const s of standings) {
    const place = placesByIndex[s.index];
    const pts = GP_POINTS[place - 1] ?? 0;
    s.points += pts;
    s.races.push(pts);
    if (place === 1) s.wins++;
  }
  return sortStandings(standings);
}

export function sortStandings(standings: GPStanding[]): GPStanding[] {
  return [...standings].sort((a, b) => b.points - a.points || b.wins - a.wins || a.index - b.index);
}

/** Grand Prix: the four tracks in a row, points per race, standings, podium and cup prizes. */
export class GrandPrix implements ModeController {
  readonly id = 'grandprix' as const;
  raceIndex = 0;
  standings: GPStanding[];
  private readonly participants: Participant[];
  readonly tracks = TRACKS;
  /** Test hook: shorter races in automated runs. */
  lapsOverride = 0;

  constructor(
    private readonly game: Game,
    readonly opts: { carId: string; color: string; cup: CupId; difficulty: Difficulty },
  ) {
    this.participants = [{ kind: 'human', player: 0, carId: opts.carId, color: opts.color, name: 'You' }, ...buildOpponents(5, [opts.color], Date.now())];
    this.standings = this.participants.map((p, i) => ({ index: i, name: p.name, carId: p.carId, color: p.color, isHuman: p.kind === 'human', points: 0, races: [], wins: 0 }));
  }

  config(): RaceConfig {
    const s = this.game.save.data.settings;
    return {
      track: this.tracks[this.raceIndex],
      participants: this.participants,
      rules: { id: 'grandprix', laps: this.lapsOverride || 3, showPosition: true },
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
    // Restarting a GP race replays the same race without scoring the aborted attempt.
    this.begin();
  }

  quit() {
    this.game.toMenu();
  }

  onRaceOver(session: RaceSession) {
    const places: number[] = [];
    for (const rc of session.sim.cars) places[rc.index] = rc.place;
    const before = sortStandings(this.standings).map((s) => s.index);
    this.standings = applyRaceResult(this.standings, places);
    const me = session.sim.humanCars[0];
    this.game.save.data.stats.races++;
    if (me?.place === 1) this.game.save.data.stats.wins++;
    this.game.save.save();
    const last = this.raceIndex >= this.tracks.length - 1;
    import('../ui/screens/StandingsScreen').then(({ StandingsScreen }) =>
      this.game.showScreen(
        new StandingsScreen(this.game, session, this, {
          before,
          final: last,
          onNext: () => {
            if (last) this.finish();
            else {
              this.raceIndex++;
              this.begin();
            }
          },
        }),
      ),
    );
  }

  private finish() {
    const order = sortStandings(this.standings);
    const myPlace = order.findIndex((s) => s.isHuman) + 1;
    const unlocked = this.game.save.winCup(this.opts.cup, myPlace);
    import('../ui/screens/PodiumScreen').then(({ PodiumScreen }) => this.game.showPodium(new PodiumScreen(this.game, order, this.opts.cup, myPlace, unlocked)));
  }
}
