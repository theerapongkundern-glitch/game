import { FocusNav } from '../FocusNav';
import type { MenuNav } from '../../core/Input';
import type { Game } from '../../core/Game';
import { el } from '../dom';

/** Base class for DOM menu screens with keyboard/gamepad focus navigation. */
export abstract class Screen {
  readonly root: HTMLDivElement;
  protected nav: FocusNav;

  constructor(
    protected readonly game: Game,
    cls: string,
  ) {
    this.root = el('div', { class: `screen ${cls}` });
    this.nav = new FocusNav(this.root, () => game.sfx('uiMove'));
    this.root.addEventListener('pointerover', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-focus]');
      if (t && this.root.contains(t) && t !== this.nav.current) this.nav.focus(t);
    });
  }

  mount(parent: HTMLElement) {
    parent.append(this.root);
    requestAnimationFrame(() => {
      this.root.classList.add('in');
      this.nav.focusFirst();
    });
    this.onShow();
  }

  unmount() {
    this.onHide();
    this.root.remove();
  }

  /** Menu navigation; return true if handled. */
  handleNav(nav: MenuNav): boolean {
    if (nav === 'back') {
      this.back();
      return true;
    }
    return this.nav.handle(nav);
  }

  protected onShow() {}
  protected onHide() {}
  /** Called on Escape / B. */
  back() {}
  update(_dt: number) {}

  /** Helper to build a focusable button. */
  protected button(label: string, onClick: () => void, cls = 'btn', attrs: Record<string, string | boolean> = {}): HTMLButtonElement {
    const b = el('button', { class: cls, 'data-focus': true, type: 'button', ...attrs }, [label]);
    b.addEventListener('click', () => {
      this.game.sfx('ui');
      onClick();
    });
    return b;
  }
}
