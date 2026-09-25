import { describe, expect, it } from 'vitest';
import { Track, TrackGround, makeFrame, makeQuery, SAMPLE_SPACING } from '../src/tracks/Track';
import { testTrack } from '../src/tracks/defs/testTrack';
import { VehiclePhysics, makeInput } from '../src/vehicles/VehiclePhysics';
import { getCarDef } from '../src/vehicles/CarDefs';

describe('track sampling', () => {
  const track = new Track(testTrack);

  it('samples the loop at roughly fixed spacing', () => {
    const m = track.main;
    expect(m.n).toBeGreaterThan(100);
    let maxGap = 0;
    for (let i = 0; i < m.n; i++) {
      const j = m.idx(i + 1);
      maxGap = Math.max(maxGap, Math.hypot(m.px[j] - m.px[i], m.pz[j] - m.pz[i]));
    }
    expect(maxGap).toBeLessThan(SAMPLE_SPACING * 1.3);
  });

  it('queries lateral offset, surface and progress', () => {
    const f = track.main.frameAt(100, makeFrame());
    const q = makeQuery(track.paths.length);
    track.query(f.x + f.nx * 3, f.z + f.nz * 3, q);
    expect(q.path).toBe(0);
    expect(q.lateral).toBeCloseTo(3, 0);
    expect(q.onRoad).toBe(true);
    expect(Math.abs(q.mainS - 100)).toBeLessThan(3);
    // Off the road but inside the barrier -> shoulder surface.
    track.query(f.x + f.nx * (f.hw + 2), f.z + f.nz * (f.hw + 2), q);
    expect(q.onRoad).toBe(false);
    expect(q.surface).toBe('grass');
    expect(q.penetration).toBeLessThan(0);
    // Beyond the barrier -> penetration.
    track.query(f.x + f.nx * (f.hw + testTrack.shoulder + 1), f.z + f.nz * (f.hw + testTrack.shoulder + 1), q);
    expect(q.penetration).toBeGreaterThan(0);
  });

  it('maps shortcut progress onto the main loop', () => {
    expect(track.paths.length).toBe(2);
    const sc = track.paths[1];
    const q = makeQuery(track.paths.length);
    const mid = Math.floor(sc.n / 2);
    track.query(sc.px[mid], sc.pz[mid], q);
    expect(q.path).toBe(1);
    const from = sc.mainFrom;
    expect(q.mainS).toBeGreaterThan(from);
    expect(q.mainS).toBeLessThan(from + sc.mainSpan);
    expect(q.surface).toBe('dirt');
  });

  it('keeps a car inside the barriers when steering into a wall', () => {
    const f = track.main.frameAt(40, makeFrame());
    const car = new VehiclePhysics(getCarDef('sunburst'));
    const g = new TrackGround(track);
    car.place(f.x, f.y, f.z, f.heading);
    const input = makeInput();
    input.throttle = 1;
    input.steer = 1;
    let maxPen = -Infinity;
    for (let i = 0; i < 120 * 6; i++) {
      car.step(1 / 120, input, g);
      maxPen = Math.max(maxPen, g.q.penetration);
    }
    expect(maxPen).toBeLessThan(0.8);
  });

  it('launches the car off the ramp', () => {
    const ramp = track.main.ramps[0];
    const f = track.main.frameAt(ramp.s0 - 60, makeFrame());
    const car = new VehiclePhysics(getCarDef('sunburst'));
    const g = new TrackGround(track);
    const lat = (ramp.lat0 + ramp.lat1) / 2;
    car.place(f.x + f.nx * lat, f.y, f.z + f.nz * lat, f.heading);
    const input = makeInput();
    input.throttle = 1;
    car.boost = 1;
    input.boost = true;
    let airborne = false;
    for (let i = 0; i < 120 * 5; i++) {
      car.step(1 / 120, input, g);
      if (!car.grounded) airborne = true;
    }
    expect(airborne).toBe(true);
  });
});
