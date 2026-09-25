import type { RoadStyle } from './textures';
import type { ThemeId } from './types';

export type BarrierKind = 'foam' | 'neon' | 'wood' | 'rock' | 'tires';

export interface ThemeStyle {
  road: RoadStyle;
  roadRoughness: number;
  shoulder: { base: string; specks: string[]; blades: boolean };
  ground: { base: string; specks: string[]; blades: boolean };
  /** Colour tint for the terrain material. */
  groundTint: string;
  barrier: { kind: BarrierKind; a: string; b: string; height: number };
  curb: [string, string];
  /** Terrain undulation height away from the track (m). */
  hills: number;
  hillScale: number;
  /** If true, noise goes below the base height too (lakes/lagoons where there is water). */
  signedHills?: boolean;
  /** Optional water plane. */
  water?: { color: string; deep: string; level: number };
  /** Shortcut/dirt path look. */
  dirt: { base: string; specks: string[] };
  sand: { base: string; specks: string[] };
  gantry: { banner: string; text: string; pillar: string };
  /** Terrain shading: macro colour variation, rock on slopes, wet band at the shoreline. */
  terrain: {
    alt: string;
    rock: string;
    rockSlope: [number, number];
    /** Horizontal rock banding strength (canyon strata). */
    strata: number;
    shore?: { color: string; height: number };
    detail: 'grain' | 'ripple';
  };
}

export const THEMES: Record<ThemeId, ThemeStyle> = {
  test: {
    road: { base: '#4a4d5c', speck: ['#5d6072', '#3b3d49', '#6d7084'], edge: '#ffffff', center: '#ffd23f', dashed: true },
    roadRoughness: 0.85,
    shoulder: { base: '#63c46b', specks: ['#7dd87f', '#4fae5a', '#8fe08a'], blades: true },
    ground: { base: '#5bbd62', specks: ['#79d27a', '#4aa755', '#92df86'], blades: true },
    groundTint: '#ffffff',
    barrier: { kind: 'foam', a: '#ff4fa3', b: '#ffffff', height: 1.1 },
    curb: ['#ff4f4f', '#ffffff'],
    hills: 10,
    hillScale: 0.012,
    dirt: { base: '#a8743f', specks: ['#8b5e30', '#c28b55', '#7a5129'] },
    sand: { base: '#f0d18a', specks: ['#e2bf73', '#f8e0a6', '#d9b066'] },
    gantry: { banner: '#5b3cff', text: '#ffffff', pillar: '#ff4fa3' },
    terrain: { alt: '#4aa755', rock: '#8a8f86', rockSlope: [0.3, 0.55], strata: 0, detail: 'grain' },
  },
  beach: {
    road: { base: '#50535f', speck: ['#646876', '#3f414b', '#777a88'], edge: '#ffffff', center: '#ffd23f', dashed: true },
    roadRoughness: 0.82,
    shoulder: { base: '#f3d9a0', specks: ['#e8c985', '#fbe7bb', '#dcb772'], blades: false },
    ground: { base: '#f5dca5', specks: ['#ecc987', '#fff0c8', '#dfbb76'], blades: false },
    groundTint: '#ffffff',
    barrier: { kind: 'foam', a: '#ff6f59', b: '#fff3e0', height: 1.0 },
    curb: ['#ff5f4a', '#ffffff'],
    hills: 9,
    hillScale: 0.008,
    signedHills: true,
    water: { color: '#2fd0d8', deep: '#1467c9', level: -1.6 },
    dirt: { base: '#e6c38a', specks: ['#d6ae70', '#f2d7a5', '#c99d5d'] },
    sand: { base: '#f3d9a0', specks: ['#e8c985', '#fbe7bb', '#dcb772'] },
    gantry: { banner: '#ff6f59', text: '#ffffff', pillar: '#2fd0d8' },
    terrain: { alt: '#e7c585', rock: '#b9a58e', rockSlope: [0.32, 0.6], strata: 0, shore: { color: '#caa66c', height: -0.4 }, detail: 'ripple' },
  },
  city: {
    road: { base: '#2b2d3a', speck: ['#393c4d', '#22232e', '#44475a'], edge: '#e8ecff', center: '#ff4fa3', dashed: true },
    roadRoughness: 0.6,
    shoulder: { base: '#3a3d52', specks: ['#44485f', '#2f3245', '#50546e'], blades: false },
    ground: { base: '#2d2f42', specks: ['#383b52', '#25273a', '#44475e'], blades: false },
    groundTint: '#ffffff',
    barrier: { kind: 'neon', a: '#3de0ff', b: '#ff4fa3', height: 1.2 },
    curb: ['#3de0ff', '#1b1446'],
    hills: 0,
    hillScale: 0.01,
    dirt: { base: '#4b4e63', specks: ['#5a5d75', '#3d4052', '#6a6d85'] },
    sand: { base: '#a58c6c', specks: ['#b89f7d', '#8f775a'] },
    gantry: { banner: '#1b1446', text: '#3de0ff', pillar: '#ff4fa3' },
    terrain: { alt: '#25273a', rock: '#3a3d52', rockSlope: [0.3, 0.55], strata: 0, detail: 'grain' },
  },
  forest: {
    road: { base: '#4b4a52', speck: ['#5d5c66', '#3a3940', '#6b6a74'], edge: '#ffffff', center: '#ffffff', dashed: true },
    roadRoughness: 0.85,
    shoulder: { base: '#5aa84f', specks: ['#6fbd5d', '#4a9443', '#86cf6a'], blades: true },
    ground: { base: '#4f9e4a', specks: ['#63b457', '#3f8a3d', '#7cc466'], blades: true },
    groundTint: '#ffffff',
    barrier: { kind: 'wood', a: '#a0643a', b: '#ffd23f', height: 1.0 },
    curb: ['#ff4f4f', '#ffffff'],
    hills: 34,
    hillScale: 0.006,
    signedHills: true,
    water: { color: '#4fc6e8', deep: '#2b7fc0', level: -5 },
    dirt: { base: '#9b6a3e', specks: ['#85592f', '#b27c4c', '#6f4a28'] },
    sand: { base: '#d8c08a', specks: ['#c8ae74', '#e6d09c'] },
    gantry: { banner: '#2ec27e', text: '#ffffff', pillar: '#a0643a' },
    terrain: { alt: '#3d8a3a', rock: '#8e8a82', rockSlope: [0.26, 0.48], strata: 0.08, shore: { color: '#8d7a58', height: -3.9 }, detail: 'grain' },
  },
  desert: {
    road: { base: '#5b5352', speck: ['#6e6564', '#4a4342', '#7d7372'], edge: '#ffffff', center: '#ffb13d', dashed: false },
    roadRoughness: 0.88,
    shoulder: { base: '#e7b178', specks: ['#d99c5f', '#f2c592', '#c98a52'], blades: false },
    ground: { base: '#e3a56a', specks: ['#d69257', '#efbb86', '#c7824a'], blades: false },
    groundTint: '#ffffff',
    barrier: { kind: 'rock', a: '#c9744a', b: '#e59a5c', height: 3.5 },
    curb: ['#ff5f4a', '#fff3e0'],
    hills: 18,
    hillScale: 0.009,
    dirt: { base: '#c48656', specks: ['#b07446', '#d69a68', '#9c653a'] },
    sand: { base: '#efc28c', specks: ['#e2ae74', '#f7d4a6', '#d69c62'] },
    gantry: { banner: '#ff8a3d', text: '#fff6e0', pillar: '#7a3b2a' },
    terrain: { alt: '#d18b52', rock: '#b35a38', rockSlope: [0.22, 0.46], strata: 0.22, detail: 'ripple' },
  },
};
