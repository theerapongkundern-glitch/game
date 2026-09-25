import type { Track } from '../tracks/Track';

export interface MinimapDot {
  x: number;
  z: number;
  color: string;
  me: boolean;
  heading: number;
  hidden?: boolean;
}

/** Canvas minimap: the track outline is pre-rendered once; dots are drawn each frame. */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private scale = 1;
  private cx = 0;
  private cz = 0;
  private readonly size: number;
  private readonly dpr: number;

  constructor(readonly track: Track, size = 180, opts: { rotate?: boolean } = {}) {
    void opts;
    this.size = size;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas = document.createElement('canvas');
    this.canvas.width = size * this.dpr;
    this.canvas.height = size * this.dpr;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.ctx = this.canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = this.canvas.width;
    this.base.height = this.canvas.height;
    this.drawBase();
  }

  private toMap(x: number, z: number): [number, number] {
    const s = this.size * this.dpr;
    // Map world +X to the left so the map matches the driver's view (left-handed screen).
    return [s / 2 - (x - this.cx) * this.scale, s / 2 - (z - this.cz) * this.scale];
  }

  private drawBase() {
    const b = this.track.bounds;
    const w = b.maxX - b.minX;
    const h = b.maxZ - b.minZ;
    this.cx = (b.minX + b.maxX) / 2;
    this.cz = (b.minZ + b.maxZ) / 2;
    const s = this.size * this.dpr;
    this.scale = (s * 0.78) / Math.max(w, h);
    const ctx = this.base.getContext('2d')!;
    ctx.clearRect(0, 0, s, s);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const drawPath = (pathIdx: number, width: number, color: string) => {
      const p = this.track.paths[pathIdx];
      ctx.beginPath();
      for (let i = 0; i < p.n; i += 2) {
        const [x, y] = this.toMap(p.px[i], p.pz[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      if (p.closed) ctx.closePath();
      else {
        const [x, y] = this.toMap(p.px[p.n - 1], p.pz[p.n - 1]);
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    for (let i = 1; i < this.track.paths.length; i++) {
      drawPath(i, 7 * this.dpr, 'rgba(27,20,70,0.8)');
      drawPath(i, 3.5 * this.dpr, 'rgba(255,210,63,0.75)');
    }
    drawPath(0, 9 * this.dpr, 'rgba(27,20,70,0.85)');
    drawPath(0, 5 * this.dpr, '#ffffff');
    // Start line.
    const m = this.track.main;
    const [sx, sy] = this.toMap(m.px[0], m.pz[0]);
    ctx.fillStyle = '#ff4fa3';
    ctx.beginPath();
    ctx.arc(sx, sy, 4 * this.dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  draw(dots: MinimapDot[]) {
    const ctx = this.ctx;
    const s = this.size * this.dpr;
    ctx.clearRect(0, 0, s, s);
    ctx.drawImage(this.base, 0, 0);
    // Others first, then me on top.
    for (const pass of [false, true]) {
      for (const d of dots) {
        if (d.me !== pass || d.hidden) continue;
        const [x, y] = this.toMap(d.x, d.z);
        if (d.me) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(-d.heading);
          ctx.beginPath();
          const r = 7 * this.dpr;
          ctx.moveTo(0, -r * 1.3);
          ctx.lineTo(r, r);
          ctx.lineTo(-r, r);
          ctx.closePath();
          ctx.fillStyle = d.color;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5 * this.dpr;
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, 4.2 * this.dpr, 0, Math.PI * 2);
          ctx.fillStyle = d.color;
          ctx.fill();
          ctx.lineWidth = 1.5 * this.dpr;
          ctx.strokeStyle = 'rgba(27,20,70,0.9)';
          ctx.stroke();
        }
      }
    }
  }
}
