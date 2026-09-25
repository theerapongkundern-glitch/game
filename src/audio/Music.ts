import type { AudioEngine } from './AudioEngine';
import type { MusicThemeId } from '../tracks/types';

interface Theme {
  bpm: number;
  /** MIDI root note. */
  root: number;
  /** Chord roots as scale degrees (semitones from root) with quality. */
  chords: [number, 'maj' | 'min'][];
  lead: OscillatorType;
  bass: OscillatorType;
  pad: OscillatorType;
  /** 16-step arpeggio patterns (chord-tone index, -1 = rest). */
  arps: number[][];
  swing: number;
  leadDecay: number;
  drums: 'four' | 'break' | 'half';
  brightness: number;
}

const THEMES: Record<MusicThemeId, Theme> = {
  menu: {
    bpm: 112,
    root: 60,
    chords: [
      [0, 'maj'],
      [7, 'maj'],
      [9, 'min'],
      [5, 'maj'],
    ],
    lead: 'triangle',
    bass: 'square',
    pad: 'triangle',
    arps: [
      [0, -1, 1, 2, -1, 1, 3, -1, 2, -1, 1, 2, -1, 3, 2, 1],
      [0, 2, 1, 3, 2, 1, 0, -1, 0, 2, 1, 3, 2, 1, 3, -1],
    ],
    swing: 0,
    leadDecay: 0.18,
    drums: 'four',
    brightness: 2200,
  },
  beach: {
    bpm: 124,
    root: 65,
    chords: [
      [0, 'maj'],
      [5, 'maj'],
      [9, 'min'],
      [7, 'maj'],
    ],
    lead: 'sine',
    bass: 'triangle',
    pad: 'triangle',
    arps: [
      [0, -1, 2, -1, 1, 3, -1, 2, 0, -1, 2, 1, -1, 3, 2, -1],
      [3, 2, 1, -1, 2, -1, 1, 0, 3, -1, 2, 1, 0, -1, 1, 2],
    ],
    swing: 0.12,
    leadDecay: 0.22,
    drums: 'break',
    brightness: 2600,
  },
  city: {
    bpm: 128,
    root: 57,
    chords: [
      [0, 'min'],
      [8, 'maj'],
      [3, 'maj'],
      [10, 'maj'],
    ],
    lead: 'sawtooth',
    bass: 'sawtooth',
    pad: 'sawtooth',
    arps: [
      [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3],
      [0, 2, 3, 2, 0, 2, 3, 2, 1, 2, 3, 2, 1, 2, 3, 2],
    ],
    swing: 0,
    leadDecay: 0.14,
    drums: 'four',
    brightness: 1800,
  },
  forest: {
    bpm: 118,
    root: 62,
    chords: [
      [0, 'maj'],
      [5, 'maj'],
      [9, 'min'],
      [7, 'maj'],
    ],
    lead: 'triangle',
    bass: 'triangle',
    pad: 'sine',
    arps: [
      [0, -1, 1, -1, 2, -1, 3, 2, 0, -1, 1, -1, 3, -1, 2, 1],
      [2, 1, 0, -1, 1, 2, 3, -1, 2, 1, 0, -1, 3, 2, 1, -1],
    ],
    swing: 0.08,
    leadDecay: 0.28,
    drums: 'half',
    brightness: 2400,
  },
  desert: {
    bpm: 122,
    root: 64,
    chords: [
      [0, 'maj'],
      [10, 'maj'],
      [5, 'maj'],
      [0, 'maj'],
    ],
    lead: 'square',
    bass: 'square',
    pad: 'triangle',
    arps: [
      [0, -1, 2, 1, -1, 2, 3, -1, 0, -1, 2, 1, 3, 2, -1, 1],
      [3, -1, 2, -1, 1, -1, 0, 2, 3, -1, 2, -1, 1, 2, 0, -1],
    ],
    swing: 0.05,
    leadDecay: 0.16,
    drums: 'break',
    brightness: 2000,
  },
  podium: {
    bpm: 100,
    root: 60,
    chords: [
      [0, 'maj'],
      [5, 'maj'],
      [7, 'maj'],
      [0, 'maj'],
    ],
    lead: 'square',
    bass: 'triangle',
    pad: 'triangle',
    arps: [[0, -1, 1, -1, 2, -1, 3, -1, 2, -1, 1, -1, 0, 1, 2, 3]],
    swing: 0,
    leadDecay: 0.3,
    drums: 'half',
    brightness: 2600,
  },
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Procedural, upbeat background music: a step sequencer (16ths) with drums, bass,
 * chord pads and an arpeggiated lead, scheduled ahead with the audio clock.
 */
export class Music {
  private theme: Theme | null = null;
  private themeId: MusicThemeId | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private bar = 0;
  private bus: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  /** 0..1 intensity (e.g. raises during the final lap). */
  energy = 0.6;

  constructor(private readonly a: AudioEngine) {}

  play(id: MusicThemeId) {
    if (this.themeId === id && this.timer !== null) return;
    this.stop();
    const ctx = this.a.ensure();
    if (!ctx) return;
    this.themeId = id;
    this.theme = THEMES[id];
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 16000;
    this.bus.connect(this.filter);
    this.filter.connect(this.a.music);
    this.step = 0;
    this.bar = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** Muffles the music (pause menus). */
  setMuffled(on: boolean) {
    if (!this.filter || !this.a.ctx) return;
    this.filter.frequency.setTargetAtTime(on ? 700 : 16000, this.a.ctx.currentTime, 0.15);
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const bus = this.bus;
    const ctx = this.a.ctx;
    if (bus && ctx) {
      bus.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      setTimeout(() => bus.disconnect(), 1200);
    }
    this.bus = null;
    this.themeId = null;
  }

  get playing() {
    return this.themeId;
  }

  private schedule() {
    const ctx = this.a.ctx;
    const th = this.theme;
    if (!ctx || !th || !this.bus) return;
    if (ctx.state !== 'running') {
      this.nextTime = ctx.currentTime + 0.05;
      return;
    }
    const stepDur = 60 / th.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.14) {
      const swing = this.step % 2 === 1 ? th.swing * stepDur : 0;
      this.playStep(this.nextTime + swing, stepDur);
      this.nextTime += stepDur;
      this.step++;
      if (this.step >= 16) {
        this.step = 0;
        this.bar++;
      }
    }
  }

  private playStep(t: number, sd: number) {
    const th = this.theme!;
    const s = this.step;
    const chord = th.chords[this.bar % th.chords.length];
    const rootMidi = th.root + chord[0];
    const third = chord[1] === 'maj' ? 4 : 3;
    const tones = [rootMidi, rootMidi + third, rootMidi + 7, rootMidi + 12];
    const section = Math.floor(this.bar / 8) % 4; // 0 intro-ish, 1 main, 2 main B, 3 breakdown
    const breakdown = section === 3 && this.bar % 8 < 4;

    // Drums.
    if (!breakdown) {
      if (th.drums === 'four' && s % 4 === 0) this.kick(t);
      if (th.drums === 'break' && (s === 0 || s === 6 || s === 10)) this.kick(t);
      if (th.drums === 'half' && (s === 0 || s === 10)) this.kick(t);
      if (s === 4 || s === 12) this.snare(t);
      if (s % 2 === 0 || (this.energy > 0.7 && s % 2 === 1)) this.hat(t, s % 4 === 2 ? 0.09 : 0.05);
    } else if (s === 0) this.kick(t);
    // Bass: root on 8ths with an octave hop.
    if (s % 2 === 0) {
      const note = s % 8 === 6 ? rootMidi - 12 + 12 : rootMidi - 24;
      this.voice(th.bass, mtof(note), t, sd * 1.8, 0.09, 600);
    }
    // Pad chord on the downbeat.
    if (s === 0) {
      for (let i = 0; i < 3; i++) this.voice(th.pad, mtof(tones[i]), t, sd * 15, 0.028, 1400, 0.25);
    }
    // Lead arpeggio (sits out in the intro half of section 0).
    const arp = th.arps[section % th.arps.length];
    const idx = arp[s];
    if (idx >= 0 && !(section === 0 && this.bar % 8 < 2)) {
      const oct = section === 2 ? 24 : 12;
      this.voice(th.lead, mtof(tones[idx] + oct), t, th.leadDecay, 0.05, th.brightness);
    }
  }

  private voice(type: OscillatorType, freq: number, t: number, dur: number, gain: number, cutoff: number, attack = 0.005) {
    const ctx = this.a.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.bus!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number) {
    const ctx = this.a.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g);
    g.connect(this.bus!);
    o.start(t);
    o.stop(t + 0.3);
  }

  private snare(t: number) {
    const ctx = this.a.ctx!;
    const n = this.a.noiseSource(false);
    if (!n) return;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2200;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    n.connect(f);
    f.connect(g);
    g.connect(this.bus!);
    n.start(t, Math.random());
    n.stop(t + 0.2);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.value = 190;
    og.gain.setValueAtTime(0.08, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(og);
    og.connect(this.bus!);
    o.start(t);
    o.stop(t + 0.1);
  }

  private hat(t: number, gain: number) {
    const ctx = this.a.ctx!;
    const n = this.a.noiseSource(false);
    if (!n) return;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(f);
    f.connect(g);
    g.connect(this.bus!);
    n.start(t, Math.random());
    n.stop(t + 0.06);
  }
}
