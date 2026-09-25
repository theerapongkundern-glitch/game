import type { Difficulty } from '../modes/ModeRules';

export interface DifficultyParams {
  /** Fraction of the grip-limited speed profile the AI aims for. */
  pace: number;
  /** Fraction of real braking capability the AI plans with. */
  braking: number;
  /** Lateral wobble (m) — sloppier lines on easy. */
  wobble: number;
  /** Probability of taking a shortcut each lap. */
  shortcut: number;
  /** Will use boost on straights. */
  boost: boolean;
  /** Rubber-banding strength (Easy only by design). */
  rubberBand: number;
  /** Engine power multiplier. */
  power: number;
  label: string;
}

export const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  easy: { pace: 0.84, braking: 0.62, wobble: 1.3, shortcut: 0, boost: false, rubberBand: 0.08, power: 0.92, label: 'Easy' },
  normal: { pace: 0.93, braking: 0.78, wobble: 0.6, shortcut: 0.5, boost: true, rubberBand: 0, power: 0.98, label: 'Normal' },
  hard: { pace: 1.0, braking: 0.9, wobble: 0.15, shortcut: 1, boost: true, rubberBand: 0, power: 1.02, label: 'Hard' },
};

/** Original, friendly rival driver names. */
export const AI_NAMES = ['Mina Vale', 'Kai Rowan', 'Juno Park', 'Rio Sato', 'Luz Adair', 'Nova Quill', 'Ezra Finch', 'Pip Holloway', 'Tamsin Rook', 'Oli Brandt'];

export const AI_COLORS = ['#3db4ff', '#ffd23f', '#a4e635', '#b44dff', '#ff8a3d', '#3de0ff', '#ff4fa3', '#f2f4ff'];
