import { describe, expect, it } from 'vitest';
import { TRACKS } from '../src/tracks';
import { runRace, aiField } from './helpers/headless';
import { eliminationRules } from '../src/modes/Elimination';
import { rushRules, RUSH_GATES_PER_LAP, RUSH_LAPS, type RushState } from '../src/modes/CheckpointRush';
import { GP_POINTS, applyRaceResult, type GPStanding } from '../src/modes/GrandPrix';
import { GhostRecorder, decodeGhost, encodeGhost, GHOST_RATE } from '../src/vehicles/Ghost';
import { migrate, defaultSave } from '../src/core/Save';

describe('Elimination', () => {
  it('knocks out the last car each lap until one remains', () => {
    const outs: string[] = [];
    const rules = eliminationRules((_s, name) => outs.push(name));
    const { sim } = runRace(TRACKS[2], rules, 'normal', aiField(6), 600);
    expect(sim.over).toBe(true);
    expect(outs.length).toBe(5);
    expect(sim.activeCars.length).toBe(1);
    const places = sim.cars.map((c) => c.place).sort((a, b) => a - b);
    expect(places).toEqual([1, 2, 3, 4, 5, 6]);
    const winner = sim.cars.find((c) => c.place === 1)!;
    expect(winner.eliminated).toBe(false);
  }, 120000);
});

describe('Checkpoint Rush', () => {
  it('adds time at every gate and completes with a generous clock', () => {
    const state: RushState = { timeLeft: 0, nextGate: 1, gatesPassed: 0, timedOut: false };
    let bonuses = 0;
    const rules = rushRules(60, 10, state, () => bonuses++);
    const { sim } = runRace(TRACKS[0], rules, 'hard', aiField(1), 400);
    expect(sim.over).toBe(true);
    expect(state.timedOut).toBe(false);
    expect(state.gatesPassed).toBe(RUSH_GATES_PER_LAP * RUSH_LAPS);
    expect(bonuses).toBe(RUSH_GATES_PER_LAP * RUSH_LAPS - 1);
    expect(sim.cars[0].finished).toBe(true);
  }, 120000);

  it('times out when the clock is too short', () => {
    const state: RushState = { timeLeft: 0, nextGate: 1, gatesPassed: 0, timedOut: false };
    const rules = rushRules(5, 0.5, state);
    const { sim } = runRace(TRACKS[0], rules, 'hard', aiField(1), 60);
    expect(sim.over).toBe(true);
    expect(state.timedOut).toBe(true);
    expect(sim.cars[0].finished).toBe(false);
  }, 60000);

  it('the default rush timings are achievable by hard AI on every track', () => {
    for (const def of TRACKS) {
      const state: RushState = { timeLeft: 0, nextGate: 1, gatesPassed: 0, timedOut: false };
      const rush = def.rush!;
      const { sim } = runRace(def, rushRules(rush.start, rush.perGate, state), 'hard', aiField(1), 400);
      expect(state.timedOut, def.id).toBe(false);
      expect(sim.cars[0].finished).toBe(true);
    }
  }, 240000);
});

describe('Grand Prix points', () => {
  it('awards 10/8/6/4/2/1 and sorts standings', () => {
    const mk = (i: number): GPStanding => ({ index: i, name: `C${i}`, carId: 'sunburst', color: '#fff', isHuman: i === 0, points: 0, races: [], wins: 0 });
    let st = [0, 1, 2, 3, 4, 5].map(mk);
    st = applyRaceResult(st, [2, 1, 3, 4, 5, 6]);
    st = applyRaceResult(st, [1, 3, 2, 4, 6, 5]);
    const me = st.find((s) => s.index === 0)!;
    expect(me.points).toBe(GP_POINTS[1] + GP_POINTS[0]);
    expect(me.races).toEqual([8, 10]);
    expect(st[0].points).toBeGreaterThanOrEqual(st[1].points);
    expect(st.reduce((a, s) => a + s.points, 0)).toBe(2 * GP_POINTS.reduce((a, b) => a + b, 0));
  });
});

describe('Ghost encoding', () => {
  it('round-trips a recorded lap with small quantisation error', () => {
    const rec = new GhostRecorder();
    for (let i = 0; i < 400; i++) rec.step(1 / 120, Math.sin(i / 50) * 300, i * 0.01, i * 0.9, (i / 400) * 6 - 3, i * 0.75);
    const g = rec.finish('tango', '#b44dff', 12.34);
    const back = decodeGhost(encodeGhost(g))!;
    expect(back.car).toBe('tango');
    expect(back.lapTime).toBeCloseTo(12.34);
    expect(back.samples.length).toBe(g.samples.length);
    for (let i = 0; i < g.samples.length; i++) expect(Math.abs(back.samples[i] - g.samples[i])).toBeLessThan(0.06);
    expect(g.samples.length / 5).toBeGreaterThan((400 / 120) * GHOST_RATE - 2);
  });

  it('rejects corrupt data', () => {
    expect(decodeGhost('garbage')).toBeNull();
    expect(decodeGhost(undefined)).toBeNull();
  });
});

describe('Save migration', () => {
  it('fills defaults and keeps starter unlocks', () => {
    const s = migrate({ version: 1, settings: { quality: 'insane', bindings: { up: ['KeyW'] } }, unlocked: { cars: [], tracks: [] } });
    expect(s.version).toBe(defaultSave().version);
    expect(s.settings.quality).toBe(defaultSave().settings.quality);
    expect(s.settings.bindings.length).toBe(2);
    expect(s.unlocked.cars).toContain('sunburst');
    expect(s.unlocked.tracks).toContain('coconut-coast');
  });

  it('survives garbage', () => {
    expect(migrate('nope').version).toBe(defaultSave().version);
    expect(migrate(null).profile.carId).toBe('sunburst');
  });
});
