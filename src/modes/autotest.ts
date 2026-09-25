import type { Game } from '../core/Game';
import { TRACKS } from '../tracks';
import { CAR_DEFS } from '../vehicles/CarDefs';
import type { Difficulty } from './ModeRules';
import { QuickRace } from './QuickRace';
import type { RaceSession } from './RaceSession';

/**
 * Automated test hook: `?autotest=<mode>&track=<id>&difficulty=<d>&laps=<n>&fast=<x>`.
 * The human car is driven by the AI; results land in `window.__autotest` for scripts.
 */
export function runAutotest(game: Game) {
  const p = game.params;
  const w = window as unknown as { __autotest?: unknown };
  w.__autotest = { done: false };
  const trackId = p.get('track') ?? TRACKS[0].id;
  const carId = p.get('car') ?? CAR_DEFS[0].id;
  const difficulty = (p.get('difficulty') as Difficulty) ?? 'normal';
  const laps = Number(p.get('laps') ?? 1);
  const report = (session: RaceSession) => {
    w.__autotest = {
      done: true,
      results: session.sim.ranking().map((rc) => ({ name: rc.participant.name, car: rc.car.def.id, place: rc.place, time: rc.finishTime, finished: rc.finished })),
    };
  };
  const mode = new QuickRace(game, { trackId, carId, color: '#ff4fa3', difficulty, laps });
  const orig = mode.onRaceOver.bind(mode);
  mode.onRaceOver = (session) => {
    report(session);
    orig(session);
  };
  mode.begin();
}
