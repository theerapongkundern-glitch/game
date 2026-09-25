import * as THREE from 'three';
import type { Renderer } from '../../core/Renderer';
import { Sky } from '../../core/Sky';
import { buildCarModel, type CarVisual } from '../../vehicles/CarModel';
import type { CarDef } from '../../vehicles/CarDefs';
import { damp, dampAngle } from '../../core/math';

/** Studio turntable for the garage: rotate the car 360°, change paint. */
export class GarageScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private car: CarVisual | null = null;
  private readonly turntable: THREE.Group;
  private readonly sky: Sky;
  private env: THREE.Texture;
  private ring: THREE.MeshBasicMaterial;
  /** Current / target yaw of the turntable. */
  yaw = 0.6;
  targetYaw = 0.6;
  autoRotate = true;
  private t = 0;
  private idle = 0;
  private locked = false;
  /** Camera framing offset (the car sits to the side of the UI). */
  offsetX = 0;

  constructor(private readonly renderer: Renderer) {
    this.sky = new Sky('dusk');
    this.sky.addTo(this.scene);
    this.scene.fog = new THREE.FogExp2('#3a2d6b', 0.012);
    this.env = this.sky.makeEnvironment(renderer.gl);
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 1.1;
    this.sky.sun.intensity = 2.2;
    this.sky.sun.shadow.mapSize.set(1024, 1024);
    this.sky.sun.castShadow = renderer.preset.shadows > 0;
    this.sky.follow(0, 0, 0, 0);
    const rim = new THREE.DirectionalLight('#7fdcff', 1.6);
    rim.position.set(-6, 4, -6);
    this.scene.add(rim);
    const fill = new THREE.PointLight('#ff4fa3', 30, 18);
    fill.position.set(4, 2.5, 4);
    this.scene.add(fill);

    // Floor + turntable.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2a2150', roughness: 0.35, metalness: 0.2 }));
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.turntable = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.18, 64), new THREE.MeshStandardMaterial({ color: '#3b2f7a', roughness: 0.25, metalness: 0.5 }));
    disc.position.y = 0.09;
    disc.receiveShadow = true;
    this.turntable.add(disc);
    this.ring = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff4fa3').multiplyScalar(2) });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.05, 8, 96).rotateX(Math.PI / 2), this.ring);
    ring.position.y = 0.18;
    this.turntable.add(ring);
    this.scene.add(this.turntable);
    // Floating light bars for a showroom vibe.
    const barMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#3de0ff').multiplyScalar(1.8) });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 5, 0.12), barMat);
      bar.position.set(Math.cos(a) * 9, 2.5, Math.sin(a) * 9);
      this.scene.add(bar);
    }
    this.camera = new THREE.PerspectiveCamera(40, renderer.width / renderer.height, 0.1, 500);
  }

  setCar(def: CarDef, color: string, locked: boolean) {
    if (this.car) {
      this.turntable.remove(this.car.root);
      this.car.dispose();
    }
    this.locked = locked;
    this.car = buildCarModel(def, locked ? '#15122a' : color, this.renderer.quality === 'low' ? 'medium' : 'high');
    this.car.root.position.y = 0.18;
    this.car.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    if (locked) {
      this.car.root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const m = o.material as THREE.MeshStandardMaterial;
          if (m.color) m.color.set('#15122a');
          if (m.emissive) m.emissive.set('#000000');
        }
      });
    }
    this.turntable.add(this.car.root);
    this.ring.color.set(new THREE.Color(locked ? '#555577' : color).multiplyScalar(2));
  }

  setColor(color: string) {
    if (!this.car || this.locked) return;
    this.car.setColor(color);
    this.ring.color.set(new THREE.Color(color).multiplyScalar(2));
  }

  /** User rotation input (radians). */
  spin(delta: number) {
    this.targetYaw += delta;
    this.idle = 0;
  }

  render(dt: number) {
    this.t += dt;
    this.idle += dt;
    if (this.autoRotate && this.idle > 2.5) this.targetYaw += dt * 0.45;
    this.yaw = dampAngle(this.yaw, this.targetYaw, 8, dt);
    this.turntable.rotation.y = this.yaw;
    if (this.car) {
      // Gentle idle bounce and spinning wheels for life.
      this.car.body.position.y = Math.sin(this.t * 2.2) * 0.012;
      for (const w of this.car.wheels) w.spin.rotation.x += dt * 1.5;
    }
    const cam = this.camera;
    const camX = damp(cam.position.x || 0, 0, 3, dt);
    cam.position.set(camX + 0.2 * Math.sin(this.t * 0.3), 2.3 + Math.sin(this.t * 0.4) * 0.08, 8.4);
    cam.lookAt(this.offsetX, 0.7, 0);
    this.renderer.render(this.scene, [{ camera: cam, x: 0, y: 0, w: 1, h: 1 }], dt, { blur: 0, aberration: 0, bloom: 0.35 });
  }

  dispose() {
    this.car?.dispose();
    this.env.dispose();
    this.sky.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
