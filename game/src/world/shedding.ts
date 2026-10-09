import * as THREE from 'three/webgpu';
import {
  abs, cameraPosition, color, dot, float, length, max, mix, mx_worley_noise_vec2, normalize, normalWorld, positionLocal,
  positionWorld, pow, smoothstep, uniform, frontFacing,
} from 'three/tsl';
import { SUN_DIR } from './atmosphere';

/**
 * What she has shed: over the still pool, an armillary of her own shell. Ivory ceramic plates
 * with the dark crack network of her body, set on broken, tilted rings that turn slowly, each
 * at its own pace, each drawn only part of the way round (as her core ring draws itself when
 * she reboots). Low down the rings are close and nearly level; higher up they open, tilt and
 * loosen until the topmost are only scattered plates drifting apart. More rings hang there the
 * further the story has gone.
 *
 * One instanced mesh per ring (a dozen or so draws); each plate is a slightly bent, irregular
 * shard of a few triangles.
 */
const RINGS = 14;

function plate(seed: number) {
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const n = 7;
  const pos: number[] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
    const rad = 0.55 + r() * 0.5;
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad * 0.75;
    // Bent like a piece of a curved shell.
    pos.push(x, y, -0.18 * (x * x + y * y));
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface Shedding {
  group: THREE.Group;
  /** 0..1: how many rings hang there (the story's progress). */
  setFill(k: number): void;
  update(dt: number): void;
}

export function createShedding(at: THREE.Vector3, platesPerRing: number, atmos: { uHorizon: any; uSunCol: any }): Shedding {
  const group = new THREE.Group();
  group.name = 'shedding';
  group.position.copy(at);

  // Ceramic: ivory, the crack network dark, the underside shadowed; lit by the sun, a pale rim,
  // and fading into the haze far off (drawn without the scene fog, which would erase it).
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  mat.fog = false;
  const n = normalize(normalWorld), v = normalize(cameraPosition.sub(positionWorld));
  const sun = max(dot(n, uniform(SUN_DIR)), 0.0);
  const facing = dot(n, v);
  const rim = pow(float(1).sub(abs(facing)), 3.0);
  const cells = mx_worley_noise_vec2(positionLocal.xy.mul(3.2));
  const crack = smoothstep(0.07, 0.0, cells.y.sub(cells.x));
  const ivory = color(0xe8e0d0), dark = color(0x2f2a25);
  const front = mix(ivory.mul(float(0.62).add(sun.mul(0.55))), dark, crack.mul(0.85));
  // The inside of the shell: unglazed bisque, a little warmer and duller, the cracks faint.
  const back = mix(color(0xc9bba6).mul(float(0.58).add(sun.mul(0.35))), dark, crack.mul(0.35));
  const base = mix(back, front, frontFacing.select(float(1), float(0)));
  const lit = base.add(atmos.uSunCol.mul(rim.mul(0.35)));
  const dist = length(positionWorld.sub(cameraPosition));
  mat.colorNode = mix(lit, atmos.uHorizon, smoothstep(20.0, 260.0, dist).mul(0.65));

  let s = 11;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const geos = [plate(3), plate(17), plate(29)];
  const rings: { pivot: THREE.Group; speed: number; mesh: THREE.InstancedMesh }[] = [];
  const o = new THREE.Object3D();
  for (let i = 0; i < RINGS; i++) {
    const t = i / (RINGS - 1);
    const pivot = new THREE.Group();
    pivot.position.y = 6 + t * 74;
    // Tilted more the higher it hangs.
    pivot.rotation.set((rnd() - 0.5) * (0.1 + t * 0.9), rnd() * Math.PI * 2, (rnd() - 0.5) * (0.1 + t * 0.9));
    group.add(pivot);
    const radius = 4 + t * 22 + rnd() * 2;
    // Drawn only part of the way round, in one or two arcs.
    const arc = 0.45 + rnd() * 0.45;
    const count = Math.round(platesPerRing * (0.6 + t * 0.8) * arc);
    const mesh = new THREE.InstancedMesh(geos[i % geos.length], mat, count);
    mesh.frustumCulled = false;
    for (let k = 0; k < count; k++) {
      const u = (k / count) * arc + (rnd() - 0.5) * 0.01;
      const a = u * Math.PI * 2;
      // Loose at the top: plates stray from the ring, up and down and out.
      const loose = t * t;
      const rr = radius + (rnd() - 0.5) * (0.6 + loose * 8);
      o.position.set(Math.cos(a) * rr, (rnd() - 0.5) * (0.3 + loose * 10), Math.sin(a) * rr);
      // Facing outward, tangent to the ring, each turned a little on its own.
      o.rotation.set((rnd() - 0.5) * (0.4 + loose * 2.5), -a - Math.PI / 2 + (rnd() - 0.5) * 0.4, (rnd() - 0.5) * (0.4 + loose * 2.5));
      o.scale.setScalar((0.35 + rnd() * 0.75) * (1 + t * 1.6));
      o.updateMatrix();
      mesh.setMatrixAt(k, o.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    pivot.add(mesh);
    rings.push({ pivot, mesh, speed: (0.015 + rnd() * 0.03) * (rnd() < 0.5 ? -1 : 1) });
  }

  return {
    group,
    setFill(k: number) {
      const shown = Math.max(1, Math.round(RINGS * Math.max(0, Math.min(1, k))));
      rings.forEach((r, i) => (r.pivot.visible = i < shown));
    },
    update(dt: number) {
      for (const r of rings) r.pivot.rotation.y += r.speed * dt;
    },
  };
}
