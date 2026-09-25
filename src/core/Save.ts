import { defaultBindings, type Bindings } from './Input';
import type { Quality } from './Renderer';
import type { CameraMode } from './CameraRig';
import { CAR_DEFS } from '../vehicles/CarDefs';
import { TRACKS, TRACK_UNLOCKS } from '../tracks';

export type CupId = 'bronze' | 'silver' | 'gold';

export interface Settings {
  quality: Quality;
  master: number;
  music: number;
  sfx: number;
  units: 'kmh' | 'mph';
  showFps: boolean;
  camera: CameraMode;
  autoResolution: boolean;
  touch: 'auto' | 'on' | 'off';
  bindings: [Bindings, Bindings];
}

export interface TrackRecord {
  bestLap: number;
  bestRace: number;
  rushBest: number;
  /** Encoded ghost of the best lap (Time Trial). */
  ghost?: string;
  ghostCar?: string;
  ghostColor?: string;
}

export interface SaveData {
  version: number;
  settings: Settings;
  profile: { carId: string; colors: Record<string, string>; difficulty: 'easy' | 'normal' | 'hard'; trackId: string };
  unlocked: { cars: string[]; tracks: string[]; goldPaint: boolean };
  cups: Record<CupId, { won: boolean; bestPlace: number }>;
  records: Record<string, TrackRecord>;
  stats: { races: number; wins: number; drifts: number };
  seenIntro: boolean;
}

const KEY = 'prism-rush.save';
export const SAVE_VERSION = 2;

export function defaultSave(): SaveData {
  const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  return {
    version: SAVE_VERSION,
    settings: {
      quality: isTouch ? 'low' : 'high',
      master: 0.8,
      music: 0.6,
      sfx: 0.85,
      units: 'kmh',
      showFps: false,
      camera: 'chase',
      autoResolution: true,
      touch: 'auto',
      bindings: defaultBindings(),
    },
    profile: { carId: 'sunburst', colors: {}, difficulty: 'normal', trackId: TRACKS[0].id },
    unlocked: {
      cars: CAR_DEFS.filter((c) => c.unlock === 'start').map((c) => c.id),
      tracks: TRACKS.filter((t) => (TRACK_UNLOCKS[t.id] ?? 'start') === 'start').map((t) => t.id),
      goldPaint: false,
    },
    cups: { bronze: { won: false, bestPlace: 0 }, silver: { won: false, bestPlace: 0 }, gold: { won: false, bestPlace: 0 } },
    records: {},
    stats: { races: 0, wins: 0, drifts: 0 },
    seenIntro: false,
  };
}

/** Upgrades older saves and fills in anything missing so the game never crashes on bad data. */
export function migrate(raw: unknown): SaveData {
  const base = defaultSave();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<SaveData> & { version?: number };
  const out: SaveData = {
    ...base,
    ...r,
    version: SAVE_VERSION,
    settings: { ...base.settings, ...(r.settings ?? {}) },
    profile: { ...base.profile, ...(r.profile ?? {}) },
    unlocked: { ...base.unlocked, ...(r.unlocked ?? {}) },
    cups: { ...base.cups, ...(r.cups ?? {}) },
    records: { ...(r.records ?? {}) },
    stats: { ...base.stats, ...(r.stats ?? {}) },
  };
  // v1 stored a single binding set.
  const b = out.settings.bindings as unknown;
  if (!Array.isArray(b) || b.length !== 2) out.settings.bindings = defaultBindings();
  else {
    const defs = defaultBindings();
    out.settings.bindings = [
      { ...defs[0], ...(b[0] as Bindings) },
      { ...defs[1], ...(b[1] as Bindings) },
    ];
  }
  // Always keep the starter content unlocked.
  for (const id of base.unlocked.cars) if (!out.unlocked.cars.includes(id)) out.unlocked.cars.push(id);
  for (const id of base.unlocked.tracks) if (!out.unlocked.tracks.includes(id)) out.unlocked.tracks.push(id);
  if (!['low', 'medium', 'high', 'ultra'].includes(out.settings.quality)) out.settings.quality = base.settings.quality;
  return out;
}

/** localStorage-backed save game (fails gracefully in private mode). */
export class SaveManager {
  data: SaveData;
  private timer: number | null = null;

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    try {
      const txt = localStorage.getItem(KEY);
      return migrate(txt ? JSON.parse(txt) : null);
    } catch {
      return defaultSave();
    }
  }

  /** Debounced write. */
  save() {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 200);
  }

  flush() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage full or unavailable: keep playing */
    }
  }

  record(trackId: string): TrackRecord {
    let r = this.data.records[trackId];
    if (!r) {
      r = { bestLap: 0, bestRace: 0, rushBest: 0 };
      this.data.records[trackId] = r;
    }
    return r;
  }

  colorFor(carId: string): string {
    return this.data.profile.colors[carId] ?? CAR_DEFS.find((c) => c.id === carId)?.defaultColor ?? '#ff5a36';
  }

  isCarUnlocked(id: string) {
    return this.data.unlocked.cars.includes(id);
  }

  isTrackUnlocked(id: string) {
    return this.data.unlocked.tracks.includes(id);
  }

  /** Applies a cup win; returns the names of newly unlocked things. */
  winCup(cup: CupId, place: number): string[] {
    const c = this.data.cups[cup];
    const first = !c.won && place === 1;
    if (place > 0 && (c.bestPlace === 0 || place < c.bestPlace)) c.bestPlace = place;
    if (place === 1) c.won = true;
    const unlocked: string[] = [];
    if (first) {
      for (const car of CAR_DEFS) {
        if (car.unlock === cup && !this.data.unlocked.cars.includes(car.id)) {
          this.data.unlocked.cars.push(car.id);
          unlocked.push(car.name);
        }
      }
      for (const t of TRACKS) {
        if (TRACK_UNLOCKS[t.id] === cup && !this.data.unlocked.tracks.includes(t.id)) {
          this.data.unlocked.tracks.push(t.id);
          unlocked.push(t.name);
        }
      }
      if (cup === 'gold' && !this.data.unlocked.goldPaint) {
        this.data.unlocked.goldPaint = true;
        unlocked.push('Gold paint');
      }
    }
    this.save();
    return unlocked;
  }

  unlockAll() {
    this.data.unlocked.cars = CAR_DEFS.map((c) => c.id);
    this.data.unlocked.tracks = TRACKS.map((t) => t.id);
    this.data.unlocked.goldPaint = true;
    this.save();
  }

  reset() {
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
    this.flush();
  }
}
