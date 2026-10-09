import * as THREE from 'three/webgpu';
import { color } from 'three/tsl';
import { stoneMaterial } from './crossing';

/**
 * The other side (chapter VI): a way across the still pool that exists only in its
 * reflection. Flat pale stones just at the surface, thin posts either side carrying small
 * ochre lights, and an arch on the far shore. All of it lives on REFLECTION_ONLY, a layer the
 * view camera never renders but the water's reflection camera does: looking at the water she
 * walks a lit causeway; looking at her, she walks on bare water.
 */
export const REFLECTION_ONLY = 5;

export interface MirrorWorld {
  group: THREE.Group;
  /** The causeway's centre line, from the near shore to the arch (world, y = 0). */
  path: THREE.CatmullRomCurve3;
  /** Distance (m) from a ground point to the causeway's centre line. */
  offPath(x: number, z: number): number;
  /** Where the arch stands (world, on the ground), and the way it faces (toward the pool). */
  arch: THREE.Vector3;
}

export function createMirrorWorld(points: THREE.Vector3[], arch: THREE.Vector3): MirrorWorld {
  const group = new THREE.Group();
  group.name = 'otherSide';
  const path = new THREE.CatmullRomCurve3(points.map((p) => p.clone().setY(0)));
  const len = path.getLength();
  const stone = stoneMaterial();
  const pale = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
  pale.colorNode = color(0xd9d2c0);
  pale.emissiveNode = color(0x5c574c);
  const lamp = new THREE.MeshBasicNodeMaterial();
  lamp.colorNode = color(1.0, 0.72, 0.38).mul(2.2);
  const post = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.3 });
  post.colorNode = color(0x2c2a25);

  const n = Math.round(len / 1.05);
  const stoneGeo = new THREE.CylinderGeometry(0.44, 0.48, 0.3, 9);
  const postGeo = new THREE.CylinderGeometry(0.035, 0.05, 1.45, 6);
  const lampGeo = new THREE.SphereGeometry(0.06, 8, 6);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = path.getPointAt(u);
    const t = path.getTangentAt(u);
    const side = new THREE.Vector3(-t.z, 0, t.x);
    const s = new THREE.Mesh(stoneGeo, pale);
    s.position.copy(p).addScaledVector(side, Math.sin(i * 2.3) * 0.08).setY(-0.1);
    s.rotation.y = i * 1.7;
    s.scale.set(1 + Math.sin(i * 1.3) * 0.12, 1, 0.9 + Math.cos(i * 0.7) * 0.1);
    group.add(s);
    // Posts either side, every other stone, each with a small light.
    if (i % 2 === 0) {
      for (const sg of [-1, 1]) {
        const at = p.clone().addScaledVector(side, sg * 0.95);
        const pole = new THREE.Mesh(postGeo, post);
        pole.position.copy(at).setY(0.72);
        pole.rotation.z = sg * 0.03;
        const bulb = new THREE.Mesh(lampGeo, lamp);
        bulb.position.copy(at).setY(1.48);
        group.add(pole, bulb);
      }
    }
  }
  // The arch on the far shore, facing back across the water.
  const back = path.getTangentAt(1).setY(0).normalize();
  const across = new THREE.Vector3(-back.z, 0, back.x);
  const archGroup = new THREE.Group();
  const pillarGeo = new THREE.BoxGeometry(0.42, 3.2, 0.5);
  for (const sg of [-1, 1]) {
    const pillar = new THREE.Mesh(pillarGeo, stone);
    pillar.position.set(sg * 1.0, 1.6, 0);
    const leanIn = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.5, 0.46), stone);
    leanIn.position.set(sg * 0.55, 3.55, 0);
    leanIn.rotation.z = sg * 0.62;
    archGroup.add(pillar, leanIn);
  }
  const keyLamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), lamp);
  keyLamp.position.set(0, 4.05, 0);
  archGroup.add(keyLamp);
  archGroup.position.copy(arch);
  archGroup.rotation.y = Math.atan2(across.x, across.z) + Math.PI / 2;
  group.add(archGroup);

  // Everything here only in the water.
  group.traverse((o) => { o.layers.set(REFLECTION_ONLY); if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false; });

  // For "is she on it": a dense sample of the centre line.
  const samples = path.getSpacedPoints(Math.ceil(len * 6));
  const offPath = (x: number, z: number) => {
    let m = Infinity;
    for (const q of samples) m = Math.min(m, Math.hypot(x - q.x, z - q.z));
    return m;
  };
  return { group, path, offPath, arch };
}
