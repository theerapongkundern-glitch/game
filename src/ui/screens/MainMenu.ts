import { Screen } from './Screen';
import type { Game } from '../../core/Game';
import { el } from '../dom';
import { MODE_INFO, startFlow } from '../flow';
import { GarageScreen } from './GarageScreen';
import { SettingsScreen } from './SettingsScreen';
import { HelpScreen } from './HelpScreen';
import type { ModeId } from '../../modes/ModeRules';

const ICONS: Record<string, string> = {
  quick: '⚡',
  grandprix: '🏆',
  timetrial: '⏱',
  elimination: '🎯',
  rush: '🚩',
  split: '👥',
};

/** Animated main menu over the attract-mode race. */
export class MainMenu extends Screen {
  constructor(game: Game) {
    super(game, 'main-menu');
    const logo = el('div', { class: 'logo' }, [
      el('div', { class: 'logo-prism' }),
      el('div', { class: 'logo-text' }, [el('span', { class: 'l1', text: 'PRISM' }), el('span', { class: 'l2', text: 'RUSH' })]),
      el('div', { class: 'logo-tag', text: 'Bright, fast, drift-happy arcade racing' }),
    ]);
    const modes = el('div', { class: 'menu-list' });
    const order: Exclude<ModeId, 'free'>[] = ['quick', 'grandprix', 'timetrial', 'elimination', 'rush', 'split'];
    order.forEach((m, i) => {
      const b = this.button('', () => startFlow(game, m), 'btn menu-btn', i === 0 ? { 'data-autofocus': true } : {});
      b.innerHTML = `<span class="ico">${ICONS[m]}</span><span class="txt">${MODE_INFO[m].title}<span class="sub">${MODE_INFO[m].blurb}</span></span>`;
      b.style.animationDelay = `${0.05 + i * 0.05}s`;
      modes.append(b);
    });
    const extras = el('div', { class: 'row menu-extras' }, [
      this.button('Garage', () => this.openGarage(), 'btn small'),
      this.button('Settings', () => game.showScreen(new SettingsScreen(game, () => game.toMenu())), 'btn small'),
      this.button('How to play', () => game.showScreen(new HelpScreen(game, () => game.toMenu())), 'btn small'),
    ]);
    const cups = game.save.data.cups;
    const trophy = (name: string, won: boolean, cls: string) => el('div', { class: `cup ${cls}${won ? ' won' : ''}`, title: `${name} Cup${won ? ' — won!' : ''}` }, [el('span', { text: '🏆' }), el('small', { text: name })]);
    const side = el('div', { class: 'panel menu-side' }, [
      el('div', { class: 'label', text: 'Cups' }),
      el('div', { class: 'row cups' }, [trophy('Bronze', cups.bronze.won, 'bronze'), trophy('Silver', cups.silver.won, 'silver'), trophy('Gold', cups.gold.won, 'gold')]),
      el('div', { class: 'subtitle', text: `Races ${game.save.data.stats.races} · Wins ${game.save.data.stats.wins}` }),
    ]);
    const left = el('div', { class: 'menu-left' }, [logo, modes, extras]);
    this.root.append(left, side);
    this.root.append(
      el('div', {
        class: 'hint-bar menu-hints',
        html: '<span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> select</span><span>🎮 Gamepad &amp; touch supported</span>',
      }),
    );
  }

  private openGarage() {
    this.game.showGarage(
      new GarageScreen(this.game, {
        title: 'Garage',
        subtitle: 'Spin it, paint it, love it',
        player: 0,
        onBack: () => this.game.toMenu(),
      }),
    );
  }

  back() {
    /* already at the top */
  }
}
