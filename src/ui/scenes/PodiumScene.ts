import * as THREE from 'three';
import type { Renderer } from '../../core/Renderer';
import { Sky } from '../../core/Sky';
import { buildCarModel, type CarVisual } from '../../vehicles/CarModel';
import { getCarDef } from '../../vehicles/CarDefs';
import type { GPStanding } from '../../modes/GrandPrix';
import { ParticleSystem } from '../../core/Particles';
import { bannerTexture } from '../../tracks/textures';

const METAL = ['#ffcf40', '#d9dee8', '#d08a4a'];

function trophyGeometry(): THREE.BufferGeometry {
  // Lathe profile of a classic cup.
  const pts = [
    [0, 0],
    [0.55, 0],
    [0.55, 0.12],
    [0.22, 0.2],
    [0.14, 0.55],
    [0.14, 0.8],
    [0.35, 0.95],
    [0.62, 1.3],
    [0.7, 1.8],
    [0.62, 1.82],
    [0.5, 1.4],
    [0.0, 1.2],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 24);
  const handle = new THREE.TorusGeometry(0.28, 0.06, 8, 16, Math.PI * 1.2);
  const h1 = handle.clone().rotateZ(-Math.PI * 0.1).translate(0.68, 1.45, 0);
  const h2 = handle.clone().rotateZ(Math.PI * 1.1).translate(-0.68, 1.45, 0);
  const merged = new THREE.BufferGeometry();
  const parts = [g.toNonIndexed(), h1.toNonIndexed(), h2.toNonIndexed()];
  for (const p of parts) p.deleteAttribute('uv');
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nor.set(p.attributes.normal.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return merged;
}

/** 3D podium with the top three cars, trophies and falling confetti. */
export class PodiumScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly sky: Sky;
  private readonly env: THREE.Texture;
  private readonly cars: CarVisual[] = [];
  private readonly trophies: THREE.Mesh[] = [];
  private readonly confetti: ParticleSystem;
  private t = 0;

  constructor(
    private readonly renderer: Renderer,
    top3: GPStanding[],
  ) {
    this.sky = new Sky('sunset');
    this.sky.addTo(this.scene);
    this.scene.fog = new THREE.FogExp2('#f0a07c', 0.01);
    this.env = this.sky.makeEnvironment(renderer.gl);
    this.scene.environment = this.env;
    this.sky.follow(0, 0, 0, 0);
    this.sky.sun.castShadow = renderer.preset.shadows > 0;
    this.sky.sun.shadow.mapSize.set(1024, 1024);
    const spot = new THREE.SpotLight('#fff3d6', 60, 30, 0.6, 0.5);
    spot.position.set(0, 12, 6);
    this.scene.add(spot, spot.target);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3b2d6b', roughness: 0.6 }));
    floor.receiveShadow = true;
    this.scene.add(floor);
    const heights = [2.2, 1.5, 1.0];
    const xs = [0, -4.6, 4.6];
    const blockColors = ['#ffd23f', '#3de0ff', '#ff8a3d'];
    const trophyGeo = trophyGeometry();
    for (let i = 0; i < 3; i++) {
      const numTex = bannerTexture(String(i + 1), blockColors[i], '#1b1446', 256, 256);
      const side = new THREE.MeshStandardMaterial({ color: blockColors[i], roughness: 0.5 });
      const front = new THREE.MeshStandardMaterial({ map: numTex, roughness: 0.5 });
      const block = new THREE.Mesh(new THREE.BoxGeometry(4.2, heights[i], 4.2), [side, side, side, side, front, side]);
      block.position.set(xs[i], heights[i] / 2, 0);
      block.castShadow = true;
      block.receiveShadow = true;
      this.scene.add(block);
      const s = top3[i];
      if (s) {
        const car = buildCarModel(getCarDef(s.carId), s.color, 'high');
        car.root.position.set(xs[i], heights[i], -0.2);
        car.root.rotation.y = Math.PI + (i === 0 ? 0 : i === 1 ? 0.35 : -0.35);
        car.root.scale.setScalar(0.8);
        car.root.traverse((o) => {
          if (o instanceof THREE.Mesh) o.castShadow = true;
        });
        this.scene.add(car.root);
        this.cars.push(car);
      }
      const trophy = new THREE.Mesh(trophyGeo, new THREE.MeshStandardMaterial({ color: METAL[i], metalness: 1, roughness: 0.18, envMapIntensity: 2, side: THREE.DoubleSide }));
      trophy.position.set(xs[i], heights[i] + 2.3, 1.6);
      trophy.scale.setScalar(i === 0 ? 0.9 : 0.7);
      trophy.castShadow = true;
      this.scene.add(trophy);
      this.trophies.push(trophy);
    }
    this.confetti = new ParticleSystem(900, 'spark', THREE.NormalBlending);
    this.scene.add(this.confetti.points);
    this.camera = new THREE.PerspectiveCamera(42, renderer.width / renderer.height, 0.1, 500);
  }

  render(dt: number) {
    this.t += dt;
    const cols = [
      [1, 0.3, 0.64],
      [1, 0.82, 0.25],
      [0.24, 0.88, 1],
      [0.64, 0.9, 0.2],
      [0.7, 0.3, 1],
    ];
    for (let k = 0; k < 6; k++) {
      const c = cols[Math.floor(Math.random() * cols.length)];
      this.confetti.emit({ x: (Math.random() - 0.5) * 20, y: 14, z: (Math.random() - 0.5) * 10, vx: (Math.random() - 0.5) * 2, vy: -1, vz: (Math.random() - 0.5) * 2, life: 4, size: 0.35, endSize: 0.3, r: c[0], g: c[1], b: c[2], alpha: 1, gravity: 1.2, drag: 0.6 });
    }
    this.confetti.update(dt);
    this.trophies.forEach((tr, i) => {
      tr.rotation.y = this.t * (0.8 + i * 0.1);
      tr.position.y += Math.sin(this.t * 2 + i) * 0.002;
    });
    const a = Math.sin(this.t * 0.25) * 0.35;
    this.camera.position.set(Math.sin(a) * 15, 5.2, Math.cos(a) * 15);
    this.camera.lookAt(0, 2.2, 0);
    this.renderer.render(this.scene, [{ camera: this.camera, x: 0, y: 0, w: 1, h: 1 }], dt, { blur: 0, aberration: 0, bloom: 0.45 });
  }

  dispose() {
    for (const c of this.cars) c.dispose();
    this.confetti.dispose();
    this.env.dispose();
    this.sky.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else (m as THREE.Material).dispose();
      }
    });
  }
}
