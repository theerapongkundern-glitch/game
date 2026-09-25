/**
 * requestAnimationFrame loop with a fixed-timestep simulation (120 Hz) and render
 * interpolation. `timeScale` lets automated tests fast-forward races.
 */
export class Loop {
  static readonly STEP = 1 / 120;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  timeScale = 1;
  /** Max simulation steps per frame (prevents the spiral of death). */
  maxSteps = 12;
  frameTime = 0;
  fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(
    private readonly fixedUpdate: (dt: number) => void,
    private readonly render: (alpha: number, frameDt: number) => void,
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.last = -1;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    if (this.last < 0) this.last = now;
    let dt = (now - this.last) / 1000;
    this.last = now;
    // rAF timestamps can precede the moment start() ran; clamp both ways.
    if (dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1; // tab was hidden or a long hitch
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    const t0 = performance.now();
    this.acc += dt * this.timeScale;
    const maxSteps = this.maxSteps * Math.max(1, Math.ceil(this.timeScale));
    let steps = 0;
    while (this.acc >= Loop.STEP && steps < maxSteps) {
      this.fixedUpdate(Loop.STEP);
      this.acc -= Loop.STEP;
      steps++;
    }
    if (steps >= maxSteps) this.acc = 0;
    this.render(this.acc / Loop.STEP, dt * this.timeScale);
    this.frameTime = performance.now() - t0;
  };
}
