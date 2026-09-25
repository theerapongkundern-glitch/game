import { Screen } from './Screen';
import type { Game } from '../../core/Game';
import { el } from '../dom';
import { CAR_DEFS, GOLD_PAINT, PAINT_SWATCHES, type CarDef } from '../../vehicles/CarDefs';
import type { GarageScene } from '../scenes/GarageScene';
import type { MenuNav } from '../../core/Input';

export interface GarageOptions {
  title: string;
  subtitle?: string;
  player: number;
  /** When set, the screen is a car picker; otherwise a free-browse garage. */
  onPick?: (carId: string, color: string) => void;
  onBack: () => void;
}

const UNLOCK_HINT: Record<string, string> = {
  bronze: 'Win the Bronze Cup (Grand Prix, Easy) to unlock',
  silver: 'Win the Silver Cup (Grand Prix, Normal) to unlock',
  gold: 'Win the Gold Cup (Grand Prix, Hard) to unlock',
};

const STAT_LABELS: [keyof CarDef['stats'], string][] = [
  ['speed', 'Top speed'],
  ['accel', 'Acceleration'],
  ['handling', 'Handling'],
  ['drift', 'Drift'],
];

/** Garage / car select: 360° turntable, stats, paint swatches, locked cars as silhouettes. */
export class GarageScreen extends Screen {
  private idx = 0;
  scene: GarageScene | null = null;
  private dragging = false;
  private lastX = 0;
  private info!: HTMLDivElement;
  private list!: HTMLDivElement;

  constructor(
    game: Game,
    private readonly opts: GarageOptions,
  ) {
    super(game, 'garage');
    const prof = game.save.data.profile;
    const startId = opts.player === 1 ? CAR_DEFS[2].id : prof.carId;
    this.idx = Math.max(0, CAR_DEFS.findIndex((c) => c.id === startId));
    this.build();
    // Drag to rotate (anywhere that isn't a panel).
    this.root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.panel, button, input')) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.root.setPointerCapture(e.pointerId);
    });
    this.root.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.scene?.spin((e.clientX - this.lastX) * 0.012);
      this.lastX = e.clientX;
    });
    const end = () => (this.dragging = false);
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);
  }

  private get def() {
    return CAR_DEFS[this.idx];
  }

  private color(): string {
    return this.game.save.colorFor(this.def.id);
  }

  private unlocked(def: CarDef) {
    return this.game.save.isCarUnlocked(def.id);
  }

  attachScene(scene: GarageScene) {
    this.scene = scene;
    scene.offsetX = window.innerWidth > 900 ? 0.0 : 0;
    this.refreshCar();
  }

  private refreshCar() {
    this.scene?.setCar(this.def, this.color(), !this.unlocked(this.def));
  }

  private build() {
    const head = el('div', { class: 'title-row' }, [
      el('div', {}, [el('h1', { text: this.opts.title }), this.opts.subtitle ? el('div', { class: 'subtitle', text: this.opts.subtitle }) : null]),
      this.button('Back', () => this.back(), 'btn small ghost'),
    ]);
    this.list = el('div', { class: 'panel col car-list' });
    this.info = el('div', { class: 'panel car-info' });
    const body = el('div', { class: 'garage-body' }, [this.list, el('div', { class: 'garage-stage' }), this.info]);
    const hints = el('div', { class: 'hint-bar', html: '<span>Drag or <kbd>Q</kbd>/<kbd>E</kbd> to rotate</span><span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> select</span><span><kbd>Esc</kbd> back</span>' });
    this.root.append(head, body, hints);
    this.renderList();
    this.renderInfo();
  }

  private renderList() {
    this.list.innerHTML = '';
    CAR_DEFS.forEach((def, i) => {
      const locked = !this.unlocked(def);
      const b = el('button', { class: 'btn car-item' + (i === this.idx ? ' selected' : ''), 'data-focus': true, 'data-car': i }, [
        el('span', { class: 'car-dot', style: `background:${locked ? '#444' : this.game.save.colorFor(def.id)}` }),
        def.name,
        locked ? el('span', { class: 'lock', text: '🔒' }) : null,
      ]);
      if (i === this.idx) b.setAttribute('data-autofocus', '');
      b.addEventListener('click', () => {
        if (this.idx === i) {
          this.confirm();
          return;
        }
        this.select(i);
      });
      b.addEventListener('focus', () => this.select(i));
      this.list.append(b);
    });
  }

  private select(i: number) {
    if (i === this.idx) return;
    this.idx = i;
    this.list.querySelectorAll('.car-item').forEach((b, k) => b.classList.toggle('selected', k === i));
    this.refreshCar();
    this.renderInfo();
    this.game.sfx('uiMove');
  }

  private renderInfo() {
    const def = this.def;
    const locked = !this.unlocked(def);
    this.info.innerHTML = '';
    this.info.append(el('h2', { text: def.name }), el('div', { class: 'subtitle', text: def.tagline }));
    const stats = el('div', { class: 'stats' });
    for (const [key, label] of STAT_LABELS) {
      const v = def.stats[key];
      stats.append(
        el('div', { class: 'stat' }, [
          el('span', { text: label }),
          el('div', { class: 'bar' }, [el('i', { style: `width:${v * 10}%` })]),
          el('b', { text: String(v) }),
        ]),
      );
    }
    stats.append(el('div', { class: 'subtitle', text: `${def.drive.toUpperCase()} · ${def.offroad > 0.6 ? 'Great off-road' : def.offroad > 0.3 ? 'Okay off-road' : 'Prefers tarmac'}` }));
    this.info.append(stats);

    if (locked) {
      this.info.append(el('div', { class: 'locked-msg', text: '🔒 ' + (UNLOCK_HINT[def.unlock] ?? 'Locked') }));
    } else {
      const sw = el('div', { class: 'swatches' });
      const swatches = [...PAINT_SWATCHES];
      if (this.game.save.data.unlocked.goldPaint) swatches.push(GOLD_PAINT);
      const current = this.color().toLowerCase();
      for (const c of swatches) {
        const b = el('button', { class: 'swatch' + (c.toLowerCase() === current ? ' on' : ''), 'data-focus': true, style: `background:${c}`, 'aria-label': `Paint ${c}` });
        if (c === GOLD_PAINT) b.classList.add('gold');
        b.addEventListener('click', () => this.paint(c));
        sw.append(b);
      }
      const custom = el('input', { type: 'color', value: current.length === 7 ? current : '#ff5a36', class: 'swatch custom', title: 'Custom colour', 'data-focus': true }) as HTMLInputElement;
      custom.addEventListener('input', () => this.paint(custom.value, false));
      custom.addEventListener('change', () => this.paint(custom.value));
      sw.append(custom);
      this.info.append(el('div', { class: 'label', text: 'Paint' }), sw);
    }
    const actions = el('div', { class: 'row', style: 'margin-top:14px' });
    if (this.opts.onPick) {
      const b = this.button(locked ? 'Locked' : 'Select car', () => this.confirm(), 'btn primary');
      if (locked) b.setAttribute('disabled', '');
      actions.append(b);
    } else {
      actions.append(this.button('Done', () => this.back(), 'btn primary'));
    }
    this.info.append(actions);
  }

  private paint(c: string, rerender = true) {
    this.game.save.data.profile.colors[this.def.id] = c;
    this.game.save.save();
    this.scene?.setColor(c);
    if (rerender) {
      this.info.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', (s as HTMLElement).style.background !== '' && rgbToHex((s as HTMLElement).style.background) === c.toLowerCase()));
      const dot = this.list.querySelectorAll<HTMLElement>('.car-dot')[this.idx];
      if (dot) dot.style.background = c;
    }
    this.game.sfx('uiMove');
  }

  private confirm() {
    const def = this.def;
    if (!this.unlocked(def)) {
      this.game.sfx('uiBack');
      this.game.toast(UNLOCK_HINT[def.unlock] ?? 'Locked');
      return;
    }
    if (this.opts.player === 0) {
      this.game.save.data.profile.carId = def.id;
      this.game.save.save();
    }
    if (this.opts.onPick) this.opts.onPick(def.id, this.color());
    else this.back();
  }

  handleNav(nav: MenuNav): boolean {
    if (nav === 'tabLeft') {
      this.scene?.spin(-0.6);
      return true;
    }
    if (nav === 'tabRight') {
      this.scene?.spin(0.6);
      return true;
    }
    return super.handleNav(nav);
  }

  update(_dt: number) {
    // Right-stick rotation on gamepads.
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p) continue;
      const rx = p.axes[2] ?? 0;
      if (Math.abs(rx) > 0.2) this.scene?.spin(rx * 0.05);
    }
  }

  back() {
    this.opts.onBack();
  }
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/\d+/g);
  if (!m) return rgb.toLowerCase();
  return '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}
