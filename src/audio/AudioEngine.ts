/**
 * Web Audio context with master / music / sfx buses. Everything is synthesised at
 * runtime — no audio files. The context is created lazily and resumed on the first
 * user gesture (browser autoplay rules).
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  music!: GainNode;
  sfx!: GainNode;
  private comp!: DynamicsCompressorNode;
  noise!: AudioBuffer;
  volumes = { master: 0.8, music: 0.6, sfx: 0.85 };
  muted = false;
  private listenersAdded = false;

  /** Call early; the context starts on the first click/key/touch. */
  init() {
    if (this.listenersAdded) return;
    this.listenersAdded = true;
    const unlock = () => {
      this.ensure();
      if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else this.ctx.resume().catch(() => {});
    });
  }

  ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
    const ctx = this.ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.music = ctx.createGain();
    this.sfx = ctx.createGain();
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);
    // Shared white-noise buffer.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    this.applyVolumes();
    return ctx;
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolumes(v: Partial<{ master: number; music: number; sfx: number }>) {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.muted ? 0 : this.volumes.master;
    this.master.gain.setTargetAtTime(m, t, 0.05);
    this.music.gain.setTargetAtTime(this.volumes.music * 0.55, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
  }

  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  noiseSource(loop = true): AudioBufferSourceNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = loop;
    src.loopStart = 0;
    src.loopEnd = this.noise.duration;
    return src;
  }

  /** Simple enveloped tone into the sfx bus. */
  tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slideTo?: number; attack?: number; bus?: GainNode } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
    const peak = opts.gain ?? 0.2;
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(opts.bus ?? this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Filtered noise burst. */
  burst(dur: number, opts: { freq?: number; q?: number; type?: BiquadFilterType; gain?: number; delay?: number; sweepTo?: number } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = this.noiseSource(false);
    if (!src) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 1000, t);
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }
}

export const audio = new AudioEngine();
