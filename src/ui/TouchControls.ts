import type { Input } from '../core/Input';
import { el } from './dom';

/**
 * On-screen touch controls (multi-touch via pointer events): steer left/right on the
 * left thumb, gas/brake/drift/boost on the right thumb, pause & camera at the top.
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly held = new Map<number, string>();

  constructor(
    private readonly input: Input,
    parent: HTMLElement,
  ) {
    this.root = el('div', { class: 'touch-controls' });
    const mk = (id: string, label: string, cls: string) => {
      const b = el('div', { class: `tbtn ${cls}`, 'data-id': id }, [el('span', { text: label })]);
      b.addEventListener('pointerdown', (e) => this.down(e, id, b));
      b.addEventListener('pointerup', (e) => this.up(e, b));
      b.addEventListener('pointercancel', (e) => this.up(e, b));
      b.addEventListener('pointerleave', (e) => this.up(e, b));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    this.root.append(
      el('div', { class: 'tgroup left' }, [mk('left', '◀', 'steer'), mk('right', '▶', 'steer')]),
      el('div', { class: 'tgroup right' }, [
        el('div', { class: 'tcol' }, [mk('boost', 'BOOST', 'small boost'), mk('drift', 'DRIFT', 'small drift')]),
        el('div', { class: 'tcol' }, [mk('gas', 'GO', 'gas'), mk('brake', 'BRAKE', 'small brake')]),
      ]),
      el('div', { class: 'tgroup top' }, [mk('camera', '📷', 'tiny'), mk('pause', '❚❚', 'tiny')]),
    );
    parent.append(this.root);
    this.hide();
  }

  private down(e: PointerEvent, id: string, b: HTMLElement) {
    e.preventDefault();
    this.input.lastDevice = 'touch';
    this.input.touch.active = true;
    b.setPointerCapture?.(e.pointerId);
    this.held.set(e.pointerId, id);
    b.classList.add('on');
    if (id === 'camera') this.input.touch.cameraPressed = true;
    if (id === 'pause') this.input.touch.pausePressed = true;
    this.sync();
  }

  private up(e: PointerEvent, b: HTMLElement) {
    if (!this.held.has(e.pointerId)) return;
    this.held.delete(e.pointerId);
    b.classList.remove('on');
    this.sync();
  }

  private sync() {
    const ids = new Set(this.held.values());
    const t = this.input.touch;
    t.steer = (ids.has('right') ? 1 : 0) - (ids.has('left') ? 1 : 0);
    t.throttle = ids.has('gas') ? 1 : 0;
    t.brake = ids.has('brake') ? 1 : 0;
    t.handbrake = ids.has('drift');
    t.boost = ids.has('boost');
  }

  show() {
    this.root.classList.remove('hidden');
    this.root.parentElement?.classList.add('touch-on');
    this.input.touch.active = true;
  }

  hide() {
    this.root.classList.add('hidden');
    this.root.parentElement?.classList.remove('touch-on');
    this.held.clear();
    this.sync();
  }
}

export function isTouchDevice(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}
