import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { groveMaterial } from './groveKit';
import { heightAt, BOUNDS, GROVE_PATH, ROUTE, EXIT, GATE, WAKE_POINT, POOL, MIRROR } from './terrain';

/**
 * Thorn vines, after the films (blender/build_thorns.sh): low creepers crossing the cracked
 * ground, brambles arching out of it, upright thorny tangles. They gather thickest where the
 * films frame them (round where she wakes, round the first pool) and thin out across the grove,
 * kept off the paths she walks (the low creepers may come close; the tall shapes stand back)
 * and off the spots the story frames closely. They cast the lacy shadows the films have.
 */
type Kind = 'creeper' | 'arch' | 'tangle';
const KINDS: Record<string, Kind> = { creeper_a: 'creeper', creeper_b: 'creeper', arch_a: 'arch', arch_b: 'arch', tangle_a: 'tangle', tangle_b: 'tangle' };
const CLEAR: Record<Kind, number> = { creeper: 0.9, arch: 2.0, tangle: 2.6 };

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function segDist(x: number, z: number, a: THREE.Vector3, b: THREE.Vector3) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}

export async function loadThorns(url: string, scale: number, thickets: THREE.Vector2[] = []) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const pieces: { name: string; kind: Kind; mesh: THREE.Mesh }[] = [];
  gltf.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && KINDS[m.name]) pieces.push({ name: m.name, kind: KINDS[m.name], mesh: m }); });
  if (!pieces.length) throw new Error('thorns kit: no pieces');
  const paths = [ROUTE, GROVE_PATH, [EXIT, GATE]];
  const pathDist = (x: number, z: number) => {
    let m = Infinity;
    for (const line of paths) for (let i = 0; i + 1 < line.length; i++) m = Math.min(m, segDist(x, z, line[i], line[i + 1]));
    return m;
  };
  const framed = [[MIRROR, 3.0], [POOL, 1.6], [WAKE_POINT, 1.3], [GATE, 10]] as const;
  const r = mulberry(29);
  const placed = new Map<string, THREE.Matrix4[]>();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3();
  const put = (kind: Kind, x: number, z: number, size = 1, anywhere = false) => {
    if (!anywhere && pathDist(x, z) < CLEAR[kind]) return false;
    if (framed.some(([p, rr]) => Math.hypot(x - p.x, z - p.z) < rr)) return false;
    const y = heightAt(x, z);
    if (y < (kind === 'creeper' ? -0.12 : -0.04)) return false;
    const options = pieces.filter((p) => p.kind === kind);
    const piece = options[Math.floor(r() * options.length)];
    const k = (kind === 'tangle' ? 0.8 + r() * 0.5 : 0.8 + r() * 0.4) * size;
    e.set(0, r() * Math.PI * 2, 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y - 0.01, z), q, s.set(k, k * (0.85 + r() * 0.3), k));
    (placed.get(piece.name) ?? placed.set(piece.name, []).get(piece.name)!).push(m.clone().multiply(piece.mesh.matrixWorld));
    return true;
  };
  // Where the films frame them: rings round the waking place and the first pool.
  const ring = (c: THREE.Vector3, r0: number, r1: number, n: number, kinds: Kind[]) => {
    for (let i = 0, guard = 0; i < n && guard < n * 12; guard++) {
      const a = r() * Math.PI * 2, d = r0 + (r1 - r0) * Math.sqrt(r());
      if (put(kinds[Math.floor(r() * kinds.length)], c.x + Math.cos(a) * d, c.z + Math.sin(a) * d)) i++;
    }
  };
  ring(WAKE_POINT, 1.3, 6, Math.round(12 * scale), ['creeper', 'creeper', 'arch']);
  ring(POOL, 2.5, 8, Math.round(12 * scale), ['creeper', 'arch', 'tangle']);
  // Thickets where two in three of the grove's dead trees stood: a big spiralling tangle, a ring
  // of arching brambles round it, a creeper at its foot (the spots are already clear of paths).
  for (const t of thickets) {
    put('tangle', t.x, t.y, 1.5 + r() * 0.5, true);
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, d = 0.8 + r() * 1.2;
      put(r() < 0.7 ? 'arch' : 'tangle', t.x + Math.cos(a) * d, t.y + Math.sin(a) * d, 1.1 + r() * 0.3);
    }
    put('creeper', t.x + (r() - 0.5) * 2, t.y + (r() - 0.5) * 2);
  }
  // And through the grove, thinning outward.
  const total = Math.round(40 * scale);
  for (let i = 0, guard = 0; i < total && guard < total * 12; guard++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (BOUNDS.r + 6);
    const kind: Kind = r() < 0.45 ? 'creeper' : r() < 0.55 ? 'arch' : 'tangle';
    if (put(kind, BOUNDS.x + Math.cos(a) * d, BOUNDS.z + Math.sin(a) * d)) i++;
  }
  const group = new THREE.Group();
  group.name = 'thorns';
  const mat = groveMaterial();
  for (const piece of pieces) {
    const mats = placed.get(piece.name);
    if (!mats?.length) continue;
    const inst = new THREE.InstancedMesh(piece.mesh.geometry, mat, mats.length);
    mats.forEach((mm, i) => inst.setMatrixAt(i, mm));
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.name = `thorns_${piece.name}`;
    group.add(inst);
  }
  return group;
}
