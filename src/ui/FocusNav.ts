import type { MenuNav } from '../core/Input';

/**
 * Spatial focus navigation for menus (keyboard arrows / gamepad D-pad). Any element with
 * `data-focus` inside the root is focusable; confirm clicks it. Elements with
 * `data-left` / `data-right` handlers (set via onLeftRight) receive left/right instead of moving.
 */
export class FocusNav {
  current: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly onMove?: () => void,
  ) {}

  items(): HTMLElement[] {
    return Array.from(this.root.querySelectorAll<HTMLElement>('[data-focus]')).filter((e) => e.offsetParent !== null && !e.hasAttribute('disabled'));
  }

  focus(el: HTMLElement | null) {
    if (this.current) this.current.classList.remove('focused');
    this.current = el;
    if (el) {
      el.classList.add('focused');
      el.focus({ preventScroll: true });
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }

  focusFirst() {
    const items = this.items();
    const pref = items.find((e) => e.hasAttribute('data-autofocus')) ?? items[0] ?? null;
    this.focus(pref);
  }

  /** Returns true if the nav event was consumed. */
  handle(nav: MenuNav): boolean {
    const items = this.items();
    if (!items.length) return false;
    if (!this.current || !items.includes(this.current)) {
      this.focusFirst();
      if (nav !== 'confirm') return true;
    }
    const cur = this.current!;
    if (nav === 'confirm') {
      cur.click();
      return true;
    }
    if ((nav === 'left' || nav === 'right') && cur.dataset.lr !== undefined) {
      cur.dispatchEvent(new CustomEvent('lr', { detail: nav === 'left' ? -1 : 1 }));
      this.onMove?.();
      return true;
    }
    if (nav === 'back' || nav === 'tabLeft' || nav === 'tabRight') return false;
    const r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2;
    const cy = r0.top + r0.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const dx = x - cx;
      const dy = y - cy;
      let primary: number;
      let secondary: number;
      switch (nav) {
        case 'up':
          if (dy >= -2) continue;
          primary = -dy;
          secondary = Math.abs(dx);
          break;
        case 'down':
          if (dy <= 2) continue;
          primary = dy;
          secondary = Math.abs(dx);
          break;
        case 'left':
          if (dx >= -2) continue;
          primary = -dx;
          secondary = Math.abs(dy);
          break;
        default:
          if (dx <= 2) continue;
          primary = dx;
          secondary = Math.abs(dy);
      }
      const score = primary + secondary * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) {
      this.focus(best);
      this.onMove?.();
    }
    return true;
  }
}
