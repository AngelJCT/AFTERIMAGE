import * as THREE from 'three/webgpu';
import {
  abs, attribute, cameraPosition, color, distance, dot, exp, float, fract, instancedBufferAttribute, length, max, mix, normalize,
  normalWorld, pow, positionGeometry, positionLocal, positionWorld, sin, smoothstep, time, uniform, uv, vec3, vec4,
} from 'three/tsl';
import { mulberry32 } from '../core/noise';
import { heightAt } from './terrain';

/**
 * What she has recovered, left in the world (after the world references: crystal grown out of
 * ruin, 0d910b36_3 and f2a07fae_*; the luminous crowns of the forest set, 79c99c57, used
 * sparingly). At each afterimage once it is found:
 * - a small growth of cyan crystal where her echo stood, grown up out of the ground in a few
 *   seconds, a faint light in it brightest at the tips;
 * - the nearest dead tree remembers: a few motes of cyan light caught in its branches, a few
 *   dripping slowly from them, a few rising round the crystal.
 * What she spends as power later goes out: the crystal turns milky grey and dark, the motes go.
 *
 * It follows the saved progress by itself (checked twice a second), so every way a memory is
 * found or spent shows here.
 */
const CYAN = 0x4fd8ff;
const spow = (x: any, e: number) => pow(max(x, 1e-4), float(e));

interface Mark {
  id: string;
  grow: any;
  glow: any;
  spent: any;
  growTo: number;
  glowTo: number;
  spentTo: number;
  objects: THREE.Object3D[];
  /** The tree that remembers (its base), if one stands near. */
  tree?: THREE.Vector3;
}

export class FoundMarks {
  readonly group = new THREE.Group();
  private marks: Mark[] = [];
  private poll = 0;
  private first = true;

  /**
   * `sites`: each afterimage's id and where it waits; `grove`: the grove kit's root, to find the
   * tree that remembers; `found`/`spent`: read from the saved progress.
   */
  constructor(
    scene: THREE.Scene,
    sites: { id: string; at: THREE.Vector3 }[],
    grove: THREE.Object3D | undefined,
    private readonly found: () => string[],
    private readonly spent: () => string[],
    blockers: { a: THREE.Vector2; b: THREE.Vector2; r: number }[] = [],
  ) {
    this.group.name = 'foundMarks';
    const trees = grove ? treeInstances(grove) : [];
    for (const [i, s] of sites.entries()) {
      const rng = mulberry32(101 + i * 17);
      // Beside where she acted, not on it, and clear of trunks, rocks and landmarks: of a few
      // spots round it, the one furthest from anything she can't walk through.
      const a0 = rng() * Math.PI * 2;
      let at = new THREE.Vector3(), clear = -Infinity;
      for (let k = 0; k < 16; k++) {
        const a = a0 + (k / 16) * Math.PI * 2, r = 1.3 + (k % 2) * 0.5;
        const c = new THREE.Vector2(s.at.x + Math.cos(a) * r, s.at.z + Math.sin(a) * r);
        const free = Math.min(3, ...blockers.map((b) => distToSegment(c, b.a, b.b) - b.r));
        if (free > clear + 0.05) { clear = free; at = new THREE.Vector3(c.x, 0, c.y); }
      }
      at.y = heightAt(at.x, at.z);
      const mark: Mark = {
        id: s.id, grow: uniform(0), glow: uniform(0), spent: uniform(0), growTo: 0, glowTo: 0, spentTo: 0, objects: [],
      };
      const crystal = makeCrystal(at, rng, mark);
      // The tree that remembers: the nearest standing tree within 16 m.
      const tree = trees.reduce<{ d: number; t?: TreeRef }>((best, t) => {
        const d = Math.hypot(t.base.x - at.x, t.base.z - at.z);
        return d < best.d ? { d, t } : best;
      }, { d: 16 }).t;
      mark.tree = tree?.base;
      const motes = makeMotes(at, tree, rng, mark);
      mark.objects.push(crystal, motes);
      for (const o of mark.objects) { o.visible = false; this.group.add(o); }
      this.marks.push(mark);
    }
    scene.add(this.group);
  }

  update(dt: number) {
    if ((this.poll -= dt) <= 0) {
      this.poll = 0.5;
      const found = this.found(), spent = this.spent();
      for (const m of this.marks) {
        const f = found.includes(m.id), s = spent.includes(m.id);
        m.growTo = f ? 1 : 0;
        m.glowTo = f && !s ? 1 : 0;
        m.spentTo = s ? 1 : 0;
        // On load (or a chapter jump) it's simply there; found in play, it grows.
        if (this.first) { m.grow.value = m.growTo; m.glow.value = m.glowTo; m.spent.value = m.spentTo; }
      }
      this.first = false;
    }
    for (const m of this.marks) {
      // Grows over about 4 s; its light comes up a little behind; spent, it dims over several.
      m.grow.value = m.growTo ? Math.min(1, m.grow.value + dt / 4) : 0;
      m.glow.value += (m.glowTo - m.glow.value) * (1 - Math.exp(-dt * (m.glowTo > m.glow.value ? 0.6 : 0.35)));
      m.spent.value += (m.spentTo - m.spent.value) * (1 - Math.exp(-dt * 0.35));
      const on = m.grow.value > 0.001;
      m.objects[0].visible = on;
      m.objects[1].visible = on && m.glow.value > 0.01;
    }
  }
}

/** A cluster of crystal: one tall shard, a ring of smaller ones leaning out round it. */
function makeCrystal(at: THREE.Vector3, rng: () => number, mark: Mark) {
  // A six-sided prism with a pointed tip, flat-shaded: base at the origin, tip at y = 2.
  const geo = new THREE.LatheGeometry([new THREE.Vector2(0.15, -0.2), new THREE.Vector2(0.13, 1.45), new THREE.Vector2(0, 2)], 6).toNonIndexed();
  geo.computeVertexNormals();
  const n = 9 + Math.floor(rng() * 5);
  const delay = new Float32Array(n);
  const inst = new THREE.InstancedMesh(geo, undefined as any, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const main = i === 0;
    const a = rng() * Math.PI * 2, r = main ? 0 : 0.12 + rng() * 0.4;
    p.set(at.x + Math.cos(a) * r, at.y - 0.06, at.z + Math.sin(a) * r);
    // Leaning out from the centre, more the further out.
    const lean = main ? rng() * 0.15 : 0.25 + r * 1.2 + rng() * 0.2;
    e.set(Math.sin(a) * lean, rng() * Math.PI, -Math.cos(a) * lean, 'YXZ');
    q.setFromEuler(e);
    const L = main ? 0.6 + rng() * 0.3 : 0.18 + rng() * 0.4 * (1 - r);
    const w = (main ? 1.2 : 0.7 + rng() * 0.6) * Math.max(0.4, L);
    s.set(w, L / 2, w * (0.7 + rng() * 0.5));
    m4.compose(p, q, s);
    inst.setMatrixAt(i, m4);
    delay[i] = main ? 0 : 0.1 + rng() * 0.45;
  }
  geo.setAttribute('delay', new THREE.InstancedBufferAttribute(delay, 1));
  const mat = new THREE.MeshStandardNodeMaterial();
  const d = attribute('delay', 'float');
  const g = smoothstep(d, d.add(0.5), mark.grow);
  mat.positionNode = positionLocal.mul(g);
  // The mesh's own position (positionLocal is already instance-transformed in the fragment).
  const tip = positionGeometry.y.div(2).clamp(0, 1);
  const nrm = normalize(normalWorld), v = normalize(cameraPosition.sub(positionWorld));
  const fres = spow(float(1).sub(abs(dot(nrm, v))), 3);
  const spent = mark.spent;
  // Dark glass with the sky in it (low roughness: it mirrors the haze); milky grey once spent.
  mat.colorNode = mix(vec3(0.03, 0.07, 0.08), vec3(0.5, 0.52, 0.5), spent);
  mat.roughnessNode = mix(float(0.06), float(0.55), spent);
  mat.metalnessNode = mix(float(0.35), float(0.0), spent);
  // Its light: within, at the edges and up toward the tip, breathing slowly; a flare as it grows.
  const breathe = sin(time.mul(0.9).add(positionWorld.x)).mul(0.15).add(0.85);
  const flare = float(1).add(float(1).sub(mark.grow).mul(3)).mul(g);
  mat.emissiveNode = mix(color(CYAN), vec3(0.85, 0.97, 1.0), spow(tip, 4))
    .mul(spow(tip, 3).mul(1.5).add(fres.mul(0.32)).add(0.02))
    .mul(breathe).mul(flare).mul(mark.glow);
  inst.castShadow = true;
  inst.receiveShadow = true;
  inst.material = mat;
  inst.name = `crystal_${mark.id}`;
  return inst;
}

function distToSegment(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) {
  const ab = b.clone().sub(a), l2 = ab.lengthSq();
  const t = l2 > 1e-8 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / l2, 0, 1) : 0;
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

interface TreeRef { base: THREE.Vector3; geo: THREE.BufferGeometry; matrix: THREE.Matrix4 }

/** Every standing tree in the grove kit (not shrubs, logs or the far silhouettes). */
function treeInstances(root: THREE.Object3D) {
  const out: TreeRef[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh || !/^tree_/.test(im.name) || im.name.endsWith('_far')) return;
    // The kit's meshes are quantised (the instance matrices carry the inverse), so the base is
    // the bottom centre of the geometry's box, not the matrix's origin.
    if (!im.geometry.boundingBox) im.geometry.computeBoundingBox();
    const bb = im.geometry.boundingBox!;
    const foot = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.min.y, (bb.min.z + bb.max.z) / 2);
    for (let i = 0; i < im.count; i++) {
      const m = new THREE.Matrix4();
      im.getMatrixAt(i, m);
      m.premultiply(im.matrixWorld);
      out.push({ base: foot.clone().applyMatrix4(m), geo: im.geometry, matrix: m });
    }
  });
  return out;
}

/**
 * Motes: in the tree's branches (twinkling where they hang, a few dripping slowly down), and a
 * few rising round the crystal. One instanced sprite per site.
 */
function makeMotes(at: THREE.Vector3, tree: TreeRef | undefined, rng: () => number, mark: Mark) {
  const pts: number[] = [], kinds: number[] = [];
  if (tree) {
    // Branch points: the upper crown, away from the trunk.
    const pos = tree.geo.attributes.position, v = new THREE.Vector3();
    const all: THREE.Vector3[] = [];
    let top = -Infinity;
    for (let i = 0; i < pos.count; i += 7) {
      v.fromBufferAttribute(pos, i).applyMatrix4(tree.matrix);
      all.push(v.clone());
      top = Math.max(top, v.y);
    }
    const h = top - tree.base.y;
    const crown = all.filter((p) => p.y - tree.base.y > h * 0.45 && Math.hypot(p.x - tree.base.x, p.z - tree.base.z) > h * 0.12);
    // In clusters along the branches, each with a soft glow round it: the crown lit from within.
    for (let c = 0; c < 11 && crown.length; c++) {
      const anchor = crown[Math.floor(rng() * crown.length)];
      const near = crown.filter((p) => p.distanceToSquared(anchor) < 0.9);
      pts.push(anchor.x, anchor.y, anchor.z);
      kinds.push(3);
      for (let k = 0; k < 9; k++) {
        const p = near[Math.floor(rng() * near.length)] ?? anchor;
        pts.push(p.x + (rng() - 0.5) * 0.3, p.y - rng() * 0.2, p.z + (rng() - 0.5) * 0.3);
        kinds.push(rng() < 0.2 ? 1 : 0);
      }
    }
  }
  for (let k = 0; k < 14; k++) {
    const a = rng() * Math.PI * 2, r = 0.2 + rng() * 0.7;
    pts.push(at.x + Math.cos(a) * r, at.y + 0.1, at.z + Math.sin(a) * r);
    kinds.push(2);
  }
  const n = kinds.length;
  const seeds = Array.from({ length: n }, () => rng());
  const P: any = instancedBufferAttribute(new THREE.InstancedBufferAttribute(new Float32Array(pts), 3));
  const K: any = instancedBufferAttribute(new THREE.InstancedBufferAttribute(new Float32Array(kinds.map((k, i) => k * 10 + seeds[i])), 1));
  const kind: any = float(K).div(10).floor(), sd: any = fract(float(K));
  const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  mat.fog = false;
  const t = time;
  // 0: hangs, drifting a little; 1: drips down 1.8 m and fades; 2: rises 2.2 m from the crystal.
  const cyc: any = fract(t.mul(mix(float(0.06), float(0.1), sd)).add(sd.mul(7)));
  const isDrip = kind.equal(1).select(float(1), float(0));
  const isRise = kind.equal(2).select(float(1), float(0));
  const isHalo = kind.equal(3).select(float(1), float(0));
  const bob: any = vec3(sin(t.mul(0.5).add(sd.mul(30))).mul(0.05), sin(t.mul(0.7).add(sd.mul(50))).mul(0.06), sin(t.mul(0.45).add(sd.mul(70))).mul(0.05));
  mat.positionNode = P.add(bob).add(vec3(0, cyc.mul(-1.8).mul(isDrip).add(cyc.mul(2.2).mul(isRise)), 0));
  mat.scaleNode = mix(spow(sd, 3).mul(0.14).add(0.07), sd.mul(0.6).add(1.1), isHalo);
  const life = mix(float(1), smoothstep(0.0, 0.12, cyc).mul(smoothstep(1.0, 0.6, cyc)), isDrip.add(isRise));
  const tw0 = sin(t.mul(mix(float(1.2), float(3.2), sd)).add(sd.mul(40))).mul(0.35).add(0.65);
  const tw = mix(tw0, float(0.85), isHalo);
  // In the haze, as the rest of the grove is.
  const haze = exp(distance(positionWorld, cameraPosition).mul(-0.022));
  const q = length(uv().sub(0.5)).mul(2);
  // Motes: a bright point in a small glow; halos: only the glow, faint.
  const soft = mix(exp(q.mul(q).mul(-10)).add(exp(q.mul(q).mul(-50)).mul(1.5)), exp(q.mul(q).mul(-5)).mul(0.12), isHalo);
  mat.colorNode = vec4(mix(color(CYAN), vec3(0.9, 0.98, 1.0), sd.mul(0.6)).mul(soft).mul(tw).mul(life).mul(haze)
    .mul(mark.glow).mul(2.2), 1);
  const s = new THREE.Sprite(mat);
  s.count = n;
  s.frustumCulled = false;
  s.name = `memoryMotes_${mark.id}`;
  return s;
}
