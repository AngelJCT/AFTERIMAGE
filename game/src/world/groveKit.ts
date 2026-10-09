import * as THREE from 'three/webgpu';
import {
  attribute, color, float, mix, smoothstep, positionWorld, mx_fractal_noise_float, clamp, vec3, mx_worley_noise_vec2,
  normalMap, texture, uv,
} from 'three/tsl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mulberry32 } from '../core/noise';
import { PALETTE } from '../core/palette';
import { ARCHES, BEAM, BOUNDS, CROSS_WAKE, EXIT, GATE, SQUEEZE, STILL_POOL, bumpNormal, heightAt, WAKE_POINT } from './terrain';
import { SUN_DIR } from './atmosphere';

/**
 * Placed by hand for shots. The film's "this is where my memory begins" has branch shadows
 * all over her: trees 14–16 m toward the low sun (15° up) throw their crowns' shadows across the wake spot.
 */
const toSun = new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize();
export const HERO_TREES = [
  { name: 'tree_arch_a', x: WAKE_POINT.x + toSun.x * 16, z: WAKE_POINT.z + toSun.y * 16, yaw: 1.9, scale: 1.2 },
  { name: 'tree_tall_b', x: WAKE_POINT.x + toSun.x * 14 + 2.4, z: WAKE_POINT.z + toSun.y * 14 - 1.0, yaw: 0.4, scale: 1.1 },
];
import { groveSpots } from './grove';

/**
 * The grove from the Blender tree kit (blender/scripts/grove_kit.py), instanced over the
 * same spots as before. Vertex colours carry masks: R = baked AO, G = mineral crust, B = rust.
 */
export async function loadGroveKit(url: string, count: number, onProgress?: (k: number) => void, far = 0) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
  gltf.scene.updateMatrixWorld(true);
  const kit = new Map<string, THREE.Mesh>();
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) kit.set(o.name, o as THREE.Mesh); });

  // One bark material per kit mesh's baked normal map (the far silhouettes share theirs).
  const mats = new Map<THREE.Texture | null, THREE.Material>();
  const barkFor = (src: THREE.Mesh) => {
    const nm = ((src.material as THREE.MeshStandardMaterial)?.normalMap) ?? null;
    if (nm) nm.colorSpace = THREE.NoColorSpace;
    return mats.get(nm) ?? mats.set(nm, groveMaterial(nm)).get(nm)!;
  };
  // Mix of forms: mostly standing trees and arches, a few shrubs and fallen limbs.
  const table: [string, number][] = [
    ['tree_tall_a', 0.14], ['tree_tall_b', 0.14], ['tree_leaning', 0.14], ['tree_arch_a', 0.15],
    ['tree_arch_b', 0.15], ['shrub_a', 0.1], ['shrub_b', 0.1], ['log_fallen', 0.08],
  ];
  const rng = mulberry32(19);
  const pick = () => {
    let t = rng();
    for (const [n, w] of table) { if ((t -= w) <= 0) return n; }
    return table[0][0];
  };
  const placements = new Map<string, THREE.Matrix4[]>();
  const footprints = new Map<string, THREE.Vector3[]>();
  const obstacles: THREE.Vector2[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
  const spots = [
    ...groveSpots(count).trees.map((v) => ({ x: v.x, y: v.y, name: '', yaw: NaN, scale: NaN })),
    ...HERO_TREES.map((h) => ({ x: h.x, y: h.z, name: h.name, yaw: h.yaw, scale: h.scale })),
  ];
  for (const spot of spots) {
    const name = spot.name || pick();
    const src = kit.get(name);
    if (!src) continue;
    const k = Number.isNaN(spot.scale) ? 0.85 + rng() * 0.4 : spot.scale;
    e.set((rng() - 0.5) * 0.08, Number.isNaN(spot.yaw) ? rng() * Math.PI * 2 : spot.yaw, (rng() - 0.5) * 0.08);
    q.setFromEuler(e);
    s.setScalar(k);
    m.compose(new THREE.Vector3(spot.x, heightAt(spot.x, spot.y), spot.y), q, s);
    // Meshopt keeps quantised meshes in a scaled space with the inverse on the node.
    const full = m.clone().multiply(src.matrixWorld);
    const fp = footprints.get(name) ?? footprints.set(name, footprint(src)).get(name)!;
    for (const c of fp) {
      const w = c.clone().applyMatrix4(m);
      obstacles.push(new THREE.Vector2(w.x, w.z));
    }
    (placements.get(name) ?? placements.set(name, []).get(name)!).push(full);
  }

  const group = new THREE.Group();
  group.name = 'grove';
  group.userData.obstacles = obstacles;
  for (const [name, mats] of placements) {
    const src = kit.get(name)!;
    const inst = new THREE.InstancedMesh(src.geometry, barkFor(src), mats.length);
    mats.forEach((mm, i) => inst.setMatrixAt(i, mm));
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.name = name;
    group.add(inst);
  }
  // Far ring: giant silhouettes of the same forms deep in the haze, for scale. No shadows.
  // The line of sight from the way out to the arcade stays open.
  if (far > 0) {
    const frng = mulberry32(41);
    const toArches = Math.atan2(ARCHES.x - EXIT.x, ARCHES.z - EXIT.z);
    const farMats = new Map<string, THREE.Matrix4[]>();
    const big = ['tree_tall_a', 'tree_tall_b', 'tree_arch_a', 'tree_arch_b', 'tree_leaning'];
    for (let i = 0, guard = 0; i < far && guard < far * 20; guard++) {
      const a = frng() * Math.PI * 2;
      const d = Math.atan2(Math.sin(a - toArches), Math.cos(a - toArches));
      if (Math.abs(d) < 0.3) continue;
      const r = 38 + frng() * 18;
      const x = BOUNDS.x + Math.sin(a) * r, z = BOUNDS.z + Math.cos(a) * r;
      if (Math.hypot(x - GATE.x, z - GATE.z) < 16) continue;   // the refuge gate stands here
      // Nor on the crossing (chapter V): they stand around it in the haze, not in its way.
      if ([CROSS_WAKE, BEAM.a, BEAM.b, SQUEEZE.b, STILL_POOL].some((p) => Math.hypot(x - p.x, z - p.z) < 12)) continue;
      // The low-detail copy of the form when the kit has one (they're only silhouettes in the haze).
      const form = big[Math.floor(frng() * big.length)];
      const name = kit.has(`${form}_far`) ? `${form}_far` : form;
      const src = kit.get(name);
      if (!src) continue;
      const k = 2.2 + frng() * 1.6;
      e.set(0, frng() * Math.PI * 2, (frng() - 0.5) * 0.1);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, heightAt(x, z) - 0.5, z), q, s.setScalar(k));
      (farMats.get(name) ?? farMats.set(name, []).get(name)!).push(m.clone().multiply(src.matrixWorld));
      i++;
    }
    for (const [name, mats] of farMats) {
      const inst = new THREE.InstancedMesh(kit.get(name)!.geometry, barkFor(kit.get(name)!), mats.length);
      mats.forEach((mm, i) => inst.setMatrixAt(i, mm));
      inst.castShadow = false;
      inst.receiveShadow = false;
      inst.name = `far_${name}`;
      group.add(inst);
    }
  }
  return group;
}

/**
 * Where a piece blocks a camera at head height: its vertices between 0.8 and 2.6 m,
 * bucketed into 0.35 m cells (piece space, one point per occupied cell).
 */
export function footprint(src: THREE.Mesh) {
  const pos = src.geometry.attributes.position;
  const v = new THREE.Vector3();
  const cells = new Map<string, THREE.Vector3>();
  for (let i = 0; i < pos.count; i += 3) {
    v.fromBufferAttribute(pos, i).applyMatrix4(src.matrixWorld);
    if (v.y < 0.8 || v.y > 2.6) continue;
    const key = `${Math.round(v.x / 0.35)},${Math.round(v.z / 0.35)}`;
    if (!cells.has(key)) cells.set(key, new THREE.Vector3(Math.round(v.x / 0.35) * 0.35, 0, Math.round(v.z / 0.35) * 0.35));
  }
  return [...cells.values()];
}

/**
 * The grove's bark. `barkMap` (optional): the kit's baked normal map (the round, finely ridged
 * limbs it was baked from); the procedural relief is bumped on top of it.
 */
export function groveMaterial(barkMap: THREE.Texture | null = null) {
  const m = new THREE.MeshStandardNodeMaterial();
  const c = attribute('color', 'vec4');
  const ao = c.r, crustBase = c.g, rustBase = c.b;
  // World-space variation so every instance of a variant looks different.
  const vary = mx_fractal_noise_float(positionWorld.mul(0.6), 2, 2, 0.5);
  const crust = clamp(crustBase.add(vary.mul(0.35)), 0.0, 1.0);
  const rust = smoothstep(0.35, 0.8, rustBase);
  const bark = mix(color(PALETTE.charcoal), color(PALETTE.bone).mul(0.78), smoothstep(0.35, 0.7, crust));
  m.colorNode = mix(bark, color(PALETTE.rust).mul(1.2), rust.mul(0.85)).mul(mix(float(0.35), float(1.0), ao));
  m.roughnessNode = mix(float(0.5), float(0.92), crust).add(rust.mul(0.08));
  m.metalnessNode = mix(float(0.3), float(0.0), crust);
  // Relief (metres): bark ridges running mostly up the limbs, fine grit, a crumbly surface
  // where the pale crust sits and flaking where it's rusted.
  const pw = positionWorld;
  const ridge = float(1).sub(mx_fractal_noise_float(vec3(pw.x.mul(9), pw.y.mul(1.6), pw.z.mul(9)), 2, 2, 0.5).abs());
  const grit = mx_fractal_noise_float(pw.mul(38), 2, 2, 0.5);
  const crumb = mx_fractal_noise_float(pw.mul(17), 2, 2, 0.5).abs();
  // Beaded crust, as in the boards: clusters of small round nodules (a centimetre or two)
  // crowding the limbs where the pale crust has grown, with dark crevices between them.
  const nod = mx_worley_noise_vec2(pw.mul(48));
  const bead = smoothstep(0.6, 0.08, nod.x);
  const clusters = smoothstep(-0.1, 0.45, mx_fractal_noise_float(pw.mul(2.6).add(vec3(7.1, 0, 3.3)), 2, 2, 0.5))
    .mul(smoothstep(0.2, 0.55, crust));
  const beads = bead.mul(clusters);
  const relief = ridge.mul(ridge).mul(0.0045).mul(float(1).sub(crust.mul(0.7)))
    .add(grit.mul(0.0009))
    .add(crumb.mul(0.0025).mul(crust))
    .add(crumb.mul(0.002).mul(rust))
    .add(beads.mul(0.0045));
  m.normalNode = barkMap ? bumpNormal(relief, normalMap(texture(barkMap, uv()))) : bumpNormal(relief);
  // The same grain in the colour: grooves hold dark, ridges catch a little light, so it
  // reads even in shade.
  m.colorNode = (m.colorNode as any).mul(mix(float(0.62), float(1.12), ridge.mul(ridge)).mul(float(1).sub(crumb.mul(crust).mul(0.25))))
    .mul(mix(float(1), mix(float(0.45), float(1.18), bead), clusters));
  m.roughnessNode = (m.roughnessNode as any).sub(beads.mul(0.25));
  return m;
}
