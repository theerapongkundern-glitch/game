import { Screen } from './Screen';
import type { Game } from '../../core/Game';
import { el } from '../dom';
import type { CupId } from '../../core/Save';
import type { Difficulty } from '../../modes/ModeRules';
import { TRACKS } from '../../tracks';
import { CAR_DEFS } from '../../vehicles/CarDefs';

export interface CupSelectOptions {
  onPick: (cup: CupId, difficulty: Difficulty) => void;
  onBack: () => void;
}

export const CUPS: { id: CupId; name: string; difficulty: Difficulty; color: string }[] = [
  { id: 'bronze', name: 'Bronze Cup', difficulty: 'easy', color: '#d98a4a' },
  { id: 'silver', name: 'Silver Cup', difficulty: 'normal', color: '#cfd6e6' },
  { id: 'gold', name: 'Gold Cup', difficulty: 'hard', color: '#ffcf40' },
];

/** Grand Prix cup choice; each cup is the 4-track series at a difficulty with its own prize. */
export class CupSelectScreen extends Screen {
  constructor(
    game: Game,
    private readonly opts: CupSelectOptions,
  ) {
    super(game, 'cup-select dim');
    const save = game.save.data;
    const head = el('div', { class: 'title-row' }, [
      el('div', {}, [el('h1', { text: 'Grand Prix' }), el('div', { class: 'subtitle', text: `4 races: ${TRACKS.map((t) => t.name).join(' → ')}. Points 10/8/6/4/2/1.` })]),
      this.button('Back', () => this.back(), 'btn small ghost'),
    ]);
    const grid = el('div', { class: 'cup-grid' });
    CUPS.forEach((c, i) => {
      const prize = [
        ...CAR_DEFS.filter((d) => d.unlock === c.id).map((d) => d.name),
        ...TRACKS.filter((t) => (t.id === 'neon-nightway' && c.id === 'bronze') || (t.id === 'sunstone-canyon' && c.id === 'silver')).map((t) => t.name),
        ...(c.id === 'gold' ? ['Gold paint'] : []),
      ];
      const won = save.cups[c.id].won;
      const best = save.cups[c.id].bestPlace;
      const b = el('button', { class: 'btn cup-card', 'data-focus': true, style: `--cup:${c.color}` }, [
        el('div', { class: 'cup-icon', text: '🏆' }),
        el('div', { class: 'cup-name', text: c.name }),
        el('div', { class: 'sub', text: `Difficulty: ${c.difficulty[0].toUpperCase() + c.difficulty.slice(1)}` }),
        el('div', { class: 'sub', text: `Prize: ${prize.join(', ')}` }),
        el('div', { class: 'sub', text: won ? '✔ Won!' : best ? `Best finish: ${best}${best === 2 ? 'nd' : best === 3 ? 'rd' : 'th'}` : 'Not raced yet' }),
      ]);
      if (i === 0 || (!won && CUPS.slice(0, i).every((p) => save.cups[p.id].won))) b.setAttribute('data-autofocus', '');
      b.addEventListener('click', () => {
        game.sfx('ui');
        this.opts.onPick(c.id, c.difficulty);
      });
      grid.append(b);
    });
    this.root.append(head, grid, el('div', { class: 'hint-bar', html: '<span>Finish 1st overall to win the cup and its prizes.</span>' }));
  }

  back() {
    this.opts.onBack();
  }
}
