import * as THREE from 'three';

/**
 * Anime-style speed streaks: thin additive quads flying past the camera, attached as a
 * child of the camera so they work in split-screen too. Intensity follows speed/boost.
 */
export class SpeedLines {
  readonly mesh: THREE.InstancedMesh;
  private readonly count: number;
  private readonly data: Float32Array; // angle, radius, z, speed, length
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly dummy = new THREE.Object3D();
  private intensity = 0;

  constructor(count = 70) {
    this.count = count;
    const geo = new THREE.PlaneGeometry(0.035, 1);
    geo.rotateX(Math.PI / 2); // length along z
    this.mat = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
    this.data = new Float32Array(count * 5);
    for (let i = 0; i < count; i++) this.reset(i, true);
  }

  private reset(i: number, initial: boolean) {
    const d = this.data;
    d[i * 5] = Math.random() * Math.PI * 2;
    d[i * 5 + 1] = 1.1 + Math.random() * 2.2;
    d[i * 5 + 2] = initial ? -Math.random() * 40 - 2 : -40 - Math.random() * 10;
    d[i * 5 + 3] = 0.8 + Math.random() * 0.6;
    d[i * 5 + 4] = 2 + Math.random() * 4;
  }

  /** `strength` 0..1 (speed fraction), `boost` adds extra streaks. */
  update(dt: number, strength: number, boost: boolean) {
    const target = Math.max(0, strength - 0.55) * 1.6 + (boost ? 0.55 : 0);
    this.intensity += (target - this.intensity) * Math.min(1, dt * 4);
    this.mat.opacity = Math.min(0.55, this.intensity * 0.45);
    this.mesh.visible = this.mat.opacity > 0.01;
    if (!this.mesh.visible) return;
    const speed = 60 + this.intensity * 90;
    const d = this.data;
    for (let i = 0; i < this.count; i++) {
      d[i * 5 + 2] += speed * d[i * 5 + 3] * dt;
      if (d[i * 5 + 2] > 1) this.reset(i, false);
      const a = d[i * 5];
      const r = d[i * 5 + 1];
      const len = d[i * 5 + 4] * (0.5 + this.intensity);
      this.dummy.position.set(Math.cos(a) * r, Math.sin(a) * r * 0.62, d[i * 5 + 2]);
      this.dummy.rotation.set(0, 0, a - Math.PI / 2); // face the camera (normal points at the view axis)
      this.dummy.scale.set(1, 1, len);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
