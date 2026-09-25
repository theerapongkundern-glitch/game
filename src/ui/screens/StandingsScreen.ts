import { Screen } from './Screen';
import type { Game } from '../../core/Game';
import type { RaceSession } from '../../modes/RaceSession';
import { GP_POINTS, sortStandings, type GrandPrix } from '../../modes/GrandPrix';
import { el, escapeHtml } from '../dom';
import { formatTime, ordinal } from '../../core/math';

/** Grand Prix standings after each race (race result + championship table). */
export class StandingsScreen extends Screen {
  constructor(
    game: Game,
    session: RaceSession,
    gp: GrandPrix,
    opts: { before: number[]; final: boolean; onNext: () => void },
  ) {
    super(game, 'standings dim');
    const race = gp.raceIndex + 1;
    const total = gp.tracks.length;
    const head = el('div', { class: 'title-row' }, [
      el('div', {}, [el('h1', { text: `Grand Prix — Race ${race}/${total}` }), el('div', { class: 'subtitle', text: `${session.config.track.name} · ${gp.opts.cup[0].toUpperCase() + gp.opts.cup.slice(1)} Cup` })]),
    ]);
    // Race result.
    const raceTable = el('table', { class: 'results-table' }, [el('tr', {}, [el('th', { text: 'Race' }), el('th', { text: 'Driver' }), el('th', { text: 'Time' }), el('th', { text: 'Pts' })])]);
    for (const rc of session.sim.ranking()) {
      raceTable.append(
        el('tr', { class: 'row-car' + (rc.isHuman ? ' me' : '') }, [
          el('td', { class: 'place', text: ordinal(rc.place) }),
          el('td', { html: `<span class="swatch-dot" style="background:${rc.car.color}"></span>${escapeHtml(rc.participant.name)}` }),
          el('td', { text: formatTime(rc.finishTime) + (rc.finished ? '' : '*') }),
          el('td', { text: `+${GP_POINTS[rc.place - 1] ?? 0}` }),
        ]),
      );
    }
    // Championship.
    const champ = el('table', { class: 'results-table' }, [el('tr', {}, [el('th', { text: 'Pos' }), el('th', { text: 'Driver' }), ...gp.tracks.map((_t, i) => el('th', { text: `R${i + 1}` })), el('th', { text: 'Total' })])]);
    sortStandings(gp.standings).forEach((s, i) => {
      const prev = opts.before.indexOf(s.index);
      const move = prev < 0 ? '' : prev > i ? ' ▲' : prev < i ? ' ▼' : '';
      champ.append(
        el('tr', { class: 'row-car' + (s.isHuman ? ' me' : '') }, [
          el('td', { class: 'place', text: ordinal(i + 1) + move }),
          el('td', { html: `<span class="swatch-dot" style="background:${s.color}"></span>${escapeHtml(s.name)}` }),
          ...gp.tracks.map((_t, r) => el('td', { text: s.races[r] !== undefined ? String(s.races[r]) : '·' })),
          el('td', { text: String(s.points), style: 'font-weight:800;font-size:18px' }),
        ]),
      );
    });
    const grid = el('div', { class: 'standings-grid' }, [el('div', { class: 'panel' }, [el('div', { class: 'label', text: 'This race' }), raceTable]), el('div', { class: 'panel' }, [el('div', { class: 'label', text: 'Championship' }), champ])]);
    const nextLabel = opts.final ? 'To the podium!' : `Next: ${gp.tracks[gp.raceIndex + 1].name}`;
    const buttons = el('div', { class: 'row', style: 'justify-content:center;margin-top:14px' }, [
      this.button('Quit Grand Prix', () => game.toMenu(), 'btn small ghost'),
      this.button(nextLabel, () => opts.onNext(), 'btn primary', { 'data-autofocus': true }),
    ]);
    this.root.append(head, grid, buttons);
  }

  back() {
    /* ignore Esc: avoid accidentally leaving the GP */
  }
}
