import { Screen } from './Screen';
import type { Game } from '../../core/Game';
import { el } from '../dom';
import { keyLabel } from '../../core/Input';

/** Controls & tips. */
export class HelpScreen extends Screen {
  constructor(
    game: Game,
    private readonly onDone: () => void,
  ) {
    super(game, 'help dim');
    const b = game.save.data.settings.bindings;
    const k = (p: number, a: keyof (typeof b)[0]) => b[p][a].map(keyLabel).join(' / ');
    const row = (label: string, kb: string, pad: string, touch: string) => el('tr', {}, [el('td', { text: label }), el('td', { html: kb }), el('td', { text: pad }), el('td', { text: touch })]);
    const table = el('table', { class: 'results-table help-table' }, [
      el('tr', {}, [el('th', { text: 'Action' }), el('th', { text: 'Keyboard' }), el('th', { text: 'Gamepad' }), el('th', { text: 'Touch' })]),
      row('Accelerate', `<kbd>${k(0, 'up')}</kbd> <kbd>${k(1, 'up')}</kbd>`, 'RT', 'GO button'),
      row('Brake / reverse', `<kbd>${k(0, 'down')}</kbd> <kbd>${k(1, 'down')}</kbd>`, 'LT', 'BRAKE button'),
      row('Steer', `<kbd>${k(0, 'left')}</kbd><kbd>${k(0, 'right')}</kbd> <kbd>${k(1, 'left')}</kbd><kbd>${k(1, 'right')}</kbd>`, 'Left stick / D-pad', '◀ ▶ buttons'),
      row('Handbrake / drift', `<kbd>${k(0, 'handbrake')}</kbd>`, 'A', 'DRIFT button'),
      row('Boost', `<kbd>${k(0, 'boost')}</kbd> <kbd>${k(1, 'boost')}</kbd>`, 'B / RB', 'BOOST button'),
      row('Camera', `<kbd>${k(0, 'camera')}</kbd>`, 'Y', '📷 button'),
      row('Look back', `<kbd>${k(0, 'lookback')}</kbd>`, '—', '—'),
      row('Reset to track', `<kbd>${k(0, 'reset')}</kbd>`, 'Back / View', '—'),
      row('Pause', `<kbd>${k(0, 'pause')}</kbd>`, 'Start', '❚❚ button'),
    ]);
    const tips = el('ul', { class: 'tips' }, [
      el('li', { text: 'Tap the handbrake while turning to start a drift. Steer into the corner to tighten it, straighten the wheel to exit.' }),
      el('li', { text: 'Drifting and slipstreaming behind rivals fill your boost bar. Hold boost on straights!' }),
      el('li', { text: 'Press and hold throttle just before GO for a perfect start.' }),
      el('li', { text: 'Sand and grass slow you down, wet roads are slippery, rainbow pads give a free boost.' }),
      el('li', { text: 'Split-screen: Player 1 uses WASD + Space + Left Shift, Player 2 uses the arrow keys + Right Ctrl + Right Shift.' }),
    ]);
    const panel = el('div', { class: 'panel', style: 'max-width:900px;margin:0 auto;width:100%' }, [table, tips]);
    this.root.append(el('div', { class: 'title-row' }, [el('h1', { text: 'How to play' })]), panel, el('div', { class: 'row', style: 'justify-content:center;margin-top:14px' }, [this.button('Got it!', () => this.back(), 'btn primary', { 'data-autofocus': true })]));
  }

  back() {
    this.onDone();
  }
}
