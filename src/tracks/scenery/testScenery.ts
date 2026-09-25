import * as THREE from 'three';
import type { Track } from '../Track';
import type { TrackVisual } from '../TrackBuilder';
import { Rng } from '../../core/rng';
import { Bag, coloredMerge, instanced, scatter, translate, vcMat, type SceneryResult } from './common';

/** Proving ground: bright lollipop trees and traffic cones. */
export function buildTestScenery(track: Track, visual: TrackVisual, density: number): SceneryResult {
  const group = new THREE.Group();
  const bag = new Bag();
  const rng = new Rng(track.def.seed);
  const tree = bag.add(
    coloredMerge([
      { geo: translate(new THREE.CylinderGeometry(0.25, 0.35, 3, 6), 0, 1.5, 0), color: '#8a5a3a' },
      { geo: translate(new THREE.IcosahedronGeometry(2.2, 0), 0, 4.2, 0), color: '#5fd35f' },
    ]),
  );
  const mat = bag.add(vcMat({ flatShading: true }));
  const places = scatter(visual, rng, track.bounds, Math.floor(260 * density), { minGap: 4, maxDist: 260, scale: [0.8, 1.6], hug: 0.6 });
  const palette = ['#5fd35f', '#ff8fb8', '#ffd23f', '#7fdcff', '#b9f06b'].map((c) => new THREE.Color(c));
  group.add(
    instanced(tree, mat, places, {
      cast: true,
      color: (_p, i) => (i % 4 === 0 ? palette[i % palette.length] : null),
    }),
  );
  const cone = bag.add(
    coloredMerge([
      { geo: translate(new THREE.ConeGeometry(0.35, 0.9, 8), 0, 0.45, 0), color: '#ff7a1a' },
      { geo: translate(new THREE.CylinderGeometry(0.26, 0.3, 0.12, 8), 0, 0.45, 0), color: '#ffffff' },
    ]),
  );
  const cones = scatter(visual, rng, track.bounds, 80, { minGap: 1, maxDist: 40, scale: [1, 1.2] });
  group.add(instanced(cone, mat, cones, { cast: false }));
  return {
    group,
    update() {},
    dispose: () => bag.dispose(),
  };
}
