import { Screen } from './Screen';
import type { Game } from '../../core/Game';
import type { GPStanding } from '../../modes/GrandPrix';
import type { CupId } from '../../core/Save';
import { el, escapeHtml } from '../dom';
import { ordinal } from '../../core/math';

/** Final Grand Prix podium: trophies, final table and unlock announcements. */
export class PodiumScreen extends Screen {
  constructor(
    game: Game,
    readonly order: GPStanding[],
    cup: CupId,
    myPlace: number,
    unlocked: string[],
  ) {
    super(game, 'podium');
    const cupName = cup[0].toUpperCase() + cup.slice(1);
    const title = myPlace === 1 ? `${cupName} Cup Champion!` : myPlace <= 3 ? `${ordinal(myPlace)} place — on the podium!` : `You finished ${ordinal(myPlace)}`;
    const head = el('div', { class: 'podium-head' }, [el('h1', { text: title }), el('div', { class: 'subtitle', text: myPlace === 1 ? 'The crowd goes wild! 🎉' : 'Win the cup to unlock its prizes — try again!' })]);
    const table = el('div', { class: 'panel podium-table' });
    this.order.forEach((s, i) => {
      table.append(
        el('div', { class: 'podium-row' + (s.isHuman ? ' me' : '') }, [
          el('b', { text: ordinal(i + 1) }),
          el('span', { html: `<span class="swatch-dot" style="background:${s.color}"></span>${escapeHtml(s.name)}` }),
          el('b', { text: `${s.points} pts` }),
        ]),
      );
    });
    const side = el('div', { class: 'podium-side' }, [table]);
    if (unlocked.length) {
      side.append(el('div', { class: 'panel unlock-panel' }, [el('div', { class: 'label', text: 'Unlocked!' }), ...unlocked.map((u) => el('div', { class: 'unlock-item', text: '✨ ' + u }))]));
      setTimeout(() => game.sfx('unlock'), 900);
    }
    side.append(el('div', { class: 'row', style: 'justify-content:flex-end' }, [this.button('Continue', () => game.toMenu(), 'btn primary', { 'data-autofocus': true })]));
    this.root.append(head, side);
  }

  back() {
    this.game.toMenu();
  }
}
