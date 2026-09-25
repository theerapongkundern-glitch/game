import type { AudioEngine } from './AudioEngine';
import type { SoundEvent } from '../modes/RaceSim';

/** One-shot synthesised sound effects for race events and the UI. */
export function playEvent(a: AudioEngine, name: SoundEvent | 'ui' | 'uiBack' | 'uiMove' | 'unlock' | 'podium', intensity = 1) {
  if (!a.ctx) return;
  switch (name) {
    case 'countdown':
      a.tone(587, 0.22, { type: 'square', gain: 0.12 });
      break;
    case 'go':
      a.tone(880, 0.5, { type: 'square', gain: 0.12 });
      a.tone(1318, 0.5, { type: 'square', gain: 0.08 });
      break;
    case 'lap':
      [784, 988, 1175].forEach((f, i) => a.tone(f, 0.18, { type: 'triangle', gain: 0.14, delay: i * 0.08 }));
      break;
    case 'finalLap':
      [784, 988, 1175, 1568].forEach((f, i) => a.tone(f, 0.2, { type: 'square', gain: 0.09, delay: i * 0.09 }));
      break;
    case 'finish':
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => a.tone(f, 0.28, { type: 'square', gain: 0.1, delay: i * 0.11 }));
      break;
    case 'boostPad':
      a.tone(300, 0.35, { type: 'sawtooth', gain: 0.1, slideTo: 1200 });
      a.burst(0.4, { freq: 600, sweepTo: 3000, q: 1.5, gain: 0.2 });
      break;
    case 'wall':
      a.burst(0.18 + intensity * 0.2, { type: 'lowpass', freq: 500 + intensity * 900, gain: 0.25 + intensity * 0.35 });
      a.burst(0.3, { type: 'bandpass', freq: 3200, q: 3, gain: 0.08 * intensity });
      break;
    case 'land':
      a.tone(120, 0.25, { type: 'sine', gain: 0.25 * intensity, slideTo: 50 });
      a.burst(0.2, { type: 'lowpass', freq: 400, gain: 0.25 * intensity });
      break;
    case 'bump':
      a.tone(180, 0.15, { type: 'triangle', gain: 0.2 * intensity, slideTo: 90 });
      a.burst(0.12, { type: 'lowpass', freq: 900, gain: 0.2 * intensity });
      break;
    case 'perfect':
      [1047, 1319, 1568, 2093].forEach((f, i) => a.tone(f, 0.16, { type: 'sine', gain: 0.12, delay: i * 0.05 }));
      break;
    case 'eliminated':
      [660, 523, 392].forEach((f, i) => a.tone(f, 0.22, { type: 'triangle', gain: 0.13, delay: i * 0.12 }));
      break;
    case 'gate':
      a.tone(1568, 0.14, { type: 'sine', gain: 0.15 });
      a.tone(2093, 0.2, { type: 'sine', gain: 0.1, delay: 0.07 });
      break;
    case 'timeout':
      a.tone(440, 0.6, { type: 'sawtooth', gain: 0.1, slideTo: 110 });
      break;
    case 'ui':
      a.tone(880, 0.09, { type: 'triangle', gain: 0.12 });
      a.tone(1320, 0.12, { type: 'triangle', gain: 0.08, delay: 0.04 });
      break;
    case 'uiMove':
      a.tone(660, 0.05, { type: 'triangle', gain: 0.06 });
      break;
    case 'uiBack':
      a.tone(520, 0.1, { type: 'triangle', gain: 0.1, slideTo: 330 });
      break;
    case 'unlock':
      [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => a.tone(f, 0.3, { type: 'triangle', gain: 0.1, delay: i * 0.07 }));
      break;
    case 'podium':
      [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => a.tone(f, 0.35, { type: 'square', gain: 0.08, delay: i * 0.14 }));
      break;
  }
}
