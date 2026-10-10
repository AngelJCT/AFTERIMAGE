import * as THREE from 'three/webgpu';
import {
  attribute, color, float, mix, smoothstep, positionLocal, sin, time, hash, instanceIndex, vec3, uniform,
} from 'three/tsl';
import { PALETTE } from '../core/palette';
import {
  heightAt, BOUNDS, MIRROR, POOL, WAKE_POINT, GATE, CROSS_WAKE, STILL_POOL, WATER_LEVEL,
} from './terrain';

/**
 * Dry reeds and dead grass along the waterlines: tufts of thin, curving blades, dark and wet at
 * the root, straw-pale up the stem, bone-white at the dried tips. They lean with the wind and
 * sway (more in gusts). Instanced, placed where the ground meets the water, with a few on low
 * damp ground, and kept off the spots the story frames closely.
 */
export const uReedGust = uniform(0);

function tuftGeometry(seed: number) {
  const pos: number[] = [], hts: number[] = [], idx: number[] = [];
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const blades = 9 + Math.floor(r() * 6);
  for (let b = 0; b < blades; b++) {
    const a = r() * Math.PI * 2, lean = 0.15 + r() * 0.45, h = 0.3 + r() * 0.6, w = 0.003 + r() * 0.004;
    const base = [Math.cos(a) * r() * 0.06, Math.sin(a) * r() * 0.06];
    const dir = [Math.cos(a), Math.sin(a)];
    const side = [-dir[1], dir[0]];
    const seg = 5;
    const start = pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const out = lean * h * t * t;                 // curving outward as it rises
      const cx = base[0] + dir[0] * out, cz = base[1] + dir[1] * out, cy = h * t * (1 - 0.2 * t * lean);
      const ww = w * (1 - t * 0.98);
      pos.push(cx + side[0] * ww, cy, cz + side[1] * ww, cx - side[0] * ww, cy, cz - side[1] * ww);
      hts.push(t, t);
    }
    for (let i = 0; i < seg; i++) {
      const k = start + i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('h', new THREE.Float32BufferAttribute(hts, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createReeds(count: number) {
  const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const h = attribute('h', 'float');
  const phase = hash(instanceIndex).mul(6.28);
  // Sway: the tips move, the roots stay; a slow lean downwind plus a flutter, stronger in gusts.
  const gust = uReedGust.mul(1.4).add(0.35);
  const bend = h.mul(h).mul(gust);
  const sway = sin(time.mul(1.3).add(phase)).mul(0.05).add(sin(time.mul(3.1).add(phase.mul(1.7))).mul(0.015)).mul(bend);
  mat.positionNode = positionLocal.add(vec3(sway.add(bend.mul(-0.05)), float(0), sway.mul(0.4)));
  const root = color(PALETTE.charcoal).mul(1.3), stem = color(0x9d9277), tip = color(PALETTE.bone).mul(1.05);
  mat.colorNode = mix(mix(root, stem, smoothstep(0.0, 0.3, h)), tip, smoothstep(0.55, 1.0, h)).mul(hash(instanceIndex.add(3)).mul(0.25).add(0.85));
  mat.roughnessNode = float(0.85);

  const variants = [tuftGeometry(7), tuftGeometry(19), tuftGeometry(41)];
  const r = (() => { let s = 97; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  // Places close framing needs clear: the mirror pool, the first pool's touch, where she wakes.
  const clear = [[MIRROR, 3.2], [POOL, 1.8], [WAKE_POINT, 2.2], [GATE, 9], [CROSS_WAKE, 2]] as const;
  const spots: THREE.Matrix4[][] = variants.map(() => []);
  const areas = [{ c: new THREE.Vector3(BOUNDS.x, 0, BOUNDS.z), r: BOUNDS.r + 4 }, { c: STILL_POOL, r: 16 }];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
  for (let i = 0, guard = 0; i < count && guard < count * 40; guard++) {
    const area = areas[r() < 0.8 ? 0 : 1];
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * area.r;
    const x = area.c.x + Math.cos(a) * d, z = area.c.z + Math.sin(a) * d;
    const y = heightAt(x, z);
    // Mostly right at the waterline, some in the shallows, a few on low damp ground.
    const band = y > WATER_LEVEL - 0.08 && y < WATER_LEVEL + 0.1 ? 1 : y > WATER_LEVEL + 0.1 && y < 0.25 ? 0.18 : 0;
    if (r() > band) continue;
    if (clear.some(([p, rr]) => Math.hypot(x - p.x, z - p.z) < rr)) continue;
    // Tufts come in clumps: a few together, the middle ones tallest.
    const n = 1 + Math.floor(r() * 4);
    for (let c = 0; c < n; c++) {
      const cx = x + (r() - 0.5) * 0.7 * Math.min(1, c), cz = z + (r() - 0.5) * 0.7 * Math.min(1, c);
      const k = (0.7 + r() * 0.7) * (c === 0 ? 1.15 : 1);
      e.set((r() - 0.5) * 0.15, r() * Math.PI * 2, (r() - 0.5) * 0.15);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(cx, heightAt(cx, cz) - 0.02, cz), q, sc.set(k, k * (0.8 + r() * 0.5), k));
      spots[Math.floor(r() * variants.length)].push(m.clone());
    }
    i++;
  }
  const group = new THREE.Group();
  group.name = 'reeds';
  variants.forEach((geo, vi) => {
    const list = spots[vi];
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mm, i) => inst.setMatrixAt(i, mm));
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.frustumCulled = false;
    group.add(inst);
  });
  return group;
}
