import * as THREE from 'three/webgpu';
import {
  attribute, color, float, mix, smoothstep, positionWorld, mx_fractal_noise_float, clamp, sin,
} from 'three/tsl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mulberry32 } from '../core/noise';
import { PALETTE } from '../core/palette';
import { bumpNormal, heightAt, MIRROR, POOL, SALT_FLAT, WAKE_POINT, WATER_LEVEL, LIFT, RUINS, gateLocal } from './terrain';
import { distToGrovePath, distToRoute, treeSpots } from './grove';
import { groveMaterial, HERO_TREES } from './groveKit';

/**
 * The grove floor from the Blender rock kit (blender/scripts/rock_kit.py): loose pebbles and
 * chunks everywhere, low salt-crusted outcrops in the shallows (as in the film's wide shot),
 * a few boulders away from the path, and fallen thorn twigs (grove bark material). Vertex colours: R = AO, G = mineral crust, B = water stain.
 */
export async function loadRockKit(url: string, count: number, onProgress?: (k: number) => void) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
  gltf.scene.updateMatrixWorld(true);
  const kit = new Map<string, THREE.Mesh>();
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) kit.set(o.name, o as THREE.Mesh); });

  const rng = mulberry32(5);
  const pool2 = new THREE.Vector2(POOL.x, POOL.z);
  const mirror2 = new THREE.Vector2(MIRROR.x, MIRROR.z);
  const placements = new Map<string, THREE.Matrix4[]>();
  const radii = new Map<string, number>();
  for (const [name, src] of kit) {
    if (!/^(crust|slab)/.test(name)) continue;
    src.geometry.computeBoundingBox();
    const box = src.geometry.boundingBox!.clone().applyMatrix4(src.matrixWorld);
    radii.set(name, Math.hypot(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)),
      Math.max(Math.abs(box.min.z), Math.abs(box.max.z))));
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const blockers: { a: THREE.Vector2; b: THREE.Vector2; r: number }[] = [];
  const place = (name: string, x: number, z: number, scale: number, sink: number, tilt = 0.12) => {
    // Boulders are solid; the rest are low enough to step over or through.
    if (name.startsWith('boulder')) blockers.push({ a: new THREE.Vector2(x, z), b: new THREE.Vector2(x, z), r: (name === 'boulder_b' ? 0.95 : 0.75) * scale });
    const src = kit.get(name);
    if (!src) return;
    e.set((rng() - 0.5) * tilt, rng() * Math.PI * 2, (rng() - 0.5) * tilt);
    q.setFromEuler(e);
    const vertical = 0.8 + rng() * 0.4;
    // Flat outcrops are decorative, not walkable surfaces. The new fractured beds
    // can reach farther than their centres; keep their entire footprint off the
    // routes and interaction pools. Consume the same seed values before trimming.
    const radius = radii.get(name);
    if (radius) {
      const v = new THREE.Vector2(x, z);
      const room = Math.min(distToRoute(v) - 0.85, distToGrovePath(v) - 0.65,
        v.distanceTo(pool2) - 2.2, v.distanceTo(mirror2) - 2.8);
      if (room <= 0.12) return;
      scale = Math.min(scale, room / (radius * 1.06));
    }
    m.compose(new THREE.Vector3(x, heightAt(x, z) - sink, z), q, new THREE.Vector3(scale, scale * vertical, scale));
    // Meshopt keeps quantised meshes in a scaled space with the inverse on the node.
    (placements.get(name) ?? placements.set(name, []).get(name)!).push(m.clone().multiply(src.matrixWorld));
  };
  // The marsh keeps an open heart of still water (its afterimage crosses it).
  const salt2 = new THREE.Vector2(SALT_FLAT.x, SALT_FLAT.z);
  const clear = (v: THREE.Vector2, route: number) =>
    distToRoute(v) >= route && v.distanceTo(pool2) >= 2.0 && v.distanceTo(mirror2) >= 2.6 && v.distanceTo(salt2) >= 3.4;

  // Loose floor: pebbles and chunks, mostly small.
  const loose: [string, number][] = [['pebble_a', 0.5], ['chunk_a', 0.2], ['chunk_b', 0.18], ['slab', 0.12]];
  let n = 0;
  for (let guard = 0; n < count && guard < count * 10; guard++) {
    const x = (rng() - 0.5) * 56 - 3, z = (rng() - 0.5) * 56 - 10;
    if (!clear(new THREE.Vector2(x, z), 1.1)) continue;
    let t = rng(), name = loose[0][0];
    for (const [k, w] of loose) { if ((t -= w) <= 0) { name = k; break; } }
    const s = 0.55 + Math.pow(rng(), 2) * 1.0;
    place(name, x, z, s, 0.02 * s);
    n++;
  }

  // Salt-crusted outcrops where the ground dips just under the water line.
  let crusts = 0;
  for (let guard = 0; crusts < Math.round(count * 0.09) && guard < 6000; guard++) {
    const x = (rng() - 0.5) * 50 - 3, z = (rng() - 0.5) * 50 - 10;
    const h = heightAt(x, z);
    if (h > WATER_LEVEL + 0.04 || h < WATER_LEVEL - 0.25) continue;
    const v = new THREE.Vector2(x, z);
    if (!clear(v, 1.4) || v.distanceTo(mirror2) < 3.4) continue;
    place(rng() < 0.55 ? 'crust_a' : 'crust_b', x, z, 0.6 + rng() * 0.7, 0.05, 0.06);
    crusts++;
  }

  // Hero outcrops in the first pool, framing the opening wide (clear of her kneeling side, +Z).
  for (let i = 0, guard = 0; i < 9 && guard < 2000; guard++) {
    const a = rng() * Math.PI * 2, r = 2.1 + rng() * 3.2;
    const x = POOL.x + Math.sin(a) * r, z = POOL.z + Math.cos(a) * r;
    const h = heightAt(x, z);
    if (h > WATER_LEVEL + 0.03 || h < WATER_LEVEL - 0.45) continue;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.9 && r < 3.6) continue;
    if (distToRoute(new THREE.Vector2(x, z)) < 1.0) continue;
    place(rng() < 0.5 ? 'crust_a' : 'crust_b', x, z, 0.5 + rng() * 0.6, 0.03, 0.06);
    i++;
  }

  // Fallen thorn twigs on dry ground, mostly under trees and around where she wakes.
  const trees = treeSpots(Math.round(count / 8));
  const twigNames = ['twig_a', 'twig_b', 'twig_c'];
  let twigs = 0;
  for (let guard = 0; twigs < Math.round(count * 0.4) && guard < 8000; guard++) {
    let x: number, z: number;
    if (rng() < 0.2) {
      const a = rng() * Math.PI * 2, r = 0.8 + rng() * 3;
      x = WAKE_POINT.x + Math.sin(a) * r; z = WAKE_POINT.z + Math.cos(a) * r;
    } else {
      const t = trees[Math.floor(rng() * trees.length)];
      const a = rng() * Math.PI * 2, r = 0.5 + rng() * 3.5;
      x = t.x + Math.sin(a) * r; z = t.y + Math.cos(a) * r;
    }
    if (heightAt(x, z) < WATER_LEVEL + 0.03) continue;
    const v = new THREE.Vector2(x, z);
    if (v.distanceTo(pool2) < 3 || v.distanceTo(mirror2) < 3.4) continue;
    place(twigNames[Math.floor(rng() * 3)], x, z, 0.7 + rng() * 0.6, 0.004, 0.05);
    twigs++;
  }

  // The salt marsh: a field of low crusted islands on the still water.
  for (let i = 0, guard = 0; i < 16 && guard < 3000; guard++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 8;
    const x = SALT_FLAT.x + Math.sin(a) * r, z = SALT_FLAT.z + Math.cos(a) * r;
    if (heightAt(x, z) > WATER_LEVEL + 0.03 || r < 3.4) continue;
    place(rng() < 0.5 ? 'crust_a' : 'crust_b', x, z, 0.6 + rng() * 0.9, 0.04, 0.05);
    i++;
  }

  // A few boulders, well off the path.
  let boulders = 0;
  for (let guard = 0; boulders < Math.round(count * 0.035) && guard < 3000; guard++) {
    const x = (rng() - 0.5) * 56 - 3, z = (rng() - 0.5) * 56 - 10;
    const v = new THREE.Vector2(x, z);
    if (!clear(v, 3.0) || distToGrovePath(v) < 2.5 || v.distanceTo(pool2) < 4 || v.distanceTo(mirror2) < 4.5 || v.distanceTo(new THREE.Vector2(LIFT.x, LIFT.z)) < 6) continue;
    const s = 0.7 + rng() * 0.6;
    place(rng() < 0.5 ? 'boulder_a' : 'boulder_b', x, z, s, 0.34 * s, 0.12);   // well seated, not perched
    boulders++;
  }

  // Rubble mounds, as in the boards: heaped either side of the refuge gate (clear of the door),
  // round the ruins, and here and there at the grove's edge. The big ones are solid.
  const mound = (name: string, x: number, z: number, s: number) => {
    place(name, x, z, s, 0.04 * s, 0.05);
    if (name !== 'mound_c') blockers.push({ a: new THREE.Vector2(x, z), b: new THREE.Vector2(x, z), r: (name === 'mound_a' ? 1.0 : 0.7) * s });
  };
  const moundName = () => { const t = rng(); return t < 0.35 ? 'mound_a' : t < 0.7 ? 'mound_b' : 'mound_c'; };
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const g = gateLocal(side * (3.4 + k * 1.3 + rng() * 0.8), -2.5 + rng() * 5);
      mound(k === 0 ? 'mound_a' : moundName(), g.x, g.z, 0.8 + rng() * 0.5);
    }
  }
  for (let i = 0, guard = 0; i < 4 && guard < 400; guard++) {
    const a = rng() * Math.PI * 2, r = 3 + rng() * 4;
    const x = RUINS.x + Math.sin(a) * r, z = RUINS.z + Math.cos(a) * r;
    if (!clear(new THREE.Vector2(x, z), 2.2) || heightAt(x, z) < WATER_LEVEL + 0.05) continue;
    mound(moundName(), x, z, 0.7 + rng() * 0.6);
    i++;
  }
  for (let i = 0, guard = 0; i < Math.round(count * 0.04) && guard < 3000; guard++) {
    const x = (rng() - 0.5) * 60 - 3, z = (rng() - 0.5) * 60 - 10;
    const v = new THREE.Vector2(x, z);
    if (!clear(v, 3.0) || distToGrovePath(v) < 2.8 || heightAt(x, z) < WATER_LEVEL + 0.05) continue;
    if (v.distanceTo(pool2) < 5 || v.distanceTo(mirror2) < 5 || v.distanceTo(new THREE.Vector2(LIFT.x, LIFT.z)) < 6) continue;
    mound(moundName(), x, z, 0.6 + rng() * 0.7);
    i++;
  }
  // Gravel: clumps of small stones over the dry ground (walkable), more near the rubble.
  for (let i = 0, guard = 0; i < Math.round(count * 0.11) && guard < 8000; guard++) {
    const x = (rng() - 0.5) * 56 - 3, z = (rng() - 0.5) * 56 - 10;
    const v = new THREE.Vector2(x, z);
    if (!clear(v, 0.9) || heightAt(x, z) < WATER_LEVEL + 0.02) continue;
    place(rng() < 0.5 ? 'gravel_a' : 'gravel_b', x, z, 0.7 + rng() * 0.7, 0.005, 0.04);
    i++;
  }

  // Small fragments ground the opening shot. Add them after the existing placements so
  // consuming random rotations cannot move the world's boulders or collision obstacles.
  const detailRng = mulberry32(9107);
  for (let i = 0; i < 34; i++) {
    const a = detailRng() * Math.PI * 2, r = 0.65 + Math.sqrt(detailRng()) * 2.1;
    const x = WAKE_POINT.x + Math.sin(a) * r, z = WAKE_POINT.z + Math.cos(a) * r;
    if (Math.abs(x - WAKE_POINT.x) < 0.45 || heightAt(x, z) < WATER_LEVEL - 0.1) continue;
    place('pebble_a', x, z, 0.18 + detailRng() * 0.4, 0.008, 0.18);
  }

  // A few related beds on the pool's banks give the scattered crust a geological
  // direction. Sample the low side of each bed so its base settles into the shore.
  // These remain below step height and outside the kneeling area.
  const shoreBeds = [
    { x: POOL.x - 4.2, z: POOL.z + 1.7, scale: 0.82, yaw: 0.3 },
    { x: POOL.x + 3.6, z: POOL.z - 3.0, scale: 0.7, yaw: 0.45 },
  ];
  for (const bed of shoreBeds) {
    for (let i = 0; i < 3; i++) {
      const scale = bed.scale * (i === 0 ? 1 : 0.32 + detailRng() * 0.14);
      const x = bed.x + (i === 0 ? 0 : (i === 1 ? -0.85 : 0.8));
      const z = bed.z + (i === 0 ? 0 : 0.42 + detailRng() * 0.3);
      const src = kit.get(i === 0 ? 'crust_b' : 'slab')!;
      const seat = Math.min(heightAt(x, z), heightAt(x - scale, z), heightAt(x + scale, z),
        heightAt(x, z - scale * 0.6), heightAt(x, z + scale * 0.6));
      e.set(0, bed.yaw + (detailRng() - 0.5) * 0.22, 0);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, seat - 0.018, z), q, new THREE.Vector3(scale, scale, scale));
      (placements.get(src.name) ?? placements.set(src.name, []).get(src.name)!).push(m.clone().multiply(src.matrixWorld));
    }
  }

  // Small fragments and fallen twigs caught between the landmark trees' roots.
  // Appended after all solid props so their seeded placements and blockers stay stable.
  for (const tree of HERO_TREES) {
    for (let i = 0; i < 9; i++) {
      const a = detailRng() * Math.PI * 2, radius = 0.42 + detailRng() * 0.68;
      const x = tree.x + Math.cos(a) * radius, z = tree.z + Math.sin(a) * radius;
      if (!clear(new THREE.Vector2(x, z), 1.2)) continue;
      place(i % 4 === 0 ? 'twig_c' : i % 3 === 0 ? 'slab' : 'chunk_b', x, z,
        0.16 + detailRng() * 0.22, 0.016, 0.1);
    }
  }

  const mat = rockMaterial();
  const bark = groveMaterial();
  const group = new THREE.Group();
  group.name = 'rocks';
  group.userData.blockers = blockers;
  for (const [name, mats] of placements) {
    const inst = new THREE.InstancedMesh(kit.get(name)!.geometry, name.startsWith('twig') ? bark : mat, mats.length);
    mats.forEach((mm, i) => inst.setMatrixAt(i, mm));
    // Small stuff (pebbles, twigs, crust) casts too little to be worth a shadow pass draw.
    inst.castShadow = !/^(pebble|twig|crust|gravel)/.test(name);
    inst.receiveShadow = true;
    inst.name = name;
    group.add(inst);
  }
  return group;
}

function rockMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const c = attribute('color', 'vec4');
  const ao = c.r;
  const vary = mx_fractal_noise_float(positionWorld.mul(1.7), 3, 2, 0.5);
  const crust = smoothstep(0.3, 0.75, clamp(c.g.add(vary.mul(0.3)), 0.0, 1.0));
  const stain = smoothstep(0.25, 0.8, c.b);
  // Dark mineral body, pale salt crust on top, a wet olive-dark band where water sits.
  const body = mix(color(PALETTE.charcoal).mul(1.6), color(PALETTE.sediment), vary.mul(0.5).add(0.5));
  const top = mix(body, color(PALETTE.bone).mul(0.92), crust);
  const wet = mix(top, color(PALETTE.charcoal).mul(1.1), stain.mul(0.75));
  m.colorNode = wet.mul(mix(float(0.3), float(1.0), ao));
  m.roughnessNode = mix(mix(float(0.82), float(0.95), crust), float(0.5), stain);
  m.metalnessNode = float(0);
  // Relief: fractured crags, pitting, and thin sediment layers on the crusted tops.
  const pw = positionWorld;
  const crag = float(1).sub(mx_fractal_noise_float(pw.mul(5.5), 3, 2, 0.5).abs());
  const pits = mx_fractal_noise_float(pw.mul(31), 2, 2, 0.5).abs();
  const strata = sin(pw.y.mul(140).add(vary.mul(6))).mul(0.5).add(0.5);
  const relief = crag.mul(crag).mul(0.006).sub(pits.mul(0.0018)).add(strata.mul(0.0012).mul(crust));
  m.normalNode = bumpNormal(relief);
  m.colorNode = (m.colorNode as any).mul(mix(float(0.7), float(1.08), crag.mul(crag)).mul(float(1).sub(pits.mul(0.3))));
  return m;
}
