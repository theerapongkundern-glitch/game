import type { DriveInput } from '../vehicles/VehiclePhysics';
import { clamp, moveTowards } from './math';

export type Action = 'up' | 'down' | 'left' | 'right' | 'handbrake' | 'boost' | 'camera' | 'pause' | 'reset' | 'lookback';
export type Bindings = Record<Action, string[]>;
export type MenuNav = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'tabLeft' | 'tabRight';

export const ACTIONS: { id: Action; label: string }[] = [
  { id: 'up', label: 'Accelerate' },
  { id: 'down', label: 'Brake / Reverse' },
  { id: 'left', label: 'Steer left' },
  { id: 'right', label: 'Steer right' },
  { id: 'handbrake', label: 'Handbrake / Drift' },
  { id: 'boost', label: 'Boost' },
  { id: 'camera', label: 'Change camera' },
  { id: 'lookback', label: 'Look back' },
  { id: 'reset', label: 'Reset to track' },
  { id: 'pause', label: 'Pause' },
];

export function defaultBindings(): [Bindings, Bindings] {
  return [
    {
      up: ['KeyW'],
      down: ['KeyS'],
      left: ['KeyA'],
      right: ['KeyD'],
      handbrake: ['Space'],
      boost: ['ShiftLeft'],
      camera: ['KeyC'],
      lookback: ['KeyQ'],
      reset: ['KeyR'],
      pause: ['KeyP', 'Escape'],
    },
    {
      up: ['ArrowUp'],
      down: ['ArrowDown'],
      left: ['ArrowLeft'],
      right: ['ArrowRight'],
      handbrake: ['ControlRight', 'Slash'],
      boost: ['ShiftRight'],
      camera: ['Period'],
      lookback: ['Comma'],
      reset: ['Enter'],
      pause: ['KeyP', 'Escape'],
    },
  ];
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'Space',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt',
    AltRight: 'R-Alt',
    Escape: 'Esc',
    Enter: 'Enter',
    Slash: '/',
    Period: '.',
    Comma: ',',
    Semicolon: ';',
    Quote: "'",
    Backspace: 'Backspace',
    Tab: 'Tab',
  };
  return map[code] ?? code;
}

/** On-screen touch control state, written by TouchControls. */
export interface TouchState {
  active: boolean;
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  boost: boolean;
  cameraPressed: boolean;
  pausePressed: boolean;
}

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);

/** Unified keyboard + gamepad + touch input with per-player bindings and menu navigation. */
export class Input {
  bindings: [Bindings, Bindings] = defaultBindings();
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly steer = [0, 0];
  private padPrev: boolean[][] = [];
  private padPressed: Set<number>[] = [];
  private padIndex: number[] = [];
  private navRepeat = 0;
  private lastNavDir = '';
  private navListeners: ((nav: MenuNav) => void)[] = [];
  private captureCb: ((code: string) => void) | null = null;
  lastDevice: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  readonly touch: TouchState = {
    active: false,
    steer: 0,
    throttle: 0,
    brake: 0,
    handbrake: false,
    boost: false,
    cameraPressed: false,
    pausePressed: false,
  };
  /** When true, arrow/WASD/Enter/Escape produce menu navigation events. */
  menuMode = true;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.down.clear());
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
    if (this.captureCb) {
      e.preventDefault();
      const cb = this.captureCb;
      this.captureCb = null;
      cb(e.code);
      return;
    }
    if (typing && e.code !== 'Escape') return;
    this.lastDevice = 'keyboard';
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
    if (GAME_KEYS.has(e.code) && !this.menuMode) e.preventDefault();
    if (this.menuMode && !e.repeat) {
      const nav = this.keyToNav(e.code);
      if (nav) {
        if (nav !== 'confirm' || e.code !== 'Space') e.preventDefault();
        this.emitNav(nav);
      }
    } else if (this.menuMode && e.repeat) {
      const nav = this.keyToNav(e.code);
      if (nav && nav !== 'confirm' && nav !== 'back') {
        e.preventDefault();
        this.emitNav(nav);
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private keyToNav(code: string): MenuNav | null {
    switch (code) {
      case 'ArrowUp':
      case 'KeyW':
        return 'up';
      case 'ArrowDown':
      case 'KeyS':
        return 'down';
      case 'ArrowLeft':
      case 'KeyA':
        return 'left';
      case 'ArrowRight':
      case 'KeyD':
        return 'right';
      case 'Enter':
      case 'NumpadEnter':
        return 'confirm';
      case 'Escape':
      case 'Backspace':
        return 'back';
      case 'KeyQ':
        return 'tabLeft';
      case 'KeyE':
        return 'tabRight';
      default:
        return null;
    }
  }

  onNav(cb: (nav: MenuNav) => void): () => void {
    this.navListeners.push(cb);
    return () => {
      this.navListeners = this.navListeners.filter((c) => c !== cb);
    };
  }

  private emitNav(nav: MenuNav) {
    for (const cb of [...this.navListeners]) cb(nav);
  }

  /** Captures the next key press (for remapping). */
  captureKey(cb: (code: string) => void) {
    this.captureCb = cb;
  }

  cancelCapture() {
    this.captureCb = null;
  }

  private gamepads(): Gamepad[] {
    const list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    return list.filter((g): g is Gamepad => !!g && g.connected);
  }

  /** Call once per frame before reading input. */
  poll(dt: number) {
    const pads = this.gamepads();
    this.padIndex = pads.map((p) => p.index);
    for (let n = 0; n < pads.length; n++) {
      const pad = pads[n];
      const prev = this.padPrev[n] ?? [];
      const pressed = new Set<number>();
      const now = pad.buttons.map((b) => b.pressed || b.value > 0.5);
      for (let i = 0; i < now.length; i++) if (now[i] && !prev[i]) pressed.add(i);
      this.padPressed[n] = pressed;
      this.padPrev[n] = now;
      if (pressed.size > 0 || Math.abs(pad.axes[0] ?? 0) > 0.4 || Math.abs(pad.axes[1] ?? 0) > 0.4) this.lastDevice = 'gamepad';
    }
    this.padPressed.length = pads.length;
    // Menu navigation from gamepads (D-pad / stick with auto-repeat).
    if (this.menuMode) {
      let dir = '';
      for (const pad of pads) {
        const ax = pad.axes[0] ?? 0;
        const ay = pad.axes[1] ?? 0;
        const b = pad.buttons;
        if (b[12]?.pressed || ay < -0.6) dir = 'up';
        else if (b[13]?.pressed || ay > 0.6) dir = 'down';
        else if (b[14]?.pressed || ax < -0.6) dir = 'left';
        else if (b[15]?.pressed || ax > 0.6) dir = 'right';
        if (dir) break;
      }
      if (dir) {
        if (dir !== this.lastNavDir) {
          this.emitNav(dir as MenuNav);
          this.navRepeat = 0.4;
        } else {
          this.navRepeat -= dt;
          if (this.navRepeat <= 0) {
            this.emitNav(dir as MenuNav);
            this.navRepeat = 0.12;
          }
        }
      }
      this.lastNavDir = dir;
      for (const set of this.padPressed) {
        if (set.has(0)) this.emitNav('confirm');
        if (set.has(1)) this.emitNav('back');
        if (set.has(9)) this.emitNav('confirm');
        if (set.has(4)) this.emitNav('tabLeft');
        if (set.has(5)) this.emitNav('tabRight');
      }
    }
  }

  /** Clears one-frame "pressed" edges. Call at the end of each frame. */
  endFrame() {
    this.pressed.clear();
    this.touch.cameraPressed = false;
    this.touch.pausePressed = false;
    for (const s of this.padPressed) s?.clear();
  }

  isDown(code: string) {
    return this.down.has(code);
  }

  private keysFor(player: number, split: boolean): Bindings[] {
    if (split) return [this.bindings[player]];
    return [this.bindings[0], this.bindings[1]];
  }

  private padsFor(player: number, split: boolean): Gamepad[] {
    const pads = this.gamepads();
    if (!split) return pads;
    return pads[player] ? [pads[player]] : [];
  }

  private padSlot(pad: Gamepad): number {
    return this.padIndex.indexOf(pad.index);
  }

  actionDown(action: Action, player: number, split: boolean): boolean {
    for (const b of this.keysFor(player, split)) for (const k of b[action]) if (this.down.has(k)) return true;
    return false;
  }

  /** True on the frame the action was pressed (keyboard, gamepad or touch). */
  actionPressed(action: Action, player: number, split: boolean): boolean {
    for (const b of this.keysFor(player, split)) for (const k of b[action]) if (this.pressed.has(k)) return true;
    const btn: Partial<Record<Action, number[]>> = { camera: [3], pause: [9], reset: [8], lookback: [] };
    const list = btn[action];
    if (list) {
      for (const pad of this.padsFor(player, split)) {
        const set = this.padPressed[this.padSlot(pad)];
        if (set && list.some((i) => set.has(i))) return true;
      }
    }
    if (player === 0 || !split) {
      if (action === 'camera' && this.touch.cameraPressed) return true;
      if (action === 'pause' && this.touch.pausePressed) return true;
    }
    return false;
  }

  /** Fills a DriveInput for a player. Keyboard steering is smoothed to feel analogue. */
  readDrive(player: number, split: boolean, dt: number, out: DriveInput): DriveInput {
    let throttle = 0;
    let brake = 0;
    let steerTarget = 0;
    let handbrake = false;
    let boost = false;
    let analogSteer: number | null = null;
    for (const b of this.keysFor(player, split)) {
      const has = (a: Action) => b[a].some((k) => this.down.has(k));
      if (has('up')) throttle = 1;
      if (has('down')) brake = 1;
      if (has('left')) steerTarget -= 1;
      if (has('right')) steerTarget += 1;
      if (has('handbrake')) handbrake = true;
      if (has('boost')) boost = true;
    }
    steerTarget = clamp(steerTarget, -1, 1);
    for (const pad of this.padsFor(player, split)) {
      const b = pad.buttons;
      const rt = b[7]?.value ?? 0;
      const lt = b[6]?.value ?? 0;
      throttle = Math.max(throttle, rt > 0.05 ? rt : 0);
      brake = Math.max(brake, lt > 0.05 ? lt : 0);
      if (b[0]?.pressed || b[2]?.pressed) handbrake = true;
      if (b[1]?.pressed || b[5]?.pressed) boost = true;
      if (b[12]?.pressed) throttle = 1;
      if (b[13]?.pressed) brake = 1;
      const ax = pad.axes[0] ?? 0;
      const dead = 0.12;
      if (Math.abs(ax) > dead) {
        const v = (Math.abs(ax) - dead) / (1 - dead);
        analogSteer = Math.sign(ax) * Math.pow(v, 1.35);
      }
      if (b[14]?.pressed) analogSteer = -1;
      if (b[15]?.pressed) analogSteer = 1;
    }
    if (this.touch.active && (player === 0 || !split)) {
      throttle = Math.max(throttle, this.touch.throttle);
      brake = Math.max(brake, this.touch.brake);
      if (this.touch.handbrake) handbrake = true;
      if (this.touch.boost) boost = true;
      if (Math.abs(this.touch.steer) > 0.01) analogSteer = this.touch.steer;
    }
    // Keyboard smoothing: quick to turn in, quicker to return, snap when reversing.
    let s = this.steer[player];
    if (analogSteer !== null) s = analogSteer;
    else {
      const reversing = steerTarget !== 0 && Math.sign(steerTarget) !== Math.sign(s) && s !== 0;
      const rate = steerTarget === 0 ? 9 : reversing ? 14 : 6.5;
      s = moveTowards(s, steerTarget, rate * dt);
    }
    this.steer[player] = s;
    out.throttle = throttle;
    out.brake = brake;
    out.steer = s;
    out.handbrake = handbrake;
    out.boost = boost;
    return out;
  }

  rumble(player: number, split: boolean, strong: number, weak: number, ms: number) {
    for (const pad of this.padsFor(player, split)) {
      const act = (pad as Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }).vibrationActuator;
      act?.playEffect?.('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: clamp(weak, 0, 1), strongMagnitude: clamp(strong, 0, 1) }).catch(() => {});
    }
  }

  hasGamepad() {
    return this.gamepads().length > 0;
  }
}
