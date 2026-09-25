import { el, svg } from './dom';
import { Minimap, type MinimapDot } from './Minimap';
import type { Track } from '../tracks/Track';
import { formatTime, ordinal } from '../core/math';

export interface HudRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StandingRow {
  name: string;
  color: string;
  me: boolean;
  out?: boolean;
  extra?: string;
}

const R_SPEED = 86;
const R_BOOST = 70;
const C_SPEED = 2 * Math.PI * R_SPEED;
const C_BOOST = 2 * Math.PI * R_BOOST;
const SWEEP = 0.75; // 270°

let gradId = 0;

/** Per-player race HUD (DOM + SVG + a minimap canvas). */
export class HUD {
  readonly root: HTMLDivElement;
  private readonly posEl: HTMLDivElement;
  private readonly lapEl: HTMLDivElement;
  private readonly timeMain: HTMLDivElement;
  private readonly timeLap: HTMLElement;
  private readonly timeBest: HTMLElement;
  private readonly deltaEl: HTMLDivElement;
  private readonly speedNum: HTMLDivElement;
  private readonly unitEl: HTMLDivElement;
  private readonly gearEl: HTMLDivElement;
  private readonly speedArc: SVGCircleElement;
  private readonly boostArc: SVGCircleElement;
  private readonly boostLabel: HTMLDivElement;
  private readonly centerMsg: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private readonly popups: HTMLDivElement;
  private readonly standingsEl: HTMLDivElement;
  private readonly rushEl: HTMLDivElement;
  private readonly minimap: Minimap | null;
  private msgTimer = 0;
  private lastPos = '';
  private lastLap = '';
  private lastStand = '';
  private lastSpeed = -1;
  units: 'kmh' | 'mph';

  constructor(parent: HTMLElement, rect: HudRect, track: Track | null, opts: { compact?: boolean; units?: 'kmh' | 'mph'; minimap?: boolean } = {}) {
    this.units = opts.units ?? 'kmh';
    this.root = el('div', { class: 'hud' + (opts.compact ? ' compact' : '') });
    this.setRect(rect);
    this.posEl = el('div', { class: 'pos' });
    this.lapEl = el('div', { class: 'lap' });
    const tl = el('div', { class: 'tl' }, [this.posEl, this.lapEl]);
    this.timeMain = el('div', { class: 'time-main', text: '0:00.000' });
    this.timeLap = el('b', { text: '--' });
    this.timeBest = el('b', { text: '--' });
    this.deltaEl = el('div', { class: 'delta' });
    const tr = el('div', { class: 'tr' }, [
      this.timeMain,
      el('div', { class: 'time-row' }, ['LAP', this.timeLap]),
      el('div', { class: 'time-row' }, ['BEST', this.timeBest]),
      this.deltaEl,
    ]);

    // Speedometer.
    const gid = `spg${gradId++}`;
    const defs = svg('defs', {}, [
      svg('linearGradient', { id: gid, x1: '0', y1: '1', x2: '1', y2: '0' }, [
        svg('stop', { offset: '0', 'stop-color': '#3de0ff' }),
        svg('stop', { offset: '0.6', 'stop-color': '#ff4fa3' }),
        svg('stop', { offset: '1', 'stop-color': '#ffd23f' }),
      ]),
    ]);
    const arc = (r: number, c: number, color: string, width: number, opacity = 1) =>
      svg('circle', {
        cx: 100,
        cy: 100,
        r,
        fill: 'none',
        stroke: color,
        'stroke-width': width,
        'stroke-linecap': 'round',
        'stroke-dasharray': `${c * SWEEP} ${c}`,
        transform: 'rotate(135 100 100)',
        opacity,
      });
    const bgSpeed = arc(R_SPEED, C_SPEED, 'rgba(27,20,70,0.55)', 16);
    const bgBoost = arc(R_BOOST, C_BOOST, 'rgba(27,20,70,0.55)', 9);
    this.speedArc = arc(R_SPEED, C_SPEED, `url(#${gid})`, 12);
    this.boostArc = arc(R_BOOST, C_BOOST, '#3de0ff', 7);
    const ticks: SVGElement[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = ((135 + i * 27) * Math.PI) / 180;
      const r1 = 96;
      const r2 = i % 5 === 0 ? 104 : 100;
      ticks.push(
        svg('line', {
          x1: 100 + Math.cos(a) * r1,
          y1: 100 + Math.sin(a) * r1,
          x2: 100 + Math.cos(a) * r2,
          y2: 100 + Math.sin(a) * r2,
          stroke: 'rgba(255,255,255,0.8)',
          'stroke-width': i % 5 === 0 ? 3 : 2,
          'stroke-linecap': 'round',
        }),
      );
    }
    const svgEl = svg('svg', { viewBox: '0 0 200 200' }, [defs, bgSpeed, bgBoost, this.speedArc, this.boostArc, ...ticks]);
    this.speedNum = el('div', { class: 'num', text: '0' });
    this.unitEl = el('div', { class: 'unit', text: this.units === 'mph' ? 'MPH' : 'KM/H' });
    this.gearEl = el('div', { class: 'gear', text: '1' });
    this.boostLabel = el('div', { class: 'boost-label', text: 'BOOST' });
    const speedo = el('div', { class: 'speedo' });
    speedo.append(svgEl, this.speedNum, this.unitEl, this.gearEl, this.boostLabel);

    this.centerMsg = el('div', { class: 'center-msg' });
    this.countdownEl = el('div', { class: 'countdown' });
    this.popups = el('div', { class: 'popups' });
    this.standingsEl = el('div', { class: 'standings' });
    this.rushEl = el('div', { class: 'rush-timer hidden' });
    this.root.append(tl, tr, speedo, this.centerMsg, this.countdownEl, this.popups, this.standingsEl, this.rushEl);

    if (track && opts.minimap !== false) {
      this.minimap = new Minimap(track, opts.compact ? 120 : 180);
      const mm = el('div', { class: 'minimap' });
      mm.append(this.minimap.canvas);
      this.root.append(mm);
    } else this.minimap = null;
    parent.append(this.root);
  }

  setRect(r: HudRect) {
    this.root.style.left = `${r.x * 100}%`;
    this.root.style.top = `${r.y * 100}%`;
    this.root.style.width = `${r.w * 100}%`;
    this.root.style.height = `${r.h * 100}%`;
  }

  setUnits(u: 'kmh' | 'mph') {
    this.units = u;
    this.unitEl.textContent = u === 'mph' ? 'MPH' : 'KM/H';
  }

  setPosition(pos: number, total: number) {
    const key = `${pos}/${total}`;
    if (key === this.lastPos) return;
    this.lastPos = key;
    if (pos <= 0) {
      this.posEl.innerHTML = '';
      return;
    }
    const o = ordinal(pos);
    const num = o.slice(0, -2);
    const suf = o.slice(-2);
    this.posEl.innerHTML = `${num}<small>${suf}</small><span class="pos-of">/${total}</span>`;
  }

  setLap(lap: number, total: number, label = 'LAP') {
    const key = `${label}${lap}/${total}`;
    if (key === this.lastLap) return;
    this.lastLap = key;
    if (total <= 0) {
      this.lapEl.innerHTML = lap > 0 ? `<span>${label}</span>${lap}` : '';
      return;
    }
    this.lapEl.innerHTML = `<span>${label}</span>${Math.min(lap, total)}/${total}`;
  }

  setTimes(total: number, lap: number, best: number) {
    this.timeMain.textContent = formatTime(total);
    this.timeLap.textContent = formatTime(lap);
    this.timeBest.textContent = isFinite(best) && best > 0 ? formatTime(best) : '--';
  }

  setDelta(delta: number | null) {
    if (delta === null) {
      this.deltaEl.textContent = '';
      return;
    }
    const s = (delta >= 0 ? '+' : '−') + Math.abs(delta).toFixed(2);
    this.deltaEl.textContent = s;
    this.deltaEl.className = 'delta ' + (delta <= 0 ? 'good' : 'bad');
  }

  setSpeed(speedMs: number, topSpeed: number, gear: number, boost: number, boosting: boolean) {
    const v = this.units === 'mph' ? speedMs * 2.23694 : speedMs * 3.6;
    const shown = Math.round(Math.abs(v));
    if (shown !== this.lastSpeed) {
      this.speedNum.textContent = String(shown);
      this.lastSpeed = shown;
    }
    const frac = Math.min(1, Math.abs(speedMs) / (topSpeed * 1.25));
    this.speedArc.setAttribute('stroke-dasharray', `${C_SPEED * SWEEP * frac} ${C_SPEED}`);
    this.boostArc.setAttribute('stroke-dasharray', `${C_BOOST * SWEEP * boost} ${C_BOOST}`);
    this.boostArc.setAttribute('stroke', boosting ? '#ffd23f' : boost > 0.98 ? '#a4e635' : '#3de0ff');
    this.gearEl.textContent = speedMs < -0.5 ? 'R' : String(gear);
    const ready = boost > 0.25;
    this.boostLabel.classList.toggle('ready', ready && !boosting);
    this.boostLabel.textContent = boosting ? 'BOOSTING!' : ready ? 'BOOST READY' : 'BOOST';
  }

  setMinimap(dots: MinimapDot[]) {
    this.minimap?.draw(dots);
  }

  showCountdown(text: string, go = false) {
    this.countdownEl.textContent = text;
    this.countdownEl.classList.remove('pop', 'go');
    void this.countdownEl.offsetWidth; // restart animation
    this.countdownEl.classList.add('pop');
    if (go) this.countdownEl.classList.add('go');
  }

  message(text: string, seconds = 1.8, cls = '') {
    this.centerMsg.textContent = text;
    this.centerMsg.className = 'center-msg show ' + cls;
    this.msgTimer = seconds;
  }

  clearMessage() {
    this.msgTimer = 0;
    this.centerMsg.className = 'center-msg';
  }

  popup(text: string, cls = '') {
    const p = el('div', { class: 'popup ' + cls, text });
    this.popups.append(p);
    setTimeout(() => p.remove(), 1400);
  }

  setStandings(rows: StandingRow[]) {
    const key = rows.map((r) => r.name + (r.out ? 'x' : '') + (r.extra ?? '')).join('|');
    if (key === this.lastStand) return;
    this.lastStand = key;
    this.standingsEl.innerHTML = '';
    rows.forEach((r, i) => {
      const d = el('div', { class: (r.me ? 'me' : '') + (r.out ? ' out' : '') });
      const dot = el('i');
      dot.style.background = r.color;
      d.append(`${i + 1}.`, dot, r.name + (r.extra ? ` ${r.extra}` : ''));
      this.standingsEl.append(d);
    });
  }

  setRushTimer(seconds: number | null) {
    if (seconds === null) {
      this.rushEl.classList.add('hidden');
      return;
    }
    this.rushEl.classList.remove('hidden');
    this.rushEl.textContent = Math.max(0, seconds).toFixed(1);
    this.rushEl.classList.toggle('low', seconds < 5);
  }

  update(dt: number) {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.centerMsg.className = 'center-msg';
    }
  }

  destroy() {
    this.root.remove();
  }
}
