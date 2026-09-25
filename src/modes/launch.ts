import type { Game } from '../core/Game';
import type { ModeId } from './ModeRules';
import type { Selection } from '../ui/flow';
import { QuickRace } from './QuickRace';
import { TimeTrial } from './TimeTrial';
import { GrandPrix } from './GrandPrix';
import { Elimination } from './Elimination';
import { CheckpointRush } from './CheckpointRush';
import { SplitScreen } from './SplitScreen';

/** Creates the controller for a mode from the menu selections and starts it. */
export function launchMode(game: Game, mode: Exclude<ModeId, 'free'>, sel: Selection) {
  const car = sel.cars[0];
  switch (mode) {
    case 'quick':
      new QuickRace(game, { trackId: sel.trackId, carId: car.carId, color: car.color, difficulty: sel.difficulty, laps: sel.laps }).begin();
      break;
    case 'timetrial':
      new TimeTrial(game, { trackId: sel.trackId, carId: car.carId, color: car.color }).begin();
      break;
    case 'grandprix':
      new GrandPrix(game, { carId: car.carId, color: car.color, cup: sel.cup ?? 'bronze', difficulty: sel.difficulty }).begin();
      break;
    case 'elimination':
      new Elimination(game, { trackId: sel.trackId, carId: car.carId, color: car.color, difficulty: sel.difficulty }).begin();
      break;
    case 'rush':
      new CheckpointRush(game, { trackId: sel.trackId, carId: car.carId, color: car.color }).begin();
      break;
    case 'split':
      new SplitScreen(game, { trackId: sel.trackId, cars: sel.cars, difficulty: sel.difficulty, laps: sel.laps, ai: 4 }).begin();
      break;
  }
}
