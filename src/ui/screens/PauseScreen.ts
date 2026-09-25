import { Screen } from './Screen';
import type { Game } from '../../core/Game';
import { el } from '../dom';

/** In-race pause menu. */
export class PauseScreen extends Screen {
  constructor(game: Game) {
    super(game, 'pause dim');
    const box = el('div', { class: 'panel col', style: 'margin:auto;min-width:320px;align-items:stretch;gap:12px' });
    box.append(el('h1', { text: 'Paused', style: 'text-align:center;margin-bottom:8px' }));
    box.append(this.button('Resume', () => game.resume(), 'btn primary', { 'data-autofocus': true }));
    box.append(this.button('Restart race', () => game.restartRace()));
    box.append(
      this.button('Settings', () => {
        import('./SettingsScreen')
          .then(({ SettingsScreen }) => game.showScreen(new SettingsScreen(game, () => game.showScreen(new PauseScreen(game)))))
          .catch(() => game.toast('Settings are not available yet'));
      }),
    );
    box.append(this.button('Quit to menu', () => game.quitRace()));
    const hints = el('div', { class: 'hint-bar', html: '<span><kbd>Esc</kbd> / <kbd>P</kbd> resume</span><span><kbd>R</kbd> reset car</span><span><kbd>C</kbd> camera</span>' });
    box.append(hints);
    this.root.append(box);
  }

  back() {
    this.game.resume();
  }
}
