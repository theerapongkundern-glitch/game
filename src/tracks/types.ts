import type { SurfaceType } from './Surfaces';

export type ThemeId = 'test' | 'beach' | 'city' | 'forest' | 'desert';
export type SkyPresetId = 'day' | 'sunset' | 'golden' | 'night' | 'dusk';
export type MusicThemeId = 'menu' | 'beach' | 'city' | 'forest' | 'desert' | 'podium';

/** A control point of a track spline. Units are metres. */
export interface TrackPoint {
  x: number;
  z: number;
  /** Elevation (default 0). */
  y?: number;
  /** Full road width at this point (default: track width). */
  w?: number;
  /** Road bank in degrees; positive raises the LEFT edge (use for right-hand turns). */
  bank?: number;
}

/**
 * Positions on the main loop are given in control-point index units (e.g. 3.5 = halfway
 * between point 3 and 4). Positions on a shortcut (`shortcut` set) are a 0..1 fraction of it.
 */
export interface SurfaceZone {
  from: number;
  to: number;
  type: SurfaceType;
  /** Lateral range in metres, left-positive from the centre line. Default: full road. */
  lat?: [number, number];
  /** Index into `shortcuts` if this zone lies on a shortcut path. */
  shortcut?: number;
}

export interface RampDef {
  at: number;
  /** Length of the kicker in metres. */
  length: number;
  height: number;
  /** Ramp width in metres (default: 70% of road width). */
  width?: number;
  /** Lateral centre offset in metres, left-positive. */
  offset?: number;
  shortcut?: number;
}

export interface BoostPadDef {
  at: number;
  offset?: number;
  width?: number;
  length?: number;
  shortcut?: number;
}

export interface ShortcutDef {
  /** Main-loop control index where the shortcut leaves. */
  from: number;
  /** Main-loop control index where it rejoins. */
  to: number;
  /** Intermediate control points (the path starts/ends on the main centre line). */
  via: TrackPoint[];
  width?: number;
  surface: SurfaceType;
  name: string;
}

export interface TrackDef {
  id: string;
  name: string;
  tagline: string;
  theme: ThemeId;
  sky: SkyPresetId;
  music: MusicThemeId;
  /** Uniform horizontal scale applied to all x/z coordinates (default 1). */
  scale?: number;
  /** Default full road width. */
  width: number;
  /** Run-off width between road edge and barrier, per side. */
  shoulder: number;
  shoulderSurface: SurfaceType;
  /** Closed loop of control points. Point 0 is the start/finish line and should be on a straight. */
  points: TrackPoint[];
  surfaces?: SurfaceZone[];
  ramps?: RampDef[];
  boostPads?: BoostPadDef[];
  shortcuts?: ShortcutDef[];
  /** Seed for scenery placement. */
  seed: number;
  /** Checkpoint Rush: seconds on the clock at start, and per checkpoint. */
  rush?: { start: number; perGate: number };
  /** Accent colours used by the UI card and minimap. */
  colors: { primary: string; secondary: string };
  /** Optional sea: terrain drops below the water beyond `start` metres along `dir`. */
  sea?: { dir: [number, number]; start: number };
  /** Ambient particles / weather hints for the theme. */
  weather?: 'none' | 'drizzle' | 'fireflies' | 'dust';
}
