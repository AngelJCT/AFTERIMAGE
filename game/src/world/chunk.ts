import * as THREE from 'three/webgpu';

/**
 * Split each instanced mesh under `root` into one instanced mesh per `cell`-metre square of the
 * ground, each with its own bounds, so every camera skips the cells it can't see: the view
 * behind her, the sun's shadow box (only ~32 m round her) and the water's reflection. One mesh
 * spanning the grove is drawn whole by all three, every frame.
 *
 * The draw count rises by the cells in view (28 m cells: about 1.6× the draws for half the
 * triangles in the grove). `skip` keeps a mesh as it is (far silhouettes that are always in
 * view anyway, and that others copy).
 */
export function chunkInstances(root: THREE.Object3D, cell = 28, skip: (m: THREE.InstancedMesh) => boolean = () => false) {
  const list: THREE.InstancedMesh[] = [];
  root.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh && !skip(im)) list.push(im);
  });
  root.updateMatrixWorld(true);
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  let made = 0;
  for (const im of list) {
    const cells = new Map<string, number[]>();
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m);
      p.setFromMatrixPosition(m).applyMatrix4(im.matrixWorld);
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
      (cells.get(key) ?? cells.set(key, []).get(key)!).push(i);
    }
    if (cells.size <= 1) {
      im.computeBoundingSphere();
      im.frustumCulled = true;
      continue;
    }
    const parent = im.parent!;
    for (const idx of cells.values()) {
      const c = new THREE.InstancedMesh(im.geometry, im.material, idx.length);
      idx.forEach((src, j) => { im.getMatrixAt(src, m); c.setMatrixAt(j, m); });
      if (im.instanceColor) {
        const col = new THREE.Color();
        idx.forEach((src, j) => { im.getColorAt(src, col); c.setColorAt(j, col); });
      }
      c.name = im.name;
      c.castShadow = im.castShadow;
      c.receiveShadow = im.receiveShadow;
      c.layers.mask = im.layers.mask;
      c.renderOrder = im.renderOrder;
      c.position.copy(im.position); c.quaternion.copy(im.quaternion); c.scale.copy(im.scale);
      c.userData = { ...im.userData };
      c.computeBoundingSphere();
      c.frustumCulled = true;
      parent.add(c);
      made++;
    }
    parent.remove(im);
  }
  return made;
}
