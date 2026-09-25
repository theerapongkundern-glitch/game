import type { Track } from '../Track';
import type { TrackVisual } from '../TrackBuilder';
import type { SceneryResult } from './common';
import { buildTestScenery } from './testScenery';

export function buildScenery(track: Track, visual: TrackVisual, density: number): SceneryResult {
  switch (track.def.theme) {
    default:
      return buildTestScenery(track, visual, density);
  }
}
