import { describe, expect, it } from 'vitest';
import { VehiclePhysics, makeInput, type Ground, type GroundInfo } from '../src/vehicles/VehiclePhysics';
import { CAR_DEFS, getCarDef } from '../src/vehicles/CarDefs';
import type { SurfaceType } from '../src/tracks/Surfaces';

class FlatGround implements Ground {
  constructor(public surface: SurfaceType = 'asphalt') {}
  sample(_x: number, _z: number, _r: number, out: GroundInfo): GroundInfo {
    out.ground = 0;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.surface = this.surface;
    out.onRoad = true;
    out.penetration = -1;
    out.tx = 0;
    out.tz = 1;
    return out;
  }
}

const DT = 1 / 120;

function run(car: VehiclePhysics, seconds: number, ground: Ground, input = makeInput(), each?: (t: number) => void) {
  for (let t = 0; t < seconds; t += DT) {
    each?.(t);
    car.step(DT, input, ground);
  }
}

describe('vehicle physics', () => {
  it('accelerates and reaches a sensible top speed for every car', () => {
    for (const def of CAR_DEFS) {
      const car = new VehiclePhysics(def);
      const input = makeInput();
      input.throttle = 1;
      let t100 = -1;
      let t = 0;
      for (; t < 60; t += DT) {
        car.step(DT, input, new FlatGround());
        if (t100 < 0 && car.speed >= 27.78) t100 = t;
      }
      expect(t100).toBeGreaterThan(1.5);
      expect(t100).toBeLessThan(7);
      expect(car.speed).toBeGreaterThan(car.p.topSpeed * 0.9);
      expect(car.speed).toBeLessThan(car.p.topSpeed * 1.05);
    }
  });

  it('boost raises top speed', () => {
    const car = new VehiclePhysics(getCarDef('sunburst'));
    const input = makeInput();
    input.throttle = 1;
    run(car, 40, new FlatGround(), input);
    const top = car.speed;
    car.boost = 1;
    input.boost = true;
    run(car, 2.5, new FlatGround(), input);
    expect(car.speed).toBeGreaterThan(top * 1.08);
  });

  it('sand slows the car down', () => {
    const a = new VehiclePhysics(getCarDef('sunburst'));
    const b = new VehiclePhysics(getCarDef('sunburst'));
    const input = makeInput();
    input.throttle = 1;
    run(a, 20, new FlatGround('asphalt'), input);
    run(b, 20, new FlatGround('sand'), input);
    expect(b.speed).toBeLessThan(a.speed * 0.7);
  });

  it('turns without spinning out at speed', () => {
    const car = new VehiclePhysics(getCarDef('sunburst'));
    const input = makeInput();
    input.throttle = 1;
    run(car, 6, new FlatGround(), input);
    input.steer = 1;
    let maxSlip = 0;
    run(car, 4, new FlatGround(), input, () => {
      maxSlip = Math.max(maxSlip, Math.abs(car.driftAngle));
    });
    expect(maxSlip).toBeLessThan(1.0);
    expect(car.speed).toBeGreaterThan(10);
  });

  it('handbrake while turning starts a drift and fills boost', () => {
    const car = new VehiclePhysics(getCarDef('tango'));
    car.boost = 0;
    const input = makeInput();
    input.throttle = 1;
    run(car, 5, new FlatGround(), input);
    input.steer = -1;
    input.handbrake = true;
    let drifted = false;
    run(car, 0.6, new FlatGround(), input, () => {
      if (car.drifting) drifted = true;
    });
    input.handbrake = false;
    let maxAngle = 0;
    run(car, 2, new FlatGround(), input, () => {
      if (car.drifting) drifted = true;
      maxAngle = Math.max(maxAngle, Math.abs(car.driftAngle));
    });
    expect(drifted).toBe(true);
    expect(maxAngle).toBeGreaterThan(0.15);
    expect(maxAngle).toBeLessThan(1.2);
    expect(car.boost).toBeGreaterThan(0.1);
  });

  it('brakes to a stop and can reverse', () => {
    const car = new VehiclePhysics(getCarDef('nitrino'));
    const input = makeInput();
    input.throttle = 1;
    run(car, 4, new FlatGround(), input);
    input.throttle = 0;
    input.brake = 1;
    run(car, 4, new FlatGround(), input);
    expect(car.vLong).toBeLessThan(0);
  });
});
