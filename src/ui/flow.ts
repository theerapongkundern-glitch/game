import type { Game } from '../core/Game';
import type { ModeId, Difficulty } from '../modes/ModeRules';
import type { CupId } from '../core/Save';
import { GarageScreen } from './screens/GarageScreen';
import { TrackSelectScreen } from './screens/TrackSelectScreen';
import { launchMode } from '../modes/launch';

export interface Selection {
  cars: { carId: string; color: string }[];
  trackId: string;
  difficulty: Difficulty;
  laps: number;
  cup?: CupId;
}

export const MODE_INFO: Record<Exclude<ModeId, 'free'>, { title: string; blurb: string }> = {
  quick: { title: 'Quick Race', blurb: 'Pick a car and a track. Three laps, five rivals.' },
  grandprix: { title: 'Grand Prix', blurb: 'Four tracks in a row. Win cups to unlock cars & tracks.' },
  timetrial: { title: 'Time Trial', blurb: 'Race your own best-lap ghost.' },
  elimination: { title: 'Elimination', blurb: 'Last place is out every lap!' },
  rush: { title: 'Checkpoint Rush', blurb: 'Beat the clock — every gate adds time.' },
  split: { title: '2 Players', blurb: 'Split-screen racing: WASD vs Arrow keys.' },
};

/** Walks the player(s) through car and track selection for a mode, then launches it. */
export function startFlow(game: Game, mode: Exclude<ModeId, 'free'>) {
  const prof = game.save.data.profile;
  const sel: Selection = { cars: [], trackId: prof.trackId, difficulty: prof.difficulty, laps: 3 };
  const players = mode === 'split' ? 2 : 1;

  const pickCar = (player: number) => {
    game.showGarage(
      new GarageScreen(game, {
        title: players > 1 ? `Player ${player + 1}: choose your car` : 'Choose your car',
        subtitle: MODE_INFO[mode].title,
        player,
        onPick: (carId, color) => {
          sel.cars[player] = { carId, color };
          if (player + 1 < players) pickCar(player + 1);
          else afterCars();
        },
        onBack: () => (player === 0 ? game.toMenu() : pickCar(player - 1)),
      }),
    );
  };

  const afterCars = () => {
    if (mode === 'grandprix') {
      import('./screens/CupSelectScreen').then(({ CupSelectScreen }) =>
        game.showScreenWithBackground(
          new CupSelectScreen(game, {
            onPick: (cup, difficulty) => {
              sel.cup = cup;
              sel.difficulty = difficulty;
              launchMode(game, mode, sel);
            },
            onBack: () => pickCar(players - 1),
          }),
        ),
      );
      return;
    }
    game.showTrackSelect(
      new TrackSelectScreen(game, {
        mode,
        showDifficulty: mode !== 'timetrial' && mode !== 'rush',
        showLaps: mode === 'quick' || mode === 'split',
        initial: sel,
        onPick: (trackId, difficulty, laps) => {
          sel.trackId = trackId;
          sel.difficulty = difficulty;
          sel.laps = laps;
          prof.trackId = trackId;
          prof.difficulty = difficulty;
          game.save.save();
          launchMode(game, mode, sel);
        },
        onBack: () => pickCar(players - 1),
      }),
    );
  };

  pickCar(0);
}
