import type { Game } from '../core/Game';
import type { ModeId } from './ModeRules';
import type { Selection } from '../ui/flow';
import { QuickRace } from './QuickRace';

/** Creates the controller for a mode from the menu selections and starts it. */
export function launchMode(game: Game, mode: Exclude<ModeId, 'free'>, sel: Selection) {
  const car = sel.cars[0];
  switch (mode) {
    case 'quick':
      new QuickRace(game, { trackId: sel.trackId, carId: car.carId, color: car.color, difficulty: sel.difficulty, laps: sel.laps }).begin();
      break;
    default:
      game.toast('This mode arrives in the next update!');
      game.toMenu();
  }
}
