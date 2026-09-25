import type { AudioEngine } from './AudioEngine';
import { EngineSound } from './EngineSound';
import { playEvent } from './SFX';
import type { RaceSession, SessionAudio } from '../modes/RaceSession';
import type { RaceCar, SoundEvent } from '../modes/RaceSim';
import { SURFACES } from '../tracks/Surfaces';

interface Voice {
  rc: RaceCar;
  sound: EngineSound;
}

/**
 * Connects a race to the audio engine: an engine voice per human player plus the two
 * nearest AI cars (panned and distance-attenuated), and one-shot event sounds.
 */
export class RaceAudio implements SessionAudio {
  private voices: Voice[] = [];
  private aiVoices: Voice[] = [];
  private pickTimer = 0;

  constructor(private readonly a: AudioEngine) {}

  attach(_session: RaceSession) {}

  private ensureVoices(session: RaceSession) {
    if (!this.a.ctx || this.voices.length) return;
    const humans = session.players.length;
    for (const pv of session.players) {
      this.voices.push({ rc: pv.rc, sound: new EngineSound(this.a, pv.rc.car.def, humans > 1 ? 0.7 : 1) });
    }
  }

  update(session: RaceSession, dt: number) {
    if (!this.a.ctx || this.a.ctx.state !== 'running') return;
    this.ensureVoices(session);
    const split = session.players.length > 1;
    this.voices.forEach((v, i) => {
      const p = v.rc.car.physics;
      const surf = SURFACES[p.surface];
      v.sound.update(
        dt,
        {
          rpm: p.rpm,
          throttle: v.rc.car.input.throttle,
          speed: p.speed,
          topSpeed: p.p.topSpeed,
          slip: p.drifting ? 0.6 : p.rearSlip,
          screech: surf.screech,
          offroad: surf.kicksUp ? 1 : 0,
          boosting: p.boosting,
          airborne: !p.grounded,
        },
        split ? (i === 0 ? -0.35 : 0.35) : 0,
      );
    });
    // Nearest AI voices (single player only, to keep CPU low).
    if (split) return;
    this.pickTimer -= dt;
    const me = session.players[0]?.rc;
    if (!me) return;
    if (this.pickTimer <= 0) {
      this.pickTimer = 0.5;
      const others = session.cars
        .filter((c) => !c.isHuman && !c.eliminated)
        .map((c) => ({ c, d: Math.hypot(c.car.physics.x - me.car.physics.x, c.car.physics.z - me.car.physics.z) }))
        .sort((x, y) => x.d - y.d)
        .slice(0, 2)
        .map((o) => o.c);
      // Replace voices whose car is no longer among the nearest.
      this.aiVoices = this.aiVoices.filter((v) => {
        if (others.includes(v.rc)) return true;
        v.sound.stop();
        return false;
      });
      for (const c of others) {
        if (!this.aiVoices.some((v) => v.rc === c)) this.aiVoices.push({ rc: c, sound: new EngineSound(this.a, c.car.def, 0.6) });
      }
    }
    const mp = me.car.physics;
    const cam = session.players[0].rig.camera;
    for (const v of this.aiVoices) {
      const p = v.rc.car.physics;
      const dx = p.x - mp.x;
      const dz = p.z - mp.z;
      const d = Math.hypot(dx, dz);
      const vol = Math.max(0, 1 - d / 90) ** 2;
      // Pan relative to the camera's right vector.
      const e = cam.matrixWorld.elements;
      const rx = e[0];
      const rz = e[2];
      const pan = d > 0.1 ? (dx * rx + dz * rz) / d : 0;
      const surf = SURFACES[p.surface];
      v.sound.update(
        dt,
        { rpm: p.rpm, throttle: v.rc.car.input.throttle, speed: p.speed, topSpeed: p.p.topSpeed, slip: p.drifting ? 0.6 : p.rearSlip, screech: surf.screech, offroad: surf.kicksUp ? 1 : 0, boosting: p.boosting, airborne: !p.grounded },
        pan * 0.8,
        vol,
      );
    }
  }

  event(name: SoundEvent, intensity = 1) {
    playEvent(this.a, name, intensity);
  }

  detach() {
    for (const v of this.voices) v.sound.stop();
    for (const v of this.aiVoices) v.sound.stop();
    this.voices = [];
    this.aiVoices = [];
  }
}
