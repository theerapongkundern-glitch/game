import { Screen } from './Screen';
import type { Game } from '../../core/Game';
import type { RaceSession } from '../../modes/RaceSession';
import { el, escapeHtml } from '../dom';
import { formatTime, ordinal } from '../../core/math';

export interface ResultsOptions {
  title: string;
  newRecord?: boolean;
  onRestart?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  /** Extra column (e.g. GP points). */
  extra?: { label: string; value: (carIndex: number) => string };
  note?: string;
}

/** Final classification after a race. */
export class ResultsScreen extends Screen {
  constructor(game: Game, session: RaceSession, opts: ResultsOptions) {
    super(game, 'results dim');
    const sim = session.sim;
    const ranking = sim.ranking();
    const humans = sim.humanCars;
    const me = humans[0];

    const head = el('div', { class: 'title-row' }, [
      el('div', {}, [
        el('h1', { text: opts.title }),
        el('div', { class: 'subtitle', html: `${escapeHtml(session.config.track.name)} · ${session.rules.laps} laps${opts.newRecord ? '<span class="badge">NEW RECORD</span>' : ''}` }),
      ]),
    ]);
    const table = el('table', { class: 'results-table' });
    const header = el('tr', {}, [el('th', { text: 'Pos' }), el('th', { text: 'Driver' }), el('th', { text: 'Car' }), el('th', { text: 'Time' }), el('th', { text: 'Best lap' })]);
    if (opts.extra) header.append(el('th', { text: opts.extra.label }));
    table.append(header);
    for (const rc of ranking) {
      const isMe = rc.isHuman;
      const tr = el('tr', { class: 'row-car' + (isMe ? ' me' : '') });
      const dot = `<span class="swatch-dot" style="background:${rc.car.color}"></span>`;
      const status = rc.eliminated ? 'OUT' : rc.finished ? formatTime(rc.finishTime) : formatTime(rc.finishTime) + '*';
      tr.append(
        el('td', { class: 'place', text: ordinal(rc.place || rc.position) }),
        el('td', { html: dot + escapeHtml(rc.participant.name) }),
        el('td', { text: rc.car.def.name }),
        el('td', { text: status }),
        el('td', { text: isFinite(rc.bestLap) ? formatTime(rc.bestLap) : '--' }),
      );
      if (opts.extra) tr.append(el('td', { text: opts.extra.value(rc.index) }));
      table.append(tr);
    }
    const panel = el('div', { class: 'panel', style: 'max-width:900px;width:100%;margin:0 auto;' }, [table]);
    if (opts.note) panel.append(el('div', { class: 'subtitle', style: 'margin-top:10px', text: opts.note }));
    if (me && humans.length === 1) {
      panel.append(
        el('div', { class: 'subtitle', style: 'margin-top:8px' }, [
          `Your best lap: ${isFinite(me.bestLap) ? formatTime(me.bestLap) : '--'} · Drift points: ${me.score}`,
        ]),
      );
    }
    const buttons = el('div', { class: 'row', style: 'justify-content:center;margin-top:16px' });
    if (opts.onRestart) buttons.append(this.button('Race again', opts.onRestart, 'btn'));
    const cont = this.button(opts.continueLabel ?? 'Continue', opts.onContinue, 'btn primary', { 'data-autofocus': true });
    buttons.append(cont);
    this.root.append(head, panel, buttons);
    this.onBack = opts.onContinue;
  }

  private onBack: () => void;

  back() {
    this.onBack();
  }
}
