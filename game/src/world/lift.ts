import * as THREE from 'three/webgpu';
import {
  uniform, color, float, mix, smoothstep, positionWorld, positionLocal, mx_fractal_noise_float, sin, time, abs, fract, vec3,
} from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../core/palette';
import { heightAt } from './terrain';

/**
 * A dead lift at the arcade's pier: a lattice tower of two toothed guide rails climbing to the
 * elevated route, a head frame with a sheave and a cable down to the cage, a seized winding
 * motor at the foot, and the cage itself: a grated floor in an angle-iron frame, railings, guide
 * shoes clasping the rails, and a receiver post where a hand can give it power. Powered, cyan
 * light climbs the rails' seams with the cage; it only rises while it is being given power.
 * Local +z faces the gate; the rails and the arcade are behind it (−z).
 */
export class Lift {
  root = new THREE.Group();
  platform = new THREE.Group();
  /** Metres the platform has risen (0 .. travel). */
  rise = 0;
  readonly travel: number;
  readonly ground: number;
  /** 0..1: power in the rails and the receiver. */
  readonly power = uniform(0);
  private uRise = uniform(0);
  private cable: THREE.Mesh;
  private head: number;

  constructor(scene: THREE.Scene, at: THREE.Vector3, yaw: number, top: number) {
    this.ground = heightAt(at.x, at.z);
    this.travel = Math.max(1, top - this.ground - 0.16);
    this.root.position.set(at.x, this.ground, at.z);
    this.root.rotation.y = yaw;
    this.root.name = 'lift';

    const iron = ironMaterial(0.35, 0.75);
    const dark = ironMaterial(0.5, 0.6, 0.55);

    // Rails: channel sections with a seam down their front face that fills with power as high
    // as the cage has climbed (and flows a little above it). Each rail keeps its own origin at
    // its centre line, so the seam can be found in its local space.
    const rail = ironMaterial(0.4, 0.7);
    const uRise = this.uRise;
    const seam = smoothstep(0.022, 0.0, abs(positionLocal.x)).mul(smoothstep(0.05, 0.075, positionLocal.z));
    const filled = smoothstep(uRise.add(0.8), uRise.add(0.2), positionLocal.y);
    const flow = fract(positionLocal.y.mul(0.8).sub(time.mul(1.6))).mul(0.5).add(0.5);
    rail.emissiveNode = color(PALETTE.cyan).mul(seam.mul(filled).mul(flow).mul(this.power).mul(2.6));
    const h = this.travel + 2.4;
    this.head = h - 0.4;
    for (const sx of [-1, 1]) {
      const parts: THREE.BufferGeometry[] = [];
      // Channel: web at the back, two flanges toward the gate, a lip either side of the seam.
      parts.push(box(0.2, h, 0.03, 0, h / 2 - 0.3, -0.07));
      parts.push(box(0.03, h, 0.15, -0.085, h / 2 - 0.3, 0));
      parts.push(box(0.03, h, 0.15, 0.085, h / 2 - 0.3, 0));
      parts.push(box(0.05, h, 0.02, -0.045, h / 2 - 0.3, 0.065));
      parts.push(box(0.05, h, 0.02, 0.045, h / 2 - 0.3, 0.065));
      // Rack teeth on the inner flange (the cage climbed on them once).
      for (let y = 0.1; y < h - 0.5; y += 0.14) parts.push(box(0.04, 0.06, 0.1, -sx * 0.115, y, 0));
      const m = new THREE.Mesh(merge(parts), rail);
      m.position.set(sx * 0.95, 0, -1.02);
      m.castShadow = m.receiveShadow = true;
      this.root.add(m);
    }

    // The tower's lattice behind the rails, its footing, the head frame, the motor.
    const tower: THREE.BufferGeometry[] = [];
    const dz = -1.2;
    for (let y = 0.6; y < h - 0.6; y += 2.1) {
      tower.push(box(2.0, 0.08, 0.08, 0, y, dz));                        // horizontal strut
      const y2 = Math.min(h - 0.6, y + 2.1);
      tower.push(strut(new THREE.Vector3(-0.95, y, dz), new THREE.Vector3(0.95, y2, dz), 0.05));
      tower.push(strut(new THREE.Vector3(0.95, y, dz), new THREE.Vector3(-0.95, y2, dz), 0.05));
      // Brackets tying the rails back to the lattice, bolted.
      for (const sx of [-0.95, 0.95]) {
        tower.push(box(0.22, 0.14, 0.22, sx, y, -1.13));
        for (const bx of [-0.06, 0.06]) tower.push(cyl(0.018, 0.04, sx + bx, y + 0.04, -1.0, 'z'));
      }
    }
    // Back legs raking down to the ground behind, for the height.
    for (const sx of [-1.05, 1.05]) tower.push(strut(new THREE.Vector3(sx, h * 0.55, dz), new THREE.Vector3(sx * 1.4, 0, -3.1), 0.07));
    // Head frame: a crossbeam, two cheeks, and the sheave between them.
    tower.push(box(2.4, 0.22, 0.34, 0, this.head, -1.02));
    tower.push(box(0.08, 0.7, 0.5, -0.24, this.head + 0.2, -0.86));
    tower.push(box(0.08, 0.7, 0.5, 0.24, this.head + 0.2, -0.86));
    // Footing: stone plinths under each rail, anchor plates and bolts.
    const footing: THREE.BufferGeometry[] = [];
    for (const sx of [-0.95, 0.95]) {
      footing.push(box(0.6, 0.35, 0.6, sx, -0.12, -1.02));
      tower.push(box(0.4, 0.04, 0.4, sx, 0.08, -1.02));
      for (const [bx, bz] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) tower.push(cyl(0.022, 0.07, sx + bx, 0.12, -1.02 + bz, 'y'));
    }
    const towerMesh = new THREE.Mesh(merge(tower), iron);
    towerMesh.castShadow = towerMesh.receiveShadow = true;
    this.root.add(towerMesh);
    const stoneMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
    stoneMat.colorNode = mix(color(PALETTE.sediment), color(PALETTE.bone).mul(0.8), mx_fractal_noise_float(positionWorld.mul(3), 2, 2, 0.5).mul(0.5).add(0.5));
    const foot = new THREE.Mesh(merge(footing), stoneMat);
    foot.receiveShadow = true;
    this.root.add(foot);

    // The sheave: a spoked wheel in the head frame.
    const sheave: THREE.BufferGeometry[] = [];
    const tor = new THREE.TorusGeometry(0.32, 0.045, 8, 28);
    sheave.push(tor);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI;
      const spoke = new THREE.BoxGeometry(0.64, 0.035, 0.035);
      spoke.rotateZ(a);
      sheave.push(spoke);
    }
    sheave.push(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 12).rotateX(Math.PI / 2));
    const sheaveMesh = new THREE.Mesh(merge(sheave), dark);
    sheaveMesh.rotation.y = Math.PI / 2;
    sheaveMesh.position.set(0, this.head + 0.2, -0.86);
    this.root.add(sheaveMesh);

    // The winding motor at the foot: a finned housing, a drum with cable, a dead junction box.
    const motor: THREE.BufferGeometry[] = [];
    motor.push(box(0.9, 0.6, 0.7, -1.9, 0.3, -1.6));
    for (let i = 0; i < 7; i++) motor.push(box(0.9, 0.03, 0.74, -1.9, 0.12 + i * 0.07, -1.6));
    motor.push(cyl(0.28, 0.7, -1.9, 0.55, -0.95, 'x'));
    for (let i = 0; i < 9; i++) motor.push(new THREE.TorusGeometry(0.3, 0.02, 5, 20).rotateY(Math.PI / 2).translate(-2.2 + i * 0.07, 0.55, -0.95));
    motor.push(box(0.3, 0.4, 0.14, -1.3, 0.55, -1.95));
    const motorMesh = new THREE.Mesh(merge(motor), dark);
    motorMesh.castShadow = motorMesh.receiveShadow = true;
    this.root.add(motorMesh);

    // The cage: an angle-iron frame round a grated floor, railings on three sides, guide shoes
    // clasping the rails, and the receiver post.
    const cage: THREE.BufferGeometry[] = [];
    const W = 0.9;
    for (const [x, z, w, d] of [[0, W, 1.8, 0.07], [0, -W, 1.8, 0.07], [-W, 0, 0.07, 1.8], [W, 0, 0.07, 1.8]] as const) {
      cage.push(box(w, 0.12, d, x, 0.08, z));
    }
    for (let i = -6; i <= 6; i++) cage.push(box(0.025, 0.05, 1.76, i * 0.135, 0.11, 0));      // grating bars
    for (let i = -6; i <= 6; i++) cage.push(box(1.76, 0.03, 0.02, 0, 0.1, i * 0.135));        // cross bars
    // Railings: posts, a top rail and a mid rail on the sides and back.
    for (const [x0, z0, x1, z1] of [[-W, W, -W, -W], [W, W, W, -W], [-W, -W, W, -W]] as const) {
      const a = new THREE.Vector3(x0, 0, z0), b = new THREE.Vector3(x1, 0, z1);
      for (let k = 0; k <= 3; k++) {
        const p = a.clone().lerp(b, k / 3);
        cage.push(box(0.045, 1.0, 0.045, p.x, 0.6, p.z));
      }
      for (const y of [0.62, 1.08]) cage.push(strut(a.clone().setY(y), b.clone().setY(y), 0.03));
    }
    // Guide shoes on the back corners, reaching to the rails.
    for (const sx of [-0.95, 0.95]) {
      cage.push(box(0.3, 0.3, 0.12, sx, 0.25, -0.98));
      cage.push(box(0.3, 0.3, 0.12, sx, 1.0, -0.98));
      cage.push(box(0.06, 0.95, 0.06, sx, 0.62, -0.92));
    }
    // The receiver post, its housing, and a lead running back to the rail.
    cage.push(box(0.22, 1.02, 0.22, 0.35, 0.64, -0.72));
    cage.push(box(0.34, 0.34, 0.12, 0.35, 1.08, -0.64));
    cage.push(strut(new THREE.Vector3(0.35, 0.9, -0.8), new THREE.Vector3(0.9, 0.5, -0.95), 0.025));
    const cageMesh = new THREE.Mesh(merge(cage), iron);
    cageMesh.castShadow = cageMesh.receiveShadow = true;
    this.platform.add(cageMesh);
    // The receiver plate: a ring that lights with the power given.
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 24), dark);
    plate.rotation.x = Math.PI / 2;
    plate.position.set(0.35, 1.08, -0.58);
    this.platform.add(plate);
    const ringMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    ringMat.fog = false;
    ringMat.colorNode = color(PALETTE.cyan).mul(this.power.mul(sin(time.mul(6)).mul(0.1).add(0.9)).mul(2));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.13, 32), ringMat);
    ring.position.set(0.35, 1.08, -0.553);
    this.platform.add(ring);
    this.root.add(this.platform);

    // The hoist cable: from the sheave down to the cage's crossbar (it shortens as she rises).
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 6).translate(0, -0.5, 0), dark);
    this.cable.position.set(0, this.head - 0.1, -0.86);
    this.root.add(this.cable);
    this.height = 0;
    scene.add(this.root);
  }

  /** Move the platform to `rise` metres up. */
  set height(m: number) {
    this.rise = THREE.MathUtils.clamp(m, 0, this.travel);
    this.platform.position.y = this.rise;
    this.uRise.value = this.rise + 0.3;
    this.cable.scale.y = Math.max(0.05, this.head - 0.1 - (this.rise + 1.1));
  }
  get height() { return this.rise; }

  /** The platform's top (world y). */
  floor() { return this.root.position.y + this.rise + 0.14; }

  /** Where her palm goes on the receiver (world). */
  plate() { return this.platform.localToWorld(new THREE.Vector3(0.35, 1.08, -0.52)); }

  /** A lift-local point in world space (on the platform's floor). */
  local(x: number, z: number) {
    return this.root.localToWorld(new THREE.Vector3(x, 0, z)).setY(this.floor());
  }
}

/** Corroded iron: dark metal with rust bleeding down it and paler pewter where it's worn. */
function ironMaterial(metal: number, rough: number, dim = 1) {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const n = mx_fractal_noise_float(p.mul(2.2), 3, 2, 0.5);
  const streak = mx_fractal_noise_float(vec3(p.x.mul(6), p.y.mul(0.4), p.z.mul(6)), 2, 2, 0.5);
  const pit = smoothstep(0.35, 0.6, mx_fractal_noise_float(p.mul(14), 2, 2, 0.5));
  m.colorNode = mix(color(PALETTE.charcoal), mix(color(PALETTE.rust).mul(0.9), color(PALETTE.pewter), smoothstep(-0.3, 0.3, n)), smoothstep(-0.1, 0.6, streak).mul(0.6))
    .mul(float(1).sub(pit.mul(0.25))).mul(dim);
  m.roughnessNode = float(rough).add(pit.mul(0.15));
  m.metalnessNode = float(metal);
  return m;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function cyl(r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z') {
  const g = new THREE.CylinderGeometry(r, r, len, 10);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return g.translate(x, y, z);
}

/** A square beam from a to b. */
function strut(a: THREE.Vector3, b: THREE.Vector3, t: number) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(t, len, t);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  const c = a.clone().add(b).multiplyScalar(0.5);
  return g.translate(c.x, c.y, c.z);
}

/** One geometry from many (all non-indexed, position + normal + uv). */
function merge(parts: THREE.BufferGeometry[]) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of flat) { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
  return mergeGeometries(flat, false)!;
}
