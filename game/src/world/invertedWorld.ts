import * as THREE from 'three/webgpu';
import { silhouetteMaterial } from './silhouette';

/**
 * The world she remembers, upside down in the sky: copies of the grove (its far trees, the arcade,
 * the fallen giant and the ruins) hang from the haze far off, larger than life, their roots lost
 * in a cloud deck. Flat silhouettes in the sky's colour, coming apart in cells like the far world.
 *
 * Each copy is the grove mirrored about the horizontal plane through `height`, scaled, turned and
 * set at a bearing and distance from the grove. Meshes are shared with the originals (instanced
 * ones keep their instance matrices); only the transform and the material are new.
 */
export interface InvertedCopy { bearing: number; dist: number; height: number; scale: number; turn: number }

export function createInvertedWorld(sources: THREE.Object3D[], centre: THREE.Vector3, copies: InvertedCopy[],
  atmos: { uHorizon: any; uSunCol: any }) {
  const group = new THREE.Group();
  group.name = 'invertedWorld';
  const meshes: THREE.Mesh[] = [];
  for (const s of sources) {
    s.updateMatrixWorld(true);
    s.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) meshes.push(o as THREE.Mesh); });
  }
  const toCentre = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z);
  // Everything that isn't instanced is merged into one geometry (one draw per copy), in
  // grove-centred space; instanced meshes keep their own instance matrices.
  const merged = mergeStatic(meshes.filter((m) => !(m as THREE.InstancedMesh).isInstancedMesh), toCentre);
  const instanced = meshes.filter((m) => (m as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[];
  for (const c of copies) {
    const root = new THREE.Group();
    root.position.set(centre.x + Math.sin(c.bearing) * c.dist, c.height, centre.z - Math.cos(c.bearing) * c.dist);
    root.rotation.y = c.turn;
    root.scale.set(c.scale, -c.scale, c.scale);
    const mat = silhouetteMaterial(atmos, {
      tone: 0x8a8379, near: 120, far: c.dist + 300, cap: 0.72, rim: 0.35, holes: 14 * c.scale, holeAmount: 0.08, rootY: c.height,
    });
    const statics = new THREE.Mesh(merged, mat);
    statics.frustumCulled = false;
    root.add(statics);
    for (const im of instanced) {
      const copy = new THREE.InstancedMesh(im.geometry, mat, im.count);
      copy.instanceMatrix.copy(im.instanceMatrix);
      copy.matrixAutoUpdate = false;
      copy.matrix.multiplyMatrices(toCentre, im.matrixWorld);
      copy.frustumCulled = false;
      root.add(copy);
    }
    group.add(root);
  }
  return group;
}

/** Positions of `meshes` (dequantized, through `pre` × their world matrices) as one indexed geometry. */
function mergeStatic(meshes: THREE.Mesh[], pre: THREE.Matrix4) {
  const pos: number[] = [], idx: number[] = [];
  const v = new THREE.Vector3(), m = new THREE.Matrix4();
  for (const mesh of meshes) {
    const g = mesh.geometry, p = g.getAttribute('position');
    const base = pos.length / 3;
    m.multiplyMatrices(pre, mesh.matrixWorld);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

/** The grove's middle, about which the copies are mirrored and placed. */
export const WORLD_CENTRE = new THREE.Vector3(-5, 0, -20);

/**
 * West-north-west (beyond the still pool, clear of the sun a little west of north and of the
 * shard to the north-east), and south-east behind the way she first walks.
 */
export const INVERTED: InvertedCopy[] = [
  { bearing: -1.15, dist: 330, height: 125, scale: 2, turn: 0.6 },
  { bearing: 2.3, dist: 340, height: 135, scale: 2.2, turn: 2.1 },
];

/** Roughly the middle of a copy's hanging mass (for aiming views at it). */
export function invertedAt(c: InvertedCopy) {
  return new THREE.Vector3(WORLD_CENTRE.x + Math.sin(c.bearing) * c.dist, c.height - 35, WORLD_CENTRE.z - Math.cos(c.bearing) * c.dist);
}
