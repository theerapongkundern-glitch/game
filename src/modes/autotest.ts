import type { Game, ModeController } from '../core/Game';
import { TRACKS } from '../tracks';
import { CAR_DEFS } from '../vehicles/CarDefs';
import type { Difficulty, ModeId } from './ModeRules';
import { QuickRace } from './QuickRace';
import { TimeTrial } from './TimeTrial';
import { GrandPrix } from './GrandPrix';
import { Elimination } from './Elimination';
import { CheckpointRush } from './CheckpointRush';
import { SplitScreen } from './SplitScreen';
import type { RaceSession } from './RaceSession';

/**
 * Automated test hook: `?autotest=<mode>&track=<id>&difficulty=<d>&laps=<n>&fast=<x>`.
 * Human cars are driven by the AI; results land in `window.__autotest` for scripts.
 * For Grand Prix, `window.__autotest.races` counts completed races and the standings
 * screen advances automatically.
 */
export function runAutotest(game: Game) {
  const p = game.params;
  const w = window as unknown as { __autotest?: Record<string, unknown> };
  const state: Record<string, unknown> = { done: false, races: 0, mode: game.autotest };
  w.__autotest = state;
  const trackId = p.get('track') ?? TRACKS[0].id;
  const carId = p.get('car') ?? CAR_DEFS[0].id;
  const difficulty = (p.get('difficulty') as Difficulty) ?? 'normal';
  const laps = Number(p.get('laps') ?? 1);
  const report = (session: RaceSession) => {
    state.races = (state.races as number) + 1;
    state.results = session.sim.ranking().map((rc) => ({ name: rc.participant.name, car: rc.car.def.id, place: rc.place, time: rc.finishTime, finished: rc.finished, out: rc.eliminated }));
  };
  if (game.autotest === 'podium') {
    // Visual check of the podium with sample standings.
    const gp = new GrandPrix(game, { carId, color: '#ff4fa3', cup: 'bronze', difficulty });
    gp.standings.forEach((s, i) => (s.points = 40 - i * 7));
    import('../ui/screens/PodiumScreen').then(({ PodiumScreen }) => game.showPodium(new PodiumScreen(game, gp.standings, 'bronze', 1, ['Tango Twister', 'Neon Nightway'])));
    state.done = true;
    return;
  }
  const mode = game.autotest as ModeId;
  let ctrl: ModeController;
  switch (mode) {
    case 'timetrial':
      ctrl = new TimeTrial(game, { trackId, carId, color: '#ff4fa3' });
      break;
    case 'grandprix':
      ctrl = new GrandPrix(game, { carId, color: '#ff4fa3', cup: 'bronze', difficulty });
      break;
    case 'elimination':
      ctrl = new Elimination(game, { trackId, carId, color: '#ff4fa3', difficulty });
      break;
    case 'rush':
      ctrl = new CheckpointRush(game, { trackId, carId, color: '#ff4fa3' });
      break;
    case 'split':
      ctrl = new SplitScreen(game, { trackId, cars: [{ carId, color: '#ff4fa3' }, { carId: 'nitrino', color: '#3de0ff' }], difficulty, laps, ai: 2 });
      break;
    default:
      ctrl = new QuickRace(game, { trackId, carId, color: '#ff4fa3', difficulty, laps });
  }
  if (mode === 'timetrial') TimeTrial.LAPS_OVERRIDE = laps;
  if (mode === 'grandprix') {
    const gp = ctrl as GrandPrix;
    gp.lapsOverride = laps;
    const orig = gp.onRaceOver.bind(gp);
    gp.onRaceOver = (session) => {
      report(session);
      orig(session);
      // Auto-advance through the standings screens.
      const last = gp.raceIndex >= gp.tracks.length - 1;
      const advance = () => {
        const btn = document.querySelector<HTMLButtonElement>('.standings .btn.primary');
        if (!btn) return setTimeout(advance, 200);
        btn.click();
        if (last) {
          state.done = true;
          state.standings = gp.standings.map((s) => ({ name: s.name, points: s.points }));
        }
      };
      setTimeout(advance, 400);
    };
  } else {
    const orig = ctrl.onRaceOver.bind(ctrl);
    ctrl.onRaceOver = (session) => {
      report(session);
      state.done = true;
      orig(session);
    };
  }
  ctrl.begin();
}
