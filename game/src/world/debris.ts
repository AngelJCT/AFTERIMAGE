import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { groveMaterial } from './groveKit';
import {
  heightAt, GROVE_PATH, ROUTE, EXIT, GATE, LIFT, CROSS_WAKE, BEAM, SQUEEZE, POOL_EDGE, WATER_LEVEL,
} from './terrain';

/**
 * Small debris along the walking paths (blender/build_debris.sh): bone splinters, rib
 * fragments and knuckles in the pale mineral, snapped conduit scraps and bent plate, stone
 * chips. Scattered (seeded, so always the same) within a few metres of every corridor she
 * walks, thinning away from its line, never in deep water. One instanced mesh per piece.
 */
const WEIGHTS: Record<string, number> = {
  chip_a: 30, chip_b: 14, bone_shard: 18, bone_rib: 10, bone_knuckle: 8, conduit_scrap: 8, plate_scrap: 6,
};

/** The corridors, as polylines on the ground (world XZ). */
function corridors() {
  return [
    ROUTE,
    GROVE_PATH,
    [EXIT, GATE, LIFT],
    [CROSS_WAKE, BEAM.a],
    [BEAM.b, SQUEEZE.a],
    [SQUEEZE.b, POOL_EDGE],
  ];
}

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function loadDebris(url: string, count: number) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const kinds: { name: string; mesh: THREE.Mesh; weight: number }[] = [];
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && WEIGHTS[m.name] !== undefined) kinds.push({ name: m.name, mesh: m, weight: WEIGHTS[m.name] });
  });
  if (!kinds.length) throw new Error('debris kit: no pieces');
  const total = kinds.reduce((a, k) => a + k.weight, 0);
  const r = mulberry(71);
  // Segments, weighted by length, to sample along.
  const segs: { a: THREE.Vector3; b: THREE.Vector3; len: number }[] = [];
  for (const line of corridors()) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1];
      segs.push({ a, b, len: Math.hypot(b.x - a.x, b.z - a.z) });
    }
  }
  const lenSum = segs.reduce((a, s) => a + s.len, 0);
  const placed = new Map<string, THREE.Matrix4[]>();
  const q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), m = new THREE.Matrix4();
  for (let i = 0, guard = 0; i < count && guard < count * 6; guard++) {
    // Along a corridor, then out from its line (most close in, a few further off).
    let pick = r() * lenSum;
    const seg = segs.find((sg) => (pick -= sg.len) <= 0) ?? segs[segs.length - 1];
    const u = r();
    const dx = seg.b.x - seg.a.x, dz = seg.b.z - seg.a.z, L = Math.hypot(dx, dz) || 1;
    const off = (r() - 0.5) * 2 * (0.6 + 3.2 * r() * r());
    const x = seg.a.x + dx * u + (-dz / L) * off, z = seg.a.z + dz * u + (dx / L) * off;
    const y = heightAt(x, z);
    if (y < WATER_LEVEL - 0.12) continue;         // not in deep water
    let w = r() * total;
    const kind = kinds.find((k) => (w -= k.weight) <= 0) ?? kinds[0];
    const k = 0.7 + r() * 0.6;
    e.set((r() - 0.5) * 0.25, r() * Math.PI * 2, (r() - 0.5) * 0.25);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y - 0.012 * k, z), q, s.setScalar(k));
    (placed.get(kind.name) ?? placed.set(kind.name, []).get(kind.name)!).push(m.clone().multiply(kind.mesh.matrixWorld));
    i++;
  }
  const group = new THREE.Group();
  group.name = 'debris';
  const mat = groveMaterial();
  for (const kind of kinds) {
    const mats = placed.get(kind.name);
    if (!mats?.length) continue;
    const inst = new THREE.InstancedMesh(kind.mesh.geometry, mat, mats.length);
    mats.forEach((mm, i) => inst.setMatrixAt(i, mm));
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.name = `debris_${kind.name}`;
    group.add(inst);
  }
  return group;
}
