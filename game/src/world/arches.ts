import * as THREE from 'three/webgpu';
import { color, float, mix, smoothstep, positionWorld, mx_fractal_noise_float } from 'three/tsl';
import { PALETTE } from '../core/palette';
import { addTube, type Buffers } from './grove';
import { ARCHES, EXIT, heightAt } from './terrain';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { groveMaterial } from './groveKit';
import { gateMaterial } from './gate';

/**
 * The Blender-built arcade (blender/scripts/arches_kit.py): conduit piers splitting into
 * pointed arches, the bone-paved elevated route on top, one span broken. Built along +X,
 * placed across the line of sight from the exit like the procedural fallback below.
 */
export async function loadArches(url: string, onProgress?: (k: number) => void) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
  const view = new THREE.Vector3().subVectors(ARCHES, EXIT).setY(0).normalize();
  const across = new THREE.Vector3(-view.z, 0, view.x);
  const root = gltf.scene;
  root.name = 'arches';
  root.position.set(ARCHES.x, heightAt(ARCHES.x, ARCHES.z), ARCHES.z);
  root.rotation.y = Math.atan2(-across.z, across.x);
  const mat = groveMaterial();
  const masonry = gateMaterial('masonry');
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = m.name.startsWith('deck_') ? masonry : mat;
    m.castShadow = true;
    m.receiveShadow = true;
  });
  return root;
}

/**
 * The refuge's own conduit canopy: a smaller copy of the arcade running out from the gate's
 * RIGHT side into the refuge, so the courtyard in front of the gate reads as the open-roof
 * refuge (the child and the woman kneel by the water under it). Built in the gate's space,
 * so it shows and hides with the gate. Returns pier blockers (world).
 */
export async function loadCanopy(url: string, gateRoot: THREE.Object3D, scale = 0.6) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  const mat = groveMaterial();
  const masonry = gateMaterial('masonry');
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = m.name.startsWith('deck_') ? masonry : mat;
    m.castShadow = true;
    m.receiveShadow = true;
  });
  const group = new THREE.Group();
  group.name = 'canopy';
  gltf.scene.scale.setScalar(scale);
  group.add(gltf.scene);
  // Arcade +X runs along the gate's +Z (out into the refuge), beside the right pillar.
  group.position.set(7.6, -0.08, 17.5);
  group.rotation.y = -Math.PI / 2;
  gateRoot.add(group);
  group.updateMatrixWorld(true);
  const N = 9, SPAN = 6.2;
  const blockers: { a: THREE.Vector2; b: THREE.Vector2; r: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const w = group.localToWorld(new THREE.Vector3((i - N / 2) * SPAN * scale, 0, 0));
    blockers.push({ a: new THREE.Vector2(w.x, w.z), b: new THREE.Vector2(w.x, w.z), r: 0.55 });
  }
  return { group, blockers };
}

/**
 * The refuge's arcade and raised route, far off in the haze: the place Part II begins.
 * Seen from the end of Part I, never reached. Procedural fallback for the Blender set.
 */
export function createArches() {
  const buf: Buffers = { pos: [], nrm: [], idx: [] };
  // Arcade runs across the line of sight from the exit.
  const view = new THREE.Vector3().subVectors(ARCHES, EXIT).setY(0).normalize();
  const across = new THREE.Vector3(-view.z, 0, view.x);
  const N = 9, span = 6.2, H = 9.5;
  const base = ARCHES.clone();
  base.y = heightAt(base.x, base.z);

  const tube = (pts: THREE.Vector3[], r0: number, r1 = r0) =>
    addTube(buf, new THREE.CatmullRomCurve3(pts), Math.max(8, pts.length * 6), r0, r1);

  for (let i = 0; i <= N; i++) {
    const o = base.clone().addScaledVector(across, (i - N / 2) * span);
    // Pier, slightly organic: the grove grew into the architecture.
    tube([o.clone().setY(o.y - 0.5), o.clone().setY(o.y + H * 0.45), o.clone().setY(o.y + H * 0.7)], 0.55, 0.4);
    if (i < N) {
      // Pointed arch to the next pier.
      const a = o.clone().setY(o.y + H * 0.7);
      const b = a.clone().addScaledVector(across, span);
      const mid = a.clone().lerp(b, 0.5).setY(o.y + H);
      tube([a, a.clone().lerp(mid, 0.5).add(new THREE.Vector3(0, 1.1, 0)), mid, mid.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 1.1, 0)), b], 0.35, 0.35);
      // Hanging filaments.
      for (let k = 0; k < 3; k++) {
        const top = a.clone().lerp(b, 0.2 + 0.3 * k).setY(o.y + H * 0.9);
        tube([top, top.clone().add(new THREE.Vector3(0.2, -1.6 - k, 0.1)), top.clone().add(new THREE.Vector3(-0.1, -2.8 - k * 1.3, 0))], 0.06, 0.02);
      }
    }
  }
  // Raised route: a long deck on the arcade, running on toward screen-left (the escape axis).
  const d0 = base.clone().addScaledVector(across, (-N / 2) * span - 8).setY(base.y + H + 0.6);
  const d1 = base.clone().addScaledVector(across, (N / 2) * span + 3).setY(base.y + H + 0.6);
  tube([d0, d0.clone().lerp(d1, 0.5).setY(base.y + H + 0.9), d1], 0.7, 0.7);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3));
  geo.setIndex(buf.idx);
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0.2 });
  const crust = smoothstep(0.2, 0.55, mx_fractal_noise_float(positionWorld.mul(0.35), 3, 2, 0.5));
  mat.colorNode = mix(color(PALETTE.charcoal), color(PALETTE.bone).mul(0.7), crust.mul(0.6));
  mat.roughnessNode = mix(float(0.55), float(0.9), crust);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'arches';
  return mesh;
}
