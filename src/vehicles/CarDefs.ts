/** The six original Prism Rush cars. Stats are 1–10 and drive every physics parameter. */

export interface CarStats {
  speed: number;
  accel: number;
  handling: number;
  drift: number;
}

export type BodyStyle = 'coupe' | 'hatch' | 'bubble' | 'drift' | 'wagon' | 'hyper';
export type SpoilerStyle = 'none' | 'lip' | 'wing' | 'tall' | 'ducktail';

export interface CarShape {
  style: BodyStyle;
  length: number;
  width: number;
  /** Body (shoulder) height above the ground, excluding cabin. */
  bodyHeight: number;
  /** Total height including cabin. */
  roofHeight: number;
  wheelbase: number;
  wheelRadius: number;
  wheelWidth: number;
  /** Ground clearance under the body. */
  clearance: number;
  /** Cabin start/end along the length (0 = front bumper, 1 = rear bumper). */
  cabinFrom: number;
  cabinTo: number;
  /** Cabin width as a fraction of body width. */
  cabinWidth: number;
  spoiler: SpoilerStyle;
  /** Accent (stripe/trim) colour. */
  accent: string;
  rimColor: string;
  /** Side-profile control points for the lower body, normalised (x: 0 front → 1 rear, y: 0..1 of bodyHeight). */
  profile: [number, number][];
  /** Extra features. */
  roofScoop?: boolean;
  sideVents?: boolean;
  bullbar?: boolean;
  roofRack?: boolean;
  fins?: boolean;
}

export type UnlockKey = 'start' | 'bronze' | 'silver' | 'gold';

export interface CarDef {
  id: string;
  name: string;
  tagline: string;
  stats: CarStats;
  /** 0..1 – how well it copes with sand/grass. */
  offroad: number;
  mass: number;
  drive: 'rwd' | 'awd' | 'fwd';
  shape: CarShape;
  defaultColor: string;
  unlock: UnlockKey;
  /** Engine voice: base pitch multiplier and "growl" amount. */
  engine: { pitch: number; growl: number; cylinders: number };
}

export const CAR_DEFS: CarDef[] = [
  {
    id: 'sunburst',
    name: 'Sunburst GT',
    tagline: 'The all-rounder. Friendly, quick and ready for anything.',
    stats: { speed: 6, accel: 7, handling: 6, drift: 5 },
    offroad: 0.25,
    mass: 1250,
    drive: 'rwd',
    defaultColor: '#ff5a36',
    unlock: 'start',
    engine: { pitch: 1.0, growl: 0.45, cylinders: 6 },
    shape: {
      style: 'coupe',
      length: 4.4,
      width: 1.95,
      bodyHeight: 0.78,
      roofHeight: 1.3,
      wheelbase: 2.65,
      wheelRadius: 0.36,
      wheelWidth: 0.3,
      clearance: 0.18,
      cabinFrom: 0.34,
      cabinTo: 0.74,
      cabinWidth: 0.82,
      spoiler: 'lip',
      accent: '#ffffff',
      rimColor: '#d9dde6',
      profile: [
        [0, 0.25], [0.02, 0.62], [0.12, 0.8], [0.35, 0.9], [0.75, 0.95], [0.95, 0.9], [1, 0.6], [1, 0.25],
      ],
      sideVents: true,
    },
  },
  {
    id: 'puddle',
    name: 'Puddle Jumper',
    tagline: 'A bouncy rally hatch that laughs at sand and grass.',
    stats: { speed: 5, accel: 6, handling: 8, drift: 5 },
    offroad: 0.85,
    mass: 1100,
    drive: 'awd',
    defaultColor: '#2ec27e',
    unlock: 'start',
    engine: { pitch: 1.18, growl: 0.35, cylinders: 4 },
    shape: {
      style: 'hatch',
      length: 3.9,
      width: 1.85,
      bodyHeight: 0.85,
      roofHeight: 1.55,
      wheelbase: 2.45,
      wheelRadius: 0.38,
      wheelWidth: 0.3,
      clearance: 0.3,
      cabinFrom: 0.3,
      cabinTo: 0.94,
      cabinWidth: 0.86,
      spoiler: 'wing',
      accent: '#ffd23f',
      rimColor: '#ffffff',
      profile: [
        [0, 0.3], [0.03, 0.7], [0.18, 0.88], [0.5, 0.95], [0.96, 0.96], [1, 0.8], [1, 0.3],
      ],
      roofRack: true,
      bullbar: true,
    },
  },
  {
    id: 'nitrino',
    name: 'Nitrino',
    tagline: 'A tiny electric zipper with rocket-like acceleration.',
    stats: { speed: 4, accel: 9, handling: 7, drift: 5 },
    offroad: 0.3,
    mass: 900,
    drive: 'awd',
    defaultColor: '#3db4ff',
    unlock: 'start',
    engine: { pitch: 1.55, growl: 0.1, cylinders: 0 },
    shape: {
      style: 'bubble',
      length: 3.5,
      width: 1.8,
      bodyHeight: 0.8,
      roofHeight: 1.45,
      wheelbase: 2.3,
      wheelRadius: 0.33,
      wheelWidth: 0.28,
      clearance: 0.2,
      cabinFrom: 0.22,
      cabinTo: 0.82,
      cabinWidth: 0.88,
      spoiler: 'none',
      accent: '#ffffff',
      rimColor: '#ff66c4',
      profile: [
        [0, 0.3], [0.02, 0.7], [0.15, 0.92], [0.5, 1.0], [0.88, 0.95], [1, 0.72], [1, 0.3],
      ],
    },
  },
  {
    id: 'tango',
    name: 'Tango Twister',
    tagline: 'Born sideways. Fills the boost bar faster than anyone.',
    stats: { speed: 7, accel: 6, handling: 6, drift: 9 },
    offroad: 0.2,
    mass: 1180,
    drive: 'rwd',
    defaultColor: '#b44dff',
    unlock: 'bronze',
    engine: { pitch: 1.1, growl: 0.55, cylinders: 4 },
    shape: {
      style: 'drift',
      length: 4.35,
      width: 1.98,
      bodyHeight: 0.72,
      roofHeight: 1.25,
      wheelbase: 2.6,
      wheelRadius: 0.35,
      wheelWidth: 0.32,
      clearance: 0.14,
      cabinFrom: 0.36,
      cabinTo: 0.72,
      cabinWidth: 0.8,
      spoiler: 'tall',
      accent: '#3dffd8',
      rimColor: '#1d1d28',
      profile: [
        [0, 0.2], [0.01, 0.55], [0.1, 0.78], [0.32, 0.88], [0.78, 0.92], [0.96, 0.9], [1, 0.55], [1, 0.2],
      ],
      sideVents: true,
      roofScoop: true,
    },
  },
  {
    id: 'thunderloaf',
    name: 'Thunderloaf',
    tagline: 'A chunky muscle wagon. Slow to turn, unstoppable in a straight line.',
    stats: { speed: 9, accel: 6, handling: 5, drift: 6 },
    offroad: 0.4,
    mass: 1550,
    drive: 'rwd',
    defaultColor: '#ffb13d',
    unlock: 'silver',
    engine: { pitch: 0.78, growl: 0.9, cylinders: 8 },
    shape: {
      style: 'wagon',
      length: 4.8,
      width: 2.05,
      bodyHeight: 0.86,
      roofHeight: 1.42,
      wheelbase: 2.9,
      wheelRadius: 0.39,
      wheelWidth: 0.36,
      clearance: 0.2,
      cabinFrom: 0.36,
      cabinTo: 0.97,
      cabinWidth: 0.84,
      spoiler: 'ducktail',
      accent: '#1b1446',
      rimColor: '#c9ced8',
      profile: [
        [0, 0.28], [0.01, 0.75], [0.08, 0.9], [0.3, 0.96], [0.96, 0.96], [1, 0.82], [1, 0.28],
      ],
      roofScoop: true,
    },
  },
  {
    id: 'aurora',
    name: 'Aurora Blade',
    tagline: 'A shimmering hypercar. The ultimate prize for Gold Cup champions.',
    stats: { speed: 9, accel: 8, handling: 7, drift: 7 },
    offroad: 0.15,
    mass: 1150,
    drive: 'awd',
    defaultColor: '#f2f4ff',
    unlock: 'gold',
    engine: { pitch: 1.3, growl: 0.6, cylinders: 12 },
    shape: {
      style: 'hyper',
      length: 4.6,
      width: 2.05,
      bodyHeight: 0.62,
      roofHeight: 1.12,
      wheelbase: 2.75,
      wheelRadius: 0.36,
      wheelWidth: 0.34,
      clearance: 0.12,
      cabinFrom: 0.3,
      cabinTo: 0.66,
      cabinWidth: 0.74,
      spoiler: 'wing',
      accent: '#ff4fa3',
      rimColor: '#3de0ff',
      profile: [
        [0, 0.18], [0.0, 0.42], [0.2, 0.7], [0.4, 0.86], [0.8, 0.95], [0.97, 0.92], [1, 0.6], [1, 0.18],
      ],
      fins: true,
      sideVents: true,
    },
  },
];

export function getCarDef(id: string): CarDef {
  return CAR_DEFS.find((c) => c.id === id) ?? CAR_DEFS[0];
}

export const PAINT_SWATCHES = [
  '#ff5a36', '#ff4fa3', '#b44dff', '#5b6cff', '#3db4ff', '#3de0ff',
  '#2ec27e', '#a4e635', '#ffd23f', '#ffb13d', '#f2f4ff', '#2a2d3e',
];

/** Special finish unlocked by the Gold Cup. */
export const GOLD_PAINT = '#ffcf40';
