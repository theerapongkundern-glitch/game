import type { TrackDef } from './types';
import { coconutCoast } from './defs/coconutCoast';
import { neonNightway } from './defs/neonNightway';
import { pinecrestRidge } from './defs/pinecrestRidge';
import { sunstoneCanyon } from './defs/sunstoneCanyon';
import { testTrack } from './defs/testTrack';

/** Race tracks in Grand Prix order. Add a new track here (see README). */
export const TRACKS: TrackDef[] = [coconutCoast, pinecrestRidge, neonNightway, sunstoneCanyon];

/** Which cup unlocks each track (tracks not listed are available from the start). */
export const TRACK_UNLOCKS: Record<string, 'start' | 'bronze' | 'silver' | 'gold'> = {
  'coconut-coast': 'start',
  'pinecrest-ridge': 'start',
  'neon-nightway': 'bronze',
  'sunstone-canyon': 'silver',
};

export function getTrack(id: string): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? (id === testTrack.id ? testTrack : TRACKS[0]);
}

export { testTrack };
