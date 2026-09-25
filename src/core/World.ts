import * as THREE from 'three';
import { Track } from '../tracks/Track';
import { buildTrackVisual, type TrackVisual } from '../tracks/TrackBuilder';
import { buildScenery } from '../tracks/scenery';
import type { SceneryResult } from '../tracks/scenery/common';
import type { TrackDef } from '../tracks/types';
import { Sky } from './Sky';
import { Effects } from './Particles';
import { SkidMarks } from './SkidMarks';
import type { Renderer } from './Renderer';

/** Everything static about a race location: track, scenery, sky, lights and particle pools. */
export class World {
  readonly scene = new THREE.Scene();
  readonly track: Track;
  readonly sky: Sky;
  readonly visual: TrackVisual;
  readonly scenery: SceneryResult;
  readonly effects: Effects;
  /** Tyre marks (Medium+). */
  readonly skids: SkidMarks | null;
  private envMap: THREE.Texture | null = null;
  time = 0;

  constructor(renderer: Renderer, readonly def: TrackDef) {
    const q = renderer.preset;
    this.track = new Track(def);
    this.sky = new Sky(def.sky, { physical: q.pbr, flare: q.flare });
    this.sky.addTo(this.scene);
    if (q.shadows > 0) {
      this.sky.sun.shadow.mapSize.set(q.shadows, q.shadows);
      this.sky.sun.castShadow = true;
    } else this.sky.sun.castShadow = false;
    this.envMap = this.sky.makeEnvironment(renderer.gl);
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = this.sky.preset.night ? 0.5 : 0.85;
    this.visual = buildTrackVisual(this.track, renderer.quality === 'low', q.terrainSeg);
    this.scene.add(this.visual.group);
    this.scenery = buildScenery(this.track, this.visual, q.scenery, q.shadows >= 2048, { grass: q.grass, godRays: q.godRays });
    this.scene.add(this.scenery.group);
    this.effects = new Effects(renderer.quality);
    this.scene.add(this.effects.group);
    this.skids = renderer.quality === 'low' ? null : new SkidMarks(renderer.quality === 'ultra' ? 4000 : 2400);
    if (this.skids) this.scene.add(this.skids.mesh);
    renderer.setExposure(this.sky.preset.exposure);
  }

  update(dt: number, focus: THREE.Vector3) {
    this.time += dt;
    this.sky.follow(focus.x, focus.y, focus.z, this.time);
    this.visual.update(this.time);
    this.scenery.update(this.time, dt, focus);
    this.effects.update(dt);
  }

  dispose() {
    this.visual.dispose();
    this.scenery.dispose();
    this.effects.dispose();
    this.skids?.dispose();
    this.sky.dispose();
    this.envMap?.dispose();
    this.scene.clear();
  }
}
