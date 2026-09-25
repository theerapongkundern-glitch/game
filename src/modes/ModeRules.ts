import type { RaceSim, RaceCar } from './RaceSim';
import type { RaceSession } from './RaceSession';

export type ModeId = 'free' | 'quick' | 'timetrial' | 'grandprix' | 'elimination' | 'rush' | 'split';
export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * Hooks a game mode plugs into the shared race simulation. Everything is optional; the
 * defaults give a normal "first to finish N laps" race.
 */
export interface ModeRules {
  id: ModeId;
  /** Laps to finish (0 = endless). */
  laps: number;
  /** Show race position (1st–6th) in the HUD. */
  showPosition: boolean;
  /** Label for the lap counter. */
  lapLabel?: string;
  onStart?(s: RaceSim): void;
  onLap?(s: RaceSim, car: RaceCar, lapTime: number): void;
  onFinish?(s: RaceSim, car: RaceCar): void;
  /** Called every simulation step while racing. */
  update?(s: RaceSim, dt: number): void;
  /** Race is over (default: every human has finished). */
  isOver?(s: RaceSim): boolean;
  /** Per-frame HUD extras (rendering side). */
  hud?(session: RaceSession, dt: number): void;
}
