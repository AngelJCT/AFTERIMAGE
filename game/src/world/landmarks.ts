import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { FALLEN, heightAt, RUINS } from './terrain';
import { FALLEN_LINE } from './grove';
import { footprint, groveMaterial } from './groveKit';

/**
 * The fallen giant's trunk at `u` (0 = root plate, 1 = crown end): its axis point in world
 * space and its radius, from the same profile landmarks_kit.py builds it with.
 */
export function giantTrunkAt(u: number) {
  const dir = FALLEN_LINE.b.clone().sub(FALLEN_LINE.a).normalize();
  const yaw = Math.atan2(-dir.y, dir.x);
  const x = -7.5 + u * 15;
  const up = 1.5 * (1 - u) ** 1.4 + 0.35 + 0.15 * Math.sin(u * 5);
  const z = -0.4 * Math.sin(u * 2.3);     // glTF z = -Blender y
  const local = new THREE.Vector3(x, up, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const center = local.add(new THREE.Vector3(FALLEN.x, heightAt(FALLEN.x, FALLEN.z) - 0.15, FALLEN.z));
  return { center, radius: 0.85 - 0.55 * u ** 0.8, along: new THREE.Vector3(dir.x, 0, dir.y) };
}

const RUIN_YAW = Math.PI / 2;
/**
 * The conduit ruins' whole arch at `u` (0..1 from one buried foot to the other): the
 * bundle's centre line in world space, from the same curve landmarks_kit.py builds.
 */
export function ruinsArchAt(u: number) {
  // Blender space (z up): p0 -> p1 with a sine rise.
  const bx = -2.8 + u * 5.4, by = -0.5 + u * 0.9;
  const bz = -0.6 + 3.6 * Math.sin(u * Math.PI) ** 0.85;
  const local = new THREE.Vector3(bx, bz, -by).applyAxisAngle(new THREE.Vector3(0, 1, 0), RUIN_YAW);
  return local.add(new THREE.Vector3(RUINS.x, heightAt(RUINS.x, RUINS.z) - 0.1, RUINS.z));
}

/** A capsule on the ground plane that the player can't walk through. */
export interface Blocker { a: THREE.Vector2; b: THREE.Vector2; r: number }

/**
 * The off-route landmarks from blender/scripts/landmarks_kit.py: the fallen giant (root
 * plate toward FALLEN_LINE.a) and the half-buried conduit ruins on their rise.
 * Returns the scene group plus what the player collides with and the camera avoids.
 */
export async function loadLandmarks(url: string) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const kit = new Map<string, THREE.Mesh>();
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) kit.set(o.name, o as THREE.Mesh); });
  const mat = groveMaterial();
  const group = new THREE.Group();
  group.name = 'landmarks';
  const obstacles: THREE.Vector2[] = [];
  const blockers: Blocker[] = [];

  const put = (name: string, at: THREE.Vector3, yaw: number, sink: number) => {
    const src = kit.get(name);
    if (!src) return;
    const m = new THREE.Mesh(src.geometry, mat);
    m.name = name;
    const place = new THREE.Matrix4().compose(
      new THREE.Vector3(at.x, heightAt(at.x, at.z) - sink, at.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    // Meshopt keeps quantised meshes in a scaled space with the inverse on the node.
    m.matrixAutoUpdate = false;
    m.matrix.copy(place).multiply(src.matrixWorld);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    for (const c of footprint(src)) {
      const w = c.clone().applyMatrix4(place);
      obstacles.push(new THREE.Vector2(w.x, w.z));
    }
  };

  // Local +X runs from the root plate to the crown.
  const dir = FALLEN_LINE.b.clone().sub(FALLEN_LINE.a).normalize();
  put('fallen_giant', FALLEN, Math.atan2(-dir.y, dir.x), 0.15);
  blockers.push({ a: FALLEN_LINE.a.clone().addScaledVector(dir, 0.4), b: FALLEN_LINE.b.clone(), r: 0.75 });
  blockers.push({ a: FALLEN_LINE.a.clone(), b: FALLEN_LINE.a.clone(), r: 2.3 });   // root plate
  // Ruins: the whole arch spans local X; turn it to face the path to the west.
  put('conduit_ruins', RUINS, RUIN_YAW, 0.1);
  const ruinYaw = RUIN_YAW;
  const rot = (x: number, z: number) => new THREE.Vector2(
    RUINS.x + x * Math.cos(ruinYaw) + z * Math.sin(ruinYaw), RUINS.z - x * Math.sin(ruinYaw) + z * Math.cos(ruinYaw));
  // Its feet (glTF z = -Blender y), and the tilted slab.
  for (const [x, z] of [[-2.8, 0.5], [2.6, -0.4], [1.8, -2.8], [-4.5, -2.5], [-2.0, -4.2]]) {
    const p = rot(x, z);
    blockers.push({ a: p, b: p.clone(), r: 0.45 });
  }
  blockers.push({ a: rot(-3.4, 3.2), b: rot(0.4, 3.2), r: 1.1 });
  return { group, obstacles, blockers };
}
