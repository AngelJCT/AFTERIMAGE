import * as THREE from 'three/webgpu';
import { color, float, mix, mx_noise_float, positionWorld, smoothstep } from 'three/tsl';
import { mulberry32 } from '../core/noise';
import { heightAt, MIRROR, POOL, WAKE_POINT, WATER_LEVEL } from './terrain';

/** Small, embedded sediment deposits in the opening grove. Independent seeds leave the
 * established rocks, collision layout and story contact points untouched. */
export function createShoreline(high: boolean) {
  const group = new THREE.Group();
  group.name = 'shoreline';
  const rng = mulberry32(221039);
  const stone = new THREE.IcosahedronGeometry(1, 1);
  const plate = new THREE.DodecahedronGeometry(1, 0);
  const deposits: THREE.Matrix4[][] = [[], []];
  const shades: THREE.Color[][] = [[], []];
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  const euler = new THREE.Euler(), scale = new THREE.Vector3();
  const materials = [0x9d9e92, 0xbcb9aa].map(c => {
    const m = new THREE.MeshStandardNodeMaterial();
    const wet = smoothstep(0.09, -0.035, positionWorld.y);
    const grain = mx_noise_float(positionWorld.mul(95)).mul(0.065).add(0.95);
    m.colorNode = color(c).mul(grain).mul(float(1).sub(wet.mul(0.32)));
    m.roughnessNode = mix(float(0.88), float(0.48), wet);
    return m;
  });
  const clear = (x: number, z: number) =>
    Math.hypot(x - WAKE_POINT.x, z - WAKE_POINT.z) < 1.45
    || Math.hypot(x - POOL.x, z - POOL.z) < 1.75
    || Math.hypot(x - MIRROR.x, z - MIRROR.z) < 3.2;
  let clusters = 0;
  const target = high ? 68 : 34;
  for (let attempts = 0; clusters < target && attempts < 6000; attempts++) {
    const x = (rng() - 0.5) * 22, z = rng() * 27 - 13;
    const y = heightAt(x, z);
    // Most deposits follow the water's edge; occasional dry fans break up the mud.
    const dryFan = attempts % 5 === 0;
    if (y < WATER_LEVEL - 0.018 || y > (dryFan ? 0.26 : 0.14) || clear(x, z)) continue;
    const dx = heightAt(x + 0.15, z) - heightAt(x - 0.15, z);
    const dz = heightAt(x, z + 0.15) - heightAt(x, z - 0.15);
    const angle = Math.atan2(dx, -dz); // tangent (-dz, dx), perpendicular to the height gradient
    const cs = Math.cos(angle), sn = Math.sin(angle);
    const count = 10 + Math.floor(rng() * 16);
    for (let i = 0; i < count; i++) {
      const along = (rng() - 0.5) * 1.8, across = (rng() - 0.5) * 0.38;
      const px = x + along * cs - across * sn, pz = z + along * sn + across * cs;
      const py = heightAt(px, pz);
      if (clear(px, pz) || py < -0.09 || py > 0.32) continue;
      const type = rng() < 0.36 && py > -0.025 ? 1 : 0;
      const size = (type ? 0.065 : 0.018) + rng() ** 2 * (type ? 0.17 : 0.048);
      const thick = size * (type ? 0.095 : 0.30);
      euler.set((rng() - 0.5) * 0.2, angle + rng() * 2.4, (rng() - 0.5) * 0.2);
      rotation.setFromEuler(euler);
      scale.set(size, thick, size * (0.5 + rng() * 0.45));
      // Only the upper part emerges. A dark joint at the base must not look like a floating rock.
      matrix.compose(new THREE.Vector3(px, py + thick * 0.05, pz), rotation, scale);
      deposits[type].push(matrix.clone());
      shades[type].push(new THREE.Color().setScalar(0.66 + rng() * 0.45));
    }
    clusters++;
  }
  [stone, plate].forEach((geometry, type) => {
    const mesh = new THREE.InstancedMesh(geometry, materials[type], deposits[type].length);
    mesh.name = type ? 'sediment-flakes' : 'shore-pebbles';
    deposits[type].forEach((m, i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, shades[type][i]); });
    mesh.castShadow = high;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  group.userData.clusters = clusters;
  group.userData.pieces = deposits.reduce((n, list) => n + list.length, 0);
  return group;
}
