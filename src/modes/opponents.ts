import { AI_COLORS, AI_NAMES } from '../ai/Difficulty';
import { CAR_DEFS } from '../vehicles/CarDefs';
import { Rng } from '../core/rng';
import type { Participant } from './RaceSim';

/** Builds a field of AI rivals with varied cars, colours and names. */
export function buildOpponents(count: number, avoidColors: string[], seed = Date.now()): Participant[] {
  const rng = new Rng(seed);
  const names = [...AI_NAMES];
  const colors = AI_COLORS.filter((c) => !avoidColors.includes(c));
  const out: Participant[] = [];
  for (let i = 0; i < count; i++) {
    const car = CAR_DEFS[(i + rng.int(0, CAR_DEFS.length - 1)) % CAR_DEFS.length];
    const name = names.splice(rng.int(0, names.length - 1), 1)[0] ?? `Rival ${i + 1}`;
    const color = colors.length ? colors.splice(rng.int(0, colors.length - 1), 1)[0] : car.defaultColor;
    out.push({ kind: 'ai', carId: car.id, color, name });
  }
  return out;
}
