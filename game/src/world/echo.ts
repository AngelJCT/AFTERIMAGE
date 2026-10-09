import * as THREE from 'three/webgpu';
import {
  color, float, mix, normalize, normalWorld, cameraPosition, positionWorld, dot, abs, pow, max, uniform,
  smoothstep, mx_worley_noise_vec2, mx_cell_noise_float, Discard, If, vec3, Fn,
} from 'three/tsl';
import { SUN_DIR } from './atmosphere';
import type { Flakes } from './flakes';

/**
 * Time leaves traces: at moments of feeling she leaves a crystal afterimage of herself, her pose
 * of that moment frozen in glass. It stands for a breath while she moves on, then comes apart
 * from the top down, cell by cell, into forgetting flakes.
 *
 * The pose is baked on the CPU (each skinned vertex through its bones, once), so an echo is a
 * plain mesh that costs nothing to keep.
 */
interface Echo { group: THREE.Group; mats: { k: THREE.UniformNode<'float', number> }[]; points: THREE.Vector3[]; age: number; hold: number; fade: number; minY: number; maxY: number }

export class Echoes {
  private echoes: Echo[] = [];
  private v = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private flakes: Flakes) {}

  /** Freeze `body` (her model) as it stands now; it holds `hold` s, then fades over `fade` s. */
  leave(body: THREE.Object3D, hold = 2.5, fade = 3.5) {
    if (this.echoes.length >= 3) this.drop(this.echoes[0]);
    body.updateMatrixWorld(true);
    const group = new THREE.Group();
    group.name = 'echo';
    const points: THREE.Vector3[] = [];
    let minY = Infinity, maxY = -Infinity;
    const mats: Echo['mats'] = [];
    const geos: THREE.BufferGeometry[] = [];
    body.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isMesh || !sm.visible) return;
      const src = sm.geometry;
      const pos = src.getAttribute('position');
      const out = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        this.v.fromBufferAttribute(pos, i);
        if (sm.isSkinnedMesh) sm.applyBoneTransform(i, this.v);
        this.v.applyMatrix4(sm.matrixWorld);
        out[i * 3] = this.v.x; out[i * 3 + 1] = this.v.y; out[i * 3 + 2] = this.v.z;
        minY = Math.min(minY, this.v.y); maxY = Math.max(maxY, this.v.y);
        if (i % 97 === 0) points.push(this.v.clone());
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(out, 3));
      if (src.index) g.setIndex(src.index);
      g.computeVertexNormals();
      geos.push(g);
    });
    for (const g of geos) {
      const k = uniform(0) as THREE.UniformNode<'float', number>;
      mats.push({ k });
      const mesh = new THREE.Mesh(g, echoMaterial(k, minY, maxY));
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      group.add(mesh);
    }
    this.scene.add(group);
    this.echoes.push({ group, mats, points, age: 0, hold, fade, minY, maxY });
    this.flakes.peel(points, 24, 0.03);
  }

  private drop(e: Echo) {
    this.scene.remove(e.group);
    e.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
    this.echoes.splice(this.echoes.indexOf(e), 1);
  }

  /** All of them gone at once (a chapter change). */
  clear() {
    for (const e of [...this.echoes]) this.drop(e);
  }

  update(dt: number) {
    for (const e of [...this.echoes]) {
      e.age += dt;
      // In over half a second; then, after the hold, it comes apart from the top down.
      const k = e.age < e.hold ? 0 : Math.min(1, (e.age - e.hold) / e.fade);
      const appear = Math.min(1, e.age * 2);
      for (const m of e.mats) m.k.value = k + (1 - appear) * 2;
      if (k > 0 && k < 1) {
        // Flakes off the dissolving band.
        const band = e.minY + (1.125 - 1.3 * k) * (e.maxY - e.minY + 0.3);
        const near = e.points.filter((p) => Math.abs(p.y - band) < 0.15);
        this.flakes.peel(near, Math.ceil(dt * 60), 0.035);
      }
      if (k >= 1) this.drop(e);
    }
  }
}

export function echoMaterial(k: THREE.UniformNode<'float', number>, minY: number, maxY: number) {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true });
  const n = normalize(normalWorld), v = normalize(cameraPosition.sub(positionWorld));
  const facing = abs(dot(n, v));
  const rim = pow(float(1).sub(facing), 2.5);
  const glint = pow(max(dot(n, normalize(uniform(SUN_DIR).add(v))), 0.0), 40.0);
  // Facets: Worley cells across the glass, their edges a little brighter.
  const cells = mx_worley_noise_vec2(positionWorld.mul(9.0));
  const facet = smoothstep(0.06, 0.0, cells.y.sub(cells.x));
  mat.colorNode = mix(color(0xc6cfd0), color(0xf6f1e6), rim).add(color(0xfff0d0).mul(glint.mul(2.0))).add(vec3(0.56, 0.6, 0.62).mul(facet.mul(0.25)));
  // Cell by cell from the top down: each cell goes when the front (k) passes its height, with a
  // random lead so the edge is broken, not a line.
  const h = positionWorld.y.sub(minY).div(maxY - minY + 0.3);
  const cell = mx_cell_noise_float(positionWorld.mul(14.0));
  const front = float(1).sub(k.mul(1.3));
  const alpha = float(0.16).add(rim.mul(0.55)).add(glint.mul(0.5)).add(facet.mul(0.12)).min(0.9);
  mat.opacityNode = Fn(() => {
    If(h.add(cell.mul(0.25)).greaterThan(front.add(0.25)), () => { Discard(); });
    return alpha;
  })();
  return mat;
}
