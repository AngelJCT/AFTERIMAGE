import * as THREE from 'three/webgpu';
import { attribute, color, float, mix, normalize, normalWorld, cameraPosition, positionWorld, dot, abs, pow, max, uniform } from 'three/tsl';
import { SUN_DIR } from './atmosphere';

/**
 * Forgetting, made visible (AFTERIMAGE's Gommage): small glassy flakes that peel away from
 * something, rise, turn over in the light and dissolve. One pool for the whole game:
 * - `burst(at, radius, n)`: a scatter peeling off a place (a memory spent, a piece of the route
 *   giving way, a title breaking up);
 * - `peel(points, n)`: off a set of surface points (her body, an afterimage of her);
 * - an ambient drift, faint, rising where the world comes apart far off (the fragmenting horizon).
 * Flakes are thin crystal slivers: pale, catching the sun on one face, the haze at their edges.
 */
const MAX = 600;

interface Flake { p: THREE.Vector3; v: THREE.Vector3; rot: THREE.Euler; spin: THREE.Vector3; size: number; life: number; age: number }

export class Flakes {
  readonly mesh: THREE.InstancedMesh;
  private flakes: Flake[] = [];
  private fade: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private ambientT = 0;
  /** 0..1: the faint ambient drift off the far fragments (0 turns it off). */
  ambient = 1;

  constructor(scene: THREE.Scene) {
    // A sliver: a thin irregular quad, a little bent.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, 0, 0.05, 0.1, -0.6, 0, 0.55, 0.05, 0.04, -0.05, 0.6, 0,
    ], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    g.setAttribute('fade', this.fade);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const uSun = uniform(SUN_DIR);
    const n = normalize(normalWorld), v = normalize(cameraPosition.sub(positionWorld));
    const facing = abs(dot(n, v));
    const glint = pow(max(abs(dot(n, normalize(uSun.add(v)))), 0.0), 24.0);
    mat.colorNode = mix(color(0xcfd6d8), color(0xfaf6ee), facing).add(color(0xfff2d8).mul(glint).mul(1.6));
    mat.opacityNode = attribute('fade', 'float').mul(float(0.25).add(facing.mul(0.45)).add(glint.mul(0.6))).min(1);
    this.mesh = new THREE.InstancedMesh(g, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'flakes';
    scene.add(this.mesh);
  }

  private spawn(at: THREE.Vector3, vel: THREE.Vector3, size: number, life: number) {
    if (this.flakes.length >= MAX) this.flakes.shift();
    this.flakes.push({
      p: at.clone(), v: vel, size, life, age: 0,
      rot: new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28),
      spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3),
    });
  }

  /** A scatter peeling off round `at` (radius r), rising. */
  burst(at: THREE.Vector3, r: number, n: number, size = 0.05, rise = 0.5, drift?: THREE.Vector3) {
    for (let i = 0; i < n; i++) {
      const o = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(r * 2);
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.4, rise * (0.5 + Math.random()), (Math.random() - 0.5) * 0.4);
      if (drift) v.add(drift);
      this.spawn(at.clone().add(o), v, size * (0.6 + Math.random() * 0.8), 2.5 + Math.random() * 2.5);
    }
  }

  /** Off a set of surface points (world), e.g. vertices of her body: they lift away from it. */
  peel(points: THREE.Vector3[], n: number, size = 0.035) {
    if (!points.length) return;
    for (let i = 0; i < n; i++) {
      const p = points[Math.floor(Math.random() * points.length)];
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.25, 0.3 + Math.random() * 0.5, (Math.random() - 0.5) * 0.25);
      this.spawn(p, v, size * (0.6 + Math.random() * 0.8), 2 + Math.random() * 2);
    }
  }

  update(dt: number, cam: THREE.Camera, her: THREE.Vector3, wind = 1) {
    // The ambient drift: a few rising where the world comes apart, in front of the camera.
    if (this.ambient > 0 && (this.ambientT -= dt) <= 0) {
      this.ambientT = 0.35 / this.ambient;
      const f = cam.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
      const a = (Math.random() - 0.5) * 1.6, d = 18 + Math.random() * 14;
      const dir = f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      const at = her.clone().addScaledVector(dir, d);
      at.y = her.y + Math.random() * 3;
      this.burst(at, 1.2, 3, 0.09, 0.35);
    }
    let i = 0;
    this.flakes = this.flakes.filter((f) => (f.age += dt) < f.life);
    for (const f of this.flakes) {
      f.v.x += Math.sin(f.age * 1.3 + f.p.y) * 0.08 * dt * wind;
      f.v.multiplyScalar(Math.exp(-dt * 0.3));
      f.p.addScaledVector(f.v, dt);
      f.rot.x += f.spin.x * dt; f.rot.y += f.spin.y * dt; f.rot.z += f.spin.z * dt;
      const k = f.age / f.life;
      // In quickly, out slowly, shrinking a little as it dissolves.
      const fade = Math.min(1, f.age * 4) * (1 - k * k);
      this.q.setFromEuler(f.rot);
      this.m.compose(f.p, this.q, this.s.setScalar(f.size * (1 - 0.4 * k)));
      this.mesh.setMatrixAt(i, this.m);
      this.fade.setX(i, fade);
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fade.needsUpdate = true;
  }
}
