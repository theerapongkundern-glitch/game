import type { Track } from '../Track';
import type { TrackVisual } from '../TrackBuilder';
import type { SceneryResult } from './common';
import { buildTestScenery } from './testScenery';
import { buildBeachScenery } from './beach';
import { buildCityScenery } from './city';
import { buildForestScenery } from './forest';
import { buildDesertScenery } from './desert';

/** Builds the themed props for a track. `density` scales instance counts with quality. */
export function buildScenery(track: Track, visual: TrackVisual, density: number, shadows: boolean): SceneryResult {
  switch (track.def.theme) {
    case 'beach':
      return buildBeachScenery(track, visual, density, shadows);
    case 'city':
      return buildCityScenery(track, visual, density, shadows);
    case 'forest':
      return buildForestScenery(track, visual, density, shadows);
    case 'desert':
      return buildDesertScenery(track, visual, density, shadows);
    default:
      return buildTestScenery(track, visual, density);
  }
}
