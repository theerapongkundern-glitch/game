/** Driving surfaces and how they change grip, drag and effects. */

export type SurfaceType = 'asphalt' | 'wet' | 'grass' | 'sand' | 'dirt' | 'boost';

export type ParticleKind = 'smoke' | 'dust' | 'grass' | 'spray' | 'none';

export interface SurfaceProps {
  /** Multiplier on tyre grip (mu). */
  grip: number;
  /** Extra rolling resistance, in m/s² per (m/s). */
  drag: number;
  /** Soft top-speed cap as a fraction of the car's top speed. */
  maxSpeed: number;
  /** Particle emitted under wheels when sliding/driving fast. */
  particle: ParticleKind;
  /** Whether wheels kick particles even without sliding. */
  kicksUp: boolean;
  /** Tyre screech sound allowed. */
  screech: boolean;
  /** Camera/visual rumble amount. */
  rumble: number;
  label: string;
}

export const SURFACES: Record<SurfaceType, SurfaceProps> = {
  asphalt: { grip: 1.0, drag: 0.0, maxSpeed: 1.0, particle: 'smoke', kicksUp: false, screech: true, rumble: 0, label: 'Asphalt' },
  boost: { grip: 1.0, drag: 0.0, maxSpeed: 1.15, particle: 'smoke', kicksUp: false, screech: true, rumble: 0, label: 'Boost pad' },
  wet: { grip: 0.62, drag: 0.01, maxSpeed: 1.0, particle: 'spray', kicksUp: true, screech: false, rumble: 0.05, label: 'Wet road' },
  dirt: { grip: 0.78, drag: 0.06, maxSpeed: 0.82, particle: 'dust', kicksUp: true, screech: false, rumble: 0.25, label: 'Dirt' },
  grass: { grip: 0.72, drag: 0.1, maxSpeed: 0.7, particle: 'grass', kicksUp: true, screech: false, rumble: 0.35, label: 'Grass' },
  sand: { grip: 0.6, drag: 0.16, maxSpeed: 0.58, particle: 'dust', kicksUp: true, screech: false, rumble: 0.45, label: 'Sand' },
};
