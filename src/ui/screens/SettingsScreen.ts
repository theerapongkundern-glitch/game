import { Screen } from './Screen';
import type { Game } from '../../core/Game';
import { el } from '../dom';
import { ACTIONS, defaultBindings, keyLabel, type Action } from '../../core/Input';
import { audio } from '../../audio/AudioEngine';
import type { Quality } from '../../core/Renderer';
import type { CameraMode } from '../../core/CameraRig';

type Tab = 'general' | 'controls';

/** Settings: volume, graphics quality, units, camera, control remapping, progress. */
export class SettingsScreen extends Screen {
  private tab: Tab = 'general';
  private capturing: { player: number; action: Action } | null = null;

  constructor(
    game: Game,
    private readonly onDone: () => void,
  ) {
    super(game, 'settings dim');
    this.render();
  }

  private render() {
    const g = this.game;
    const s = g.save.data.settings;
    this.root.innerHTML = '';
    const head = el('div', { class: 'title-row' }, [el('h1', { text: 'Settings' })]);
    const tabs = el('div', { class: 'seg' });
    for (const t of ['general', 'controls'] as Tab[]) {
      const b = el('button', { class: this.tab === t ? 'on' : '', 'data-focus': true, text: t === 'general' ? 'General' : 'Controls' });
      b.addEventListener('click', () => {
        this.tab = t;
        this.render();
      });
      tabs.append(b);
    }
    head.append(tabs);
    const panel = el('div', { class: 'panel col', style: 'max-width:760px;width:100%;margin:0 auto;gap:4px' });

    if (this.tab === 'general') {
      panel.append(
        this.slider('Master volume', s.master, (v) => {
          s.master = v;
          audio.setVolumes({ master: v });
        }),
        this.slider('Music volume', s.music, (v) => {
          s.music = v;
          audio.setVolumes({ music: v });
        }),
        this.slider('Effects volume', s.sfx, (v) => {
          s.sfx = v;
          audio.setVolumes({ sfx: v });
          g.sfx('ui');
        }),
        this.choice<Quality>('Graphics quality', s.quality, [
          ['low', 'Low'],
          ['medium', 'Medium'],
          ['high', 'High'],
        ], (v) => {
          s.quality = v;
          g.renderer.applyQuality(v);
          g.toast('Quality applies fully from the next race');
        }),
        this.choice<'on' | 'off'>('Auto resolution', s.autoResolution ? 'on' : 'off', [
          ['on', 'On'],
          ['off', 'Off'],
        ], (v) => {
          s.autoResolution = v === 'on';
          g.renderer.autoResolution = s.autoResolution;
        }),
        this.choice<'kmh' | 'mph'>('Speed units', s.units, [
          ['kmh', 'km/h'],
          ['mph', 'mph'],
        ], (v) => {
          s.units = v;
          g.session?.setUnits(v);
        }),
        this.choice<CameraMode>('Default camera', s.camera, [
          ['chase', 'Chase'],
          ['close', 'Close'],
          ['bumper', 'Bumper'],
        ], (v) => (s.camera = v)),
        this.choice<'auto' | 'on' | 'off'>('Touch controls', s.touch, [
          ['auto', 'Auto'],
          ['on', 'On'],
          ['off', 'Off'],
        ], (v) => {
          s.touch = v;
          g.refreshTouch?.();
        }),
        this.choice<'on' | 'off'>('Show FPS', s.showFps ? 'on' : 'off', [
          ['on', 'On'],
          ['off', 'Off'],
        ], (v) => {
          s.showFps = v === 'on';
          g.setShowFps(s.showFps);
        }),
      );
      const prog = el('div', { class: 'row', style: 'margin-top:10px;justify-content:space-between' }, [
        el('div', { class: 'subtitle', text: 'Progress' }),
        el('div', { class: 'row' }, [
          this.button('Unlock everything', () => {
            g.save.unlockAll();
            g.sfx('unlock');
            g.toast('All cars and tracks unlocked!');
          }, 'btn small'),
          this.button('Reset progress', () => {
            if (confirm('Reset all progress, records and unlocks?')) {
              g.save.reset();
              g.toast('Progress reset');
            }
          }, 'btn small'),
        ]),
      ]);
      panel.append(prog);
    } else {
      const table = el('div', { class: 'col', style: 'gap:2px' });
      table.append(
        el('div', { class: 'field', style: 'opacity:0.7;font-size:13px' }, [el('span', { text: 'Action' }), el('span', { text: 'Player 1 (and single player)          Player 2' })]),
      );
      for (const a of ACTIONS) {
        const row = el('div', { class: 'field' }, [el('label', { text: a.label })]);
        const cells = el('div', { class: 'row' });
        for (const player of [0, 1]) {
          const keys = s.bindings[player][a.id];
          const capturing = this.capturing?.player === player && this.capturing.action === a.id;
          const b = el('button', { class: 'btn small' + (capturing ? ' primary' : ''), 'data-focus': true, style: 'min-width:120px;text-align:center', text: capturing ? 'Press a key…' : keys.map(keyLabel).join(' / ') || '—' });
          b.addEventListener('click', () => this.capture(player, a.id));
          cells.append(b);
        }
        row.append(cells);
        table.append(row);
      }
      panel.append(
        table,
        el('div', { class: 'subtitle', html: 'Gamepad: <b>RT</b> accelerate · <b>LT</b> brake · <b>Left stick</b> steer · <b>A</b> drift · <b>B/RB</b> boost · <b>Y</b> camera · <b>Start</b> pause' }),
        el('div', { class: 'row', style: 'margin-top:8px' }, [
          this.button('Reset to defaults', () => {
            s.bindings = defaultBindings();
            g.input.bindings = s.bindings;
            g.save.save();
            this.render();
          }, 'btn small'),
        ]),
      );
    }
    const back = this.button('Back', () => this.back(), 'btn primary');
    this.root.append(head, panel, el('div', { class: 'row', style: 'justify-content:center;margin-top:14px' }, [back]));
    requestAnimationFrame(() => this.nav.focusFirst());
  }

  private capture(player: number, action: Action) {
    this.capturing = { player, action };
    this.render();
    this.game.input.captureKey((code) => {
      const s = this.game.save.data.settings;
      if (code !== 'Escape') {
        // Remove the key from any other action for this player to avoid conflicts.
        for (const a of ACTIONS) s.bindings[player][a.id] = s.bindings[player][a.id].filter((k) => k !== code);
        s.bindings[player][action] = [code];
        this.game.input.bindings = s.bindings;
        this.game.save.save();
      }
      this.capturing = null;
      this.render();
    });
  }

  private slider(label: string, value: number, onChange: (v: number) => void) {
    const input = el('input', { type: 'range', min: 0, max: 100, value: Math.round(value * 100) }) as HTMLInputElement;
    input.addEventListener('input', () => {
      onChange(Number(input.value) / 100);
      this.game.save.save();
    });
    const f = el('div', { class: 'field', 'data-focus': true, 'data-lr': true, tabindex: 0 }, [el('label', { text: label }), input]);
    f.addEventListener('lr', (e) => {
      input.value = String(Math.max(0, Math.min(100, Number(input.value) + (e as CustomEvent).detail * 10)));
      input.dispatchEvent(new Event('input'));
    });
    return f;
  }

  private choice<T extends string>(label: string, value: T, options: [T, string][], onChange: (v: T) => void) {
    const seg = el('div', { class: 'seg' });
    let current = value;
    const paint = () => {
      seg.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', options[i][0] === current));
    };
    for (const [v, text] of options) {
      const b = el('button', { text });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        current = v;
        onChange(v);
        this.game.save.save();
        paint();
      });
      seg.append(b);
    }
    paint();
    const f = el('div', { class: 'field', 'data-focus': true, 'data-lr': true, tabindex: 0 }, [el('label', { text: label }), seg]);
    f.addEventListener('lr', (e) => {
      const i = options.findIndex((o) => o[0] === current);
      const n = options[(i + (e as CustomEvent).detail + options.length) % options.length][0];
      current = n;
      onChange(n);
      this.game.save.save();
      paint();
    });
    f.addEventListener('click', () => {
      const i = options.findIndex((o) => o[0] === current);
      const n = options[(i + 1) % options.length][0];
      current = n;
      onChange(n);
      this.game.save.save();
      paint();
    });
    return f;
  }

  handleNav(nav: Parameters<Screen['handleNav']>[0]) {
    if (this.capturing) return true;
    if (nav === 'tabLeft' || nav === 'tabRight') {
      this.tab = this.tab === 'general' ? 'controls' : 'general';
      this.render();
      return true;
    }
    return super.handleNav(nav);
  }

  back() {
    this.game.input.cancelCapture();
    this.game.save.save();
    this.onDone();
  }
}
