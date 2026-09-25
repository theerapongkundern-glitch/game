import type { Track } from '../Track';
import type { TrackVisual } from '../TrackBuilder';
import type { SceneryExtras, SceneryResult } from './common';
export type { SceneryExtras, SceneryResult };
import { buildTestScenery } from './testScenery';
import { buildBeachScenery } from './beach';
import { buildCityScenery } from './city';
import { buildForestScenery } from './forest';
import { buildDesertScenery } from './desert';
import { buildTrackside } from './trackside';
import { THEMES } from '../themes';

/** Builds the themed props for a track. `density` scales instance counts with quality. */
export function buildScenery(track: Track, visual: TrackVisual, density: number, shadows: boolean, extras: SceneryExtras = { grass: 0, godRays: false }): SceneryResult {
  // Grandstands etc. first, so the themed scatter keeps clear of them.
  const side = track.def.theme === 'test' ? null : buildTrackside(track, visual, THEMES[track.def.theme], density, shadows, track.def.sky === 'night');
  let res: SceneryResult;
  switch (track.def.theme) {
    case 'beach':
      res = buildBeachScenery(track, visual, density, shadows);
      break;
    case 'city':
      res = buildCityScenery(track, visual, density, shadows);
      break;
    case 'forest':
      res = buildForestScenery(track, visual, density, shadows, extras);
      break;
    case 'desert':
      res = buildDesertScenery(track, visual, density, shadows);
      break;
    default:
      res = buildTestScenery(track, visual, density);
  }
  if (!side) return res;
  res.group.add(side.group);
  return {
    group: res.group,
    update(time, dt, focus) {
      res.update(time, dt, focus);
      side.update(time);
    },
    setCheer: (v) => side.setCheer(v),
    dispose() {
      res.dispose();
      side.dispose();
    },
  };
}

