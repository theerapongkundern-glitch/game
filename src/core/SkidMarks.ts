import * as THREE from 'three';

/**
 * Persistent tyre marks on the asphalt. A fixed ring buffer of quads (one draw call): each
 * sliding rear wheel extends its own strip, and the oldest segments are recycled first.
 */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly geo: THREE.BufferGeometry;
  private head = 0;
  private dirty = false;
  /** Last point per wheel key (strip continuity). */
  private readonly last = new Map<string, { x: number; y: number; z: number; lx: number; lz: number; a: number }>();

  constructor(max = 2400) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.col = new Float32Array(max * 4 * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      const v = i * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'skidmarks';
  }

  /**
   * Feeds one wheel's contact point. `strength` 0 ends the strip; otherwise a segment is laid
   * every ~0.3 m with opacity proportional to strength.
   */
  track(key: string, x: number, y: number, z: number, width: number, strength: number) {
    const prev = this.last.get(key);
    if (strength <= 0.02) {
      if (prev) this.last.delete(key);
      return;
    }
    if (!prev) {
      this.last.set(key, { x, y, z, lx: 0, lz: 0, a: strength });
      return;
    }
    const dx = x - prev.x;
    const dz = z - prev.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.09) return;
    if (d2 > 144) {
      // Teleported (reset/respawn): start a fresh strip.
      this.last.set(key, { x, y, z, lx: 0, lz: 0, a: strength });
      return;
    }
    const len = Math.sqrt(d2);
    const lx = (-dz / len) * width * 0.5;
    const lz = (dx / len) * width * 0.5;
    const plx = prev.lx || lx;
    const plz = prev.lz || lz;
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const p = this.pos;
    const o = i * 12;
    const lift = 0.025;
    p[o] = prev.x - plx;
    p[o + 1] = prev.y + lift;
    p[o + 2] = prev.z - plz;
    p[o + 3] = prev.x + plx;
    p[o + 4] = prev.y + lift;
    p[o + 5] = prev.z + plz;
    p[o + 6] = x - lx;
    p[o + 7] = y + lift;
    p[o + 8] = z - lz;
    p[o + 9] = x + lx;
    p[o + 10] = y + lift;
    p[o + 11] = z + lz;
    const c = this.col;
    const co = i * 16;
    const a0 = Math.min(0.55, prev.a * 0.55);
    const a1 = Math.min(0.55, strength * 0.55);
    for (let k = 0; k < 4; k++) {
      c[co + k * 4] = 0.03;
      c[co + k * 4 + 1] = 0.03;
      c[co + k * 4 + 2] = 0.035;
      c[co + k * 4 + 3] = k < 2 ? a0 : a1;
    }
    this.last.set(key, { x, y, z, lx, lz, a: strength });
    this.dirty = true;
  }

  /** Uploads new segments (call once per frame). */
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  clear() {
    this.pos.fill(0);
    this.col.fill(0);
    this.last.clear();
    this.dirty = true;
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
