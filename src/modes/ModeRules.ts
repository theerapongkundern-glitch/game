import type { RaceSession, RaceCar } from './RaceSession';

export type ModeId = 'free' | 'quick' | 'timetrial' | 'grandprix' | 'elimination' | 'rush' | 'split';
export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * Hooks a game mode plugs into the shared RaceSession. Everything is optional; the
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
  onStart?(s: RaceSession): void;
  onLap?(s: RaceSession, car: RaceCar, lapTime: number): void;
  onFinish?(s: RaceSession, car: RaceCar): void;
  /** Called every simulation step while racing. */
  update?(s: RaceSession, dt: number): void;
  /** Race is over (default: every human has finished). */
  isOver?(s: RaceSession): boolean;
  /** Per-frame HUD extras. */
  hud?(s: RaceSession, dt: number): void;
}
