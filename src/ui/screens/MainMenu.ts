import { Screen } from './Screen';
import type { Game } from '../../core/Game';
import { el } from '../dom';
import { TRACKS } from '../../tracks';
import { CAR_DEFS } from '../../vehicles/CarDefs';
import { QuickRace } from '../../modes/QuickRace';
import type { Difficulty } from '../../modes/ModeRules';

/** Main menu (quick-race launcher; expanded with modes, garage and settings later). */
export class MainMenu extends Screen {
  private trackIdx = 0;
  private carIdx = 0;
  private difficulty: Difficulty;

  constructor(game: Game) {
    super(game, 'main-menu dim');
    const prof = game.save.data.profile;
    this.trackIdx = Math.max(0, TRACKS.findIndex((t) => t.id === prof.trackId));
    this.carIdx = Math.max(0, CAR_DEFS.findIndex((c) => c.id === prof.carId));
    this.difficulty = prof.difficulty;
    this.render();
  }

  private render() {
    this.root.innerHTML = '';
    const track = TRACKS[this.trackIdx];
    const car = CAR_DEFS[this.carIdx];
    const box = el('div', { class: 'panel col', style: 'margin:auto;min-width:360px;gap:14px' });
    box.append(el('h1', { text: 'Prism Rush' }), el('div', { class: 'subtitle', text: 'Quick Race' }));
    const mk = (label: string, value: string, onLr: (d: number) => void) => {
      const f = el('div', { class: 'field', 'data-focus': true, 'data-lr': true, tabindex: 0 }, [el('label', { text: label }), el('b', { text: `‹ ${value} ›` })]);
      f.addEventListener('lr', (e) => onLr((e as CustomEvent).detail));
      f.addEventListener('click', () => onLr(1));
      return f;
    };
    box.append(
      mk('Track', track.name, (d) => {
        this.trackIdx = (this.trackIdx + d + TRACKS.length) % TRACKS.length;
        this.render();
      }),
      mk('Car', car.name, (d) => {
        this.carIdx = (this.carIdx + d + CAR_DEFS.length) % CAR_DEFS.length;
        this.render();
      }),
      mk('Difficulty', this.difficulty, (d) => {
        const list: Difficulty[] = ['easy', 'normal', 'hard'];
        this.difficulty = list[(list.indexOf(this.difficulty) + d + 3) % 3];
        this.render();
      }),
    );
    box.append(
      this.button(
        'Start race',
        () => {
          const prof = this.game.save.data.profile;
          prof.trackId = track.id;
          prof.carId = car.id;
          prof.difficulty = this.difficulty;
          this.game.save.save();
          new QuickRace(this.game, { trackId: track.id, carId: car.id, color: this.game.save.colorFor(car.id), difficulty: this.difficulty, laps: 3 }).begin();
        },
        'btn primary',
        { 'data-autofocus': true },
      ),
    );
    this.root.append(box);
    requestAnimationFrame(() => this.nav.focusFirst());
  }
}
