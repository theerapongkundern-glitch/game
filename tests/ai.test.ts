import { describe, expect, it } from 'vitest';
import { TRACKS } from '../src/tracks';
import { runRace, aiField, trackFor } from './helpers/headless';
import { aiContext } from '../src/ai/AIDriver';

describe('AI racing', () => {
  it('keeps racing lines inside the road', () => {
    for (const def of TRACKS) {
      const t = trackFor(def);
      const ctx = aiContext(t);
      t.paths.forEach((p, k) => {
        const line = ctx.lines[k];
        for (let i = 0; i < p.n; i++) expect(Math.abs(line.offset[i])).toBeLessThanOrEqual(p.hw[i]);
      });
    }
  });

  it.each(TRACKS.map((t) => [t.id, t] as const))('completes a lap on %s without getting stuck', (_id, def) => {
    const { sim, resets } = runRace(def, { id: 'quick', laps: 1, showPosition: true }, 'normal', aiField(6), 200);
    expect(sim.over).toBe(true);
    expect(resets).toBeLessThanOrEqual(1);
    const places = sim.cars.map((c) => c.place).sort((a, b) => a - b);
    expect(places).toEqual([1, 2, 3, 4, 5, 6]);
    for (const rc of sim.cars) {
      expect(rc.finished).toBe(true);
      expect(rc.lapTimes[0]).toBeGreaterThan(30);
      expect(rc.lapTimes[0]).toBeLessThan(90);
    }
  }, 60000);

  it('hard AI is faster than easy AI', () => {
    const def = TRACKS[0];
    const easy = runRace(def, { id: 'quick', laps: 1, showPosition: true }, 'easy', aiField(1), 200).sim.cars[0].finishTime;
    const hard = runRace(def, { id: 'quick', laps: 1, showPosition: true }, 'hard', aiField(1), 200).sim.cars[0].finishTime;
    expect(hard).toBeLessThan(easy);
  }, 60000);
});
