import { Track } from '../../src/tracks/Track';
import type { TrackDef } from '../../src/tracks/types';
import { RaceSim, type Participant } from '../../src/modes/RaceSim';
import type { ModeRules, Difficulty } from '../../src/modes/ModeRules';
import { makeAIBrainFactory } from '../../src/ai/AIDriver';
import { CAR_DEFS } from '../../src/vehicles/CarDefs';

const trackCache = new Map<string, Track>();
export function trackFor(def: TrackDef): Track {
  let t = trackCache.get(def.id);
  if (!t) {
    t = new Track(def);
    trackCache.set(def.id, t);
  }
  return t;
}

export function aiField(n: number, withHuman = false): Participant[] {
  const out: Participant[] = [];
  for (let i = 0; i < n; i++) {
    const def = CAR_DEFS[i % CAR_DEFS.length];
    out.push({ kind: withHuman && i === 0 ? 'human' : 'ai', player: withHuman && i === 0 ? 0 : undefined, carId: def.id, color: def.defaultColor, name: `Car ${i}` });
  }
  return out;
}

/** Runs a race headlessly; humans (if any) are driven by an autopilot brain. */
export function runRace(def: TrackDef, rules: ModeRules, difficulty: Difficulty, participants: Participant[], maxSeconds = 600) {
  const track = trackFor(def);
  const sim = new RaceSim(track, participants, rules, difficulty, { countdown: true, quality: 'low' });
  const factory = makeAIBrainFactory(difficulty);
  sim.makeBrain = factory;
  // Humans get an AI brain so the race can complete.
  for (const rc of sim.cars) if (rc.isHuman) rc.brain = factory(rc, sim, false);
  const dt = 1 / 120;
  let resets = 0;
  const origReset = sim.resetCar.bind(sim);
  sim.resetCar = (rc) => {
    resets++;
    origReset(rc);
  };
  let t = 0;
  while (!sim.over && t < maxSeconds) {
    sim.step(dt, () => {});
    t += dt;
  }
  return { sim, resets, t };
}
