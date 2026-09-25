import type { AudioEngine } from './AudioEngine';
import type { CarDef } from '../vehicles/CarDefs';
import { clamp } from '../core/math';

/**
 * A car's voice: engine (detuned oscillators + sub through a soft-clipper and a
 * throttle-driven low-pass), tyre screech, off-road rumble, wind and boost roar.
 */
export class EngineSound {
  private readonly out: GainNode;
  private readonly pan: StereoPannerNode;
  private readonly oscs: OscillatorNode[] = [];
  private readonly engGain: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly screechGain: GainNode;
  private readonly screechFilter: BiquadFilterNode;
  private readonly rumbleGain: GainNode;
  private readonly windGain: GainNode;
  private readonly boostGain: GainNode;
  private readonly boostFilter: BiquadFilterNode;
  private readonly sources: AudioBufferSourceNode[] = [];
  private readonly base: number;
  private readonly electric: boolean;
  private t = 0;

  constructor(
    private readonly a: AudioEngine,
    def: CarDef,
    volume = 1,
  ) {
    const ctx = a.ctx!;
    this.electric = def.engine.cylinders === 0;
    this.base = (this.electric ? 110 : 34 + def.engine.cylinders * 3) * def.engine.pitch;
    this.out = ctx.createGain();
    this.out.gain.value = volume;
    this.pan = ctx.createStereoPanner();
    this.out.connect(this.pan);
    this.pan.connect(a.sfx);

    // Engine.
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 800;
    this.filter.Q.value = this.electric ? 2 : 0.8;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    const drive = 1.5 + def.engine.growl * 5;
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    shaper.curve = curve;
    const types: OscillatorType[] = this.electric ? ['sine', 'triangle', 'sine'] : ['sawtooth', 'square', 'sine'];
    const mix = [0.5, 0.3, 0.6];
    types.forEach((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = mix[i];
      o.connect(g);
      g.connect(this.electric ? this.filter : shaper);
      o.start();
      this.oscs.push(o);
    });
    if (!this.electric) shaper.connect(this.filter);
    this.filter.connect(this.engGain);
    this.engGain.connect(this.out);

    // Noise-based layers.
    const noiseLayer = (type: BiquadFilterType, freq: number, q: number): [GainNode, BiquadFilterNode] => {
      const src = a.noiseSource(true)!;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f);
      f.connect(g);
      g.connect(this.out);
      src.start(0, Math.random() * 1.8);
      this.sources.push(src);
      return [g, f];
    };
    [this.screechGain, this.screechFilter] = noiseLayer('bandpass', 1900, 7);
    [this.rumbleGain] = noiseLayer('lowpass', 180, 1);
    [this.windGain] = noiseLayer('bandpass', 700, 0.6);
    [this.boostGain, this.boostFilter] = noiseLayer('bandpass', 400, 1.2);
  }

  update(dt: number, s: { rpm: number; throttle: number; speed: number; topSpeed: number; slip: number; screech: boolean; offroad: number; boosting: boolean; airborne: boolean }, pan = 0, volume = 1) {
    const ctx = this.a.ctx!;
    const t = ctx.currentTime;
    this.t += dt;
    const rpm = clamp(s.rpm, 0, 1.1);
    const f = this.base * (1 + rpm * (this.electric ? 3.4 : 2.7));
    this.oscs[0].frequency.setTargetAtTime(f, t, 0.03);
    this.oscs[1].frequency.setTargetAtTime(f * 1.007 * (this.electric ? 2 : 1), t, 0.03);
    this.oscs[2].frequency.setTargetAtTime(f * 0.5, t, 0.03);
    const thr = clamp(s.throttle, 0, 1);
    this.filter.frequency.setTargetAtTime(350 + thr * 1800 + rpm * 1600 + (s.boosting ? 900 : 0), t, 0.05);
    this.engGain.gain.setTargetAtTime((0.06 + thr * 0.08 + rpm * 0.04) * volume, t, 0.05);
    const speedF = clamp(s.speed / s.topSpeed, 0, 1.3);
    const sc = s.screech && !s.airborne ? clamp((s.slip - 0.1) * 1.6, 0, 1) * clamp(s.speed / 10, 0, 1) : 0;
    this.screechGain.gain.setTargetAtTime(sc * 0.16 * volume, t, 0.04);
    this.screechFilter.frequency.setTargetAtTime(1700 + Math.sin(this.t * 23) * 180 + sc * 300, t, 0.02);
    this.rumbleGain.gain.setTargetAtTime(s.offroad * clamp(s.speed / 15, 0, 1) * 0.35 * volume, t, 0.05);
    this.windGain.gain.setTargetAtTime(speedF * speedF * 0.1 * volume, t, 0.1);
    this.boostGain.gain.setTargetAtTime((s.boosting ? 0.18 : 0) * volume, t, s.boosting ? 0.05 : 0.2);
    this.boostFilter.frequency.setTargetAtTime(s.boosting ? 700 + speedF * 900 : 300, t, 0.2);
    this.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.05);
  }

  stop() {
    const t = this.a.ctx!.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => {
      for (const o of this.oscs) o.stop();
      for (const s of this.sources) s.stop();
      this.pan.disconnect();
    }, 200);
  }
}
