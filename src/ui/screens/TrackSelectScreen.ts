import { Screen } from './Screen';
import type { Game } from '../../core/Game';
import { el } from '../dom';
import { TRACKS, TRACK_UNLOCKS } from '../../tracks';
import type { Difficulty, ModeId } from '../../modes/ModeRules';
import type { Selection } from '../flow';
import { formatTime } from '../../core/math';
import { Track } from '../../tracks/Track';
import { Minimap } from '../Minimap';
import { DIFFICULTY } from '../../ai/Difficulty';

export interface TrackSelectOptions {
  mode: ModeId;
  showDifficulty: boolean;
  showLaps: boolean;
  initial: Selection;
  onPick: (trackId: string, difficulty: Difficulty, laps: number) => void;
  onBack: () => void;
}

const HINT: Record<string, string> = {
  bronze: 'Win the Bronze Cup to unlock',
  silver: 'Win the Silver Cup to unlock',
  gold: 'Win the Gold Cup to unlock',
};

const THEME_LABEL: Record<string, string> = { beach: 'Tropical coast', city: 'Neon city · night', forest: 'Mountain forest · sunset', desert: 'Desert canyon · golden hour', test: 'Test' };

/** Track select with a live 3D flyover preview, minimap, records, difficulty and laps. */
export class TrackSelectScreen extends Screen {
  private idx: number;
  private difficulty: Difficulty;
  private laps: number;
  private info!: HTMLDivElement;
  private list!: HTMLDivElement;
  /** Called when the highlighted track changes (Game swaps the 3D preview). */
  onPreview: ((trackId: string) => void) | null = null;
  private readonly trackCache = new Map<string, Track>();

  constructor(
    game: Game,
    private readonly opts: TrackSelectOptions,
  ) {
    super(game, 'track-select');
    this.idx = Math.max(0, TRACKS.findIndex((t) => t.id === opts.initial.trackId));
    if (!game.save.isTrackUnlocked(TRACKS[this.idx].id)) this.idx = 0;
    this.difficulty = opts.initial.difficulty;
    this.laps = opts.initial.laps || 3;
    this.build();
  }

  get trackId() {
    return TRACKS[this.idx].id;
  }

  private build() {
    const head = el('div', { class: 'title-row' }, [
      el('div', {}, [el('h1', { text: 'Choose a track' }), el('div', { class: 'subtitle', text: modeLabel(this.opts.mode) })]),
      this.button('Back', () => this.back(), 'btn small ghost'),
    ]);
    this.list = el('div', { class: 'panel col track-list' });
    this.info = el('div', { class: 'panel track-info' });
    this.root.append(head, el('div', { class: 'garage-body' }, [this.list, el('div', { class: 'garage-stage' }), this.info]));
    this.root.append(el('div', { class: 'hint-bar', html: '<span><kbd>↑</kbd><kbd>↓</kbd> track</span><span><kbd>←</kbd><kbd>→</kbd> change option</span><span><kbd>Enter</kbd> race!</span><span><kbd>Esc</kbd> back</span>' }));
    this.renderList();
    this.renderInfo();
  }

  private renderList() {
    this.list.innerHTML = '';
    TRACKS.forEach((t, i) => {
      const locked = !this.game.save.isTrackUnlocked(t.id);
      const b = el('button', { class: 'btn car-item' + (i === this.idx ? ' selected' : ''), 'data-focus': true }, [
        el('span', { class: 'car-dot', style: `background:${locked ? '#444' : t.colors.primary}` }),
        t.name,
        locked ? el('span', { class: 'lock', text: '🔒' }) : null,
      ]);
      if (i === this.idx) b.setAttribute('data-autofocus', '');
      b.addEventListener('click', () => {
        if (i === this.idx) this.go();
        else this.select(i);
      });
      b.addEventListener('focus', () => this.select(i));
      this.list.append(b);
    });
  }

  private select(i: number) {
    if (i === this.idx) return;
    this.idx = i;
    this.list.querySelectorAll('.car-item').forEach((b, k) => b.classList.toggle('selected', k === i));
    this.renderInfo();
    this.onPreview?.(this.trackId);
    this.game.sfx('uiMove');
  }

  private track(): Track {
    const def = TRACKS[this.idx];
    let t = this.trackCache.get(def.id);
    if (!t) {
      t = new Track(def);
      this.trackCache.set(def.id, t);
    }
    return t;
  }

  private renderInfo() {
    const def = TRACKS[this.idx];
    const locked = !this.game.save.isTrackUnlocked(def.id);
    const rec = this.game.save.data.records[def.id];
    const track = this.track();
    this.info.innerHTML = '';
    this.info.append(
      el('h2', { text: def.name }),
      el('div', { class: 'subtitle', text: def.tagline }),
      el('div', { class: 'row', style: 'margin:8px 0' }, [
        el('span', { class: 'badge cyan', text: THEME_LABEL[def.theme] ?? def.theme }),
        el('span', { class: 'badge', text: `${(track.length / 1000).toFixed(2)} km` }),
        def.shortcuts?.length ? el('span', { class: 'badge pink', text: 'Shortcut' }) : null,
      ]),
    );
    const mm = new Minimap(track, 150);
    mm.draw([]);
    const mmWrap = el('div', { class: 'mini-preview' });
    mmWrap.append(mm.canvas);
    const records = el('div', { class: 'records' }, [
      el('div', {}, ['Best lap', el('b', { text: rec?.bestLap ? formatTime(rec.bestLap) : '--' })]),
      el('div', {}, ['Best race', el('b', { text: rec?.bestRace ? formatTime(rec.bestRace) : '--' })]),
      el('div', {}, ['Rush best', el('b', { text: rec?.rushBest ? formatTime(rec.rushBest) : '--' })]),
    ]);
    this.info.append(el('div', { class: 'row', style: 'align-items:flex-start;gap:16px' }, [mmWrap, records]));

    if (locked) {
      this.info.append(el('div', { class: 'locked-msg', text: '🔒 ' + (HINT[TRACK_UNLOCKS[def.id]] ?? 'Locked') }));
      return;
    }
    if (this.opts.showDifficulty) {
      this.info.append(
        this.option('Difficulty', (['easy', 'normal', 'hard'] as Difficulty[]).map((d) => [d, DIFFICULTY[d].label]), this.difficulty, (v) => {
          this.difficulty = v as Difficulty;
        }),
      );
    }
    if (this.opts.showLaps) {
      this.info.append(
        this.option('Laps', ['1', '2', '3', '4', '5'].map((l) => [l, l]), String(this.laps), (v) => {
          this.laps = Number(v);
        }),
      );
    }
    this.info.append(el('div', { class: 'row', style: 'margin-top:14px' }, [this.button('Race!', () => this.go(), 'btn primary')]));
  }

  private option(label: string, options: [string, string][], value: string, onChange: (v: string) => void) {
    const seg = el('div', { class: 'seg' });
    let current = value;
    const paint = () => seg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', options[i][0] === current));
    options.forEach(([v, text]) => {
      const b = el('button', { text });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        current = v;
        onChange(v);
        paint();
        this.game.sfx('uiMove');
      });
      seg.append(b);
    });
    paint();
    const f = el('div', { class: 'field', 'data-focus': true, 'data-lr': true, tabindex: 0 }, [el('label', { text: label }), seg]);
    f.addEventListener('lr', (e) => {
      const i = options.findIndex((o) => o[0] === current);
      current = options[Math.max(0, Math.min(options.length - 1, i + (e as CustomEvent).detail))][0];
      onChange(current);
      paint();
    });
    return f;
  }

  private go() {
    const def = TRACKS[this.idx];
    if (!this.game.save.isTrackUnlocked(def.id)) {
      this.game.sfx('uiBack');
      this.game.toast(HINT[TRACK_UNLOCKS[def.id]] ?? 'Locked');
      return;
    }
    this.opts.onPick(def.id, this.difficulty, this.laps);
  }

  back() {
    this.opts.onBack();
  }
}

function modeLabel(m: ModeId): string {
  switch (m) {
    case 'quick':
      return 'Quick Race';
    case 'timetrial':
      return 'Time Trial';
    case 'elimination':
      return 'Elimination';
    case 'rush':
      return 'Checkpoint Rush';
    case 'split':
      return '2 Players';
    default:
      return '';
  }
}
