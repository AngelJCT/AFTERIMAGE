import * as THREE from 'three/webgpu';
import { color, float, mix, smoothstep, positionWorld, mx_fractal_noise_float } from 'three/tsl';
import { fbm, mulberry32 } from '../core/noise';
import { PALETTE } from '../core/palette';
import { BOUNDS, FALLEN, GATE, GROVE_PATH, LIFT, heightAt, MIRROR, POOL, ROUTE, RUINS, SALT_FLAT, THICKET, WAKE_POINT } from './terrain';

// Procedural stand-in for the "branching dark conduit" grove. Will be replaced by
// Blender-authored trees; kept procedural so layout iteration stays cheap.

export interface Buffers { pos: number[]; nrm: number[]; idx: number[] }
interface Thorn { p: THREE.Vector3; d: THREE.Vector3; s: number; rust: boolean }

const RADIAL = 7;

export function addTube(buf: Buffers, curve: THREE.CatmullRomCurve3, samples: number, r0: number, r1: number) {
  const frames = curve.computeFrenetFrames(samples, false);
  const base = buf.pos.length / 3;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    curve.getPointAt(t, p);
    // Slight knuckling so it reads as grown/biomechanical, not extruded.
    const r = THREE.MathUtils.lerp(r0, r1, t) * (1 + 0.18 * Math.sin(t * 23.0 + r0 * 40));
    for (let j = 0; j < RADIAL; j++) {
      const a = (j / RADIAL) * Math.PI * 2;
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      buf.pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      buf.nrm.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < RADIAL; j++) {
      const a = base + i * RADIAL + j;
      const b = base + i * RADIAL + ((j + 1) % RADIAL);
      const c = a + RADIAL;
      const d = b + RADIAL;
      buf.idx.push(a, c, b, b, c, d);
    }
  }
}

function randomUnit(rng: () => number, out = new THREE.Vector3()) {
  const u = rng() * 2 - 1;
  const th = rng() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(th), u, s * Math.sin(th));
}

function growBranch(
  rng: () => number, buf: Buffers, thorns: Thorn[],
  start: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number,
) {
  const pts = [start.clone()];
  const p = start.clone();
  const d = dir.clone();
  const segs = 5;
  const tmp = new THREE.Vector3();
  for (let i = 0; i < segs; i++) {
    d.addScaledVector(randomUnit(rng, tmp), 0.38);
    d.y -= 0.07 * (3 - depth) + 0.03; // outer branches droop into arches
    d.normalize();
    p.addScaledVector(d, len / segs);
    pts.push(p.clone());
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const rEnd = r * 0.42;
  addTube(buf, curve, Math.max(6, Math.round(len * 5)), r, rEnd);

  const thornCount = Math.round(len * (6 + depth));
  for (let i = 0; i < thornCount; i++) {
    const t = rng();
    const pt = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const out = randomUnit(rng).addScaledVector(tan, -tan.dot(randomUnit(rng))).normalize();
    const rr = THREE.MathUtils.lerp(r, rEnd, t);
    thorns.push({ p: pt.addScaledVector(out, rr * 0.7), d: out, s: rr * (0.6 + rng() * 0.9) + 0.012, rust: rng() < 0.18 });
  }

  if (depth <= 0) return;
  const kids = 2 + (rng() < 0.45 ? 1 : 0);
  for (let k = 0; k < kids; k++) {
    const t = 0.3 + rng() * 0.6;
    const at = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const cd = tan.clone().addScaledVector(randomUnit(rng), 0.9 + rng() * 0.5);
    cd.y += 0.25;
    cd.normalize();
    growBranch(rng, buf, thorns, at, cd, len * (0.5 + rng() * 0.25), THREE.MathUtils.lerp(r, rEnd, t) * 0.75, depth - 1);
  }
}

function distToSegment(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) {
  const ab = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

const route2 = ROUTE.map((v) => new THREE.Vector2(v.x, v.z));
export function distToRoute(p: THREE.Vector2) {
  let d = Infinity;
  for (let i = 0; i < route2.length - 1; i++) d = Math.min(d, distToSegment(p, route2[i], route2[i + 1]));
  return d;
}
const grove2 = GROVE_PATH.map((p) => new THREE.Vector2(p.x, p.z));
/** Distance to the grove chapter's path. */
export function distToGrovePath(p: THREE.Vector2) {
  let d = Infinity;
  for (let i = 0; i < grove2.length - 1; i++) d = Math.min(d, distToSegment(p, grove2[i], grove2[i + 1]));
  return d;
}
const pool2 = new THREE.Vector2(POOL.x, POOL.z);
const mirror2 = new THREE.Vector2(MIRROR.x, MIRROR.z);

const salt2 = new THREE.Vector2(SALT_FLAT.x, SALT_FLAT.z);
const ruins2 = new THREE.Vector2(RUINS.x, RUINS.z);
const gate2 = new THREE.Vector2(GATE.x, GATE.z);
const thicket2 = new THREE.Vector2(THICKET.x, THICKET.z);
const wake2 = new THREE.Vector2(WAKE_POINT.x, WAKE_POINT.z);
const bounds2 = new THREE.Vector2(BOUNDS.x, BOUNDS.z);
/** The fallen giant's trunk line (root plate at `a`). */
export const FALLEN_LINE = {
  a: new THREE.Vector2(FALLEN.x - 7.5 * 0.8, FALLEN.z - 7.5 * 0.6),
  b: new THREE.Vector2(FALLEN.x + 7.5 * 0.8, FALLEN.z + 7.5 * 0.6),
};

/**
 * Tree positions for the Part I grove: off the walking route, clear of both pools, sparse on
 * the salt marsh, none on the ruins or the fallen giant, and a dense thicket to the south.
 * Deterministic: every caller with the same count gets the same list (a prefix for fewer).
 */
/**
 * The grove's spots split, as in the films: a third stay dead trees, the rest become thorn
 * thickets (world/thorns.ts). Deterministic, so collisions and sound agree with what's drawn.
 */
export function groveSpots(count: number) {
  const all = treeSpots(count);
  return { trees: all.filter((_, i) => i % 3 === 0), thickets: all.filter((_, i) => i % 3 !== 0) };
}

export function treeSpots(count: number, seed = 7) {
  const rng = mulberry32(seed);
  const spots: THREE.Vector2[] = [];
  const main = Math.round(count * 0.8);
  for (let guard = 0; spots.length < main && guard < 6000; guard++) {
    const x = (rng() - 0.5) * 76 + BOUNDS.x;
    const z = (rng() - 0.5) * 76 + BOUNDS.z;
    const q = new THREE.Vector2(x, z);
    const keep = rng();
    if (distToRoute(q) < 1.8) continue;
    if (distToGrovePath(q) < 1.5) continue;
    if (q.distanceTo(pool2) < 3.4 || q.distanceTo(mirror2) < 3.2) continue;
    if (q.distanceTo(bounds2) > BOUNDS.r + 7) continue;
    if (q.distanceTo(salt2) < 7.5 && keep > 0.12) continue;
    if (q.distanceTo(ruins2) < 5.5) continue;
    if (q.distanceTo(gate2) < 12) continue;
    if (q.distanceTo(new THREE.Vector2(LIFT.x, LIFT.z)) < 6) continue;
    if (distToSegment(q, FALLEN_LINE.a, FALLEN_LINE.b) < 3.2) continue;
    spots.push(q);
  }
  // The thicket.
  for (let guard = 0; spots.length < count && guard < 4000; guard++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 7;
    const q = new THREE.Vector2(THICKET.x + Math.sin(a) * r, THICKET.z + Math.cos(a) * r);
    if (distToRoute(q) < 1.8 || distToGrovePath(q) < 1.2 || q.distanceTo(wake2) < 3.5) continue;
    if (spots.some((o) => o.distanceTo(q) < 1.6)) continue;
    spots.push(q);
  }
  return spots;
}

/** Procedural fallback grove (used if the Blender kit can't be loaded). */
export function createGrove(count: number, seed = 7) {
  const rng = mulberry32(seed);
  const buf: Buffers = { pos: [], nrm: [], idx: [] };
  const thorns: Thorn[] = [];

  let placed = 0;
  for (const q of treeSpots(count, seed)) {
    const x = q.x, z = q.y;
    const base = new THREE.Vector3(x, heightAt(x, z) - 0.2, z);
    const dir = new THREE.Vector3((rng() - 0.5) * 0.5, 1, (rng() - 0.5) * 0.5).normalize();
    growBranch(rng, buf, thorns, base, dir, 3.2 + rng() * 3.4, 0.13 + rng() * 0.1, 3);
    placed++;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3));
  geo.setIndex(buf.idx);

  const mat = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const crust = smoothstep(0.1, 0.45, mx_fractal_noise_float(p.mul(1.1), 3, 2, 0.5));
  const rust = smoothstep(0.35, 0.6, mx_fractal_noise_float(p.mul(3.7).add(9.0), 2, 2, 0.5));
  mat.colorNode = mix(mix(color(PALETTE.charcoal), color(PALETTE.bone).mul(0.8), crust), color(PALETTE.rust), rust.mul(0.7));
  mat.roughnessNode = mix(float(0.45), float(0.9), crust);
  mat.metalnessNode = mix(float(0.35), float(0.0), crust);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'grove';

  const thornGeo = new THREE.ConeGeometry(0.35, 1.4, 5);
  thornGeo.translate(0, 0.5, 0);
  const thornMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.2 });
  const thornMesh = new THREE.InstancedMesh(thornGeo, thornMat, thorns.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const cCharcoal = new THREE.Color(PALETTE.charcoal);
  const cRust = new THREE.Color(PALETTE.rust).multiplyScalar(1.3);
  thorns.forEach((t, i) => {
    q.setFromUnitVectors(up, t.d);
    s.setScalar(t.s);
    m.compose(t.p, q, s);
    thornMesh.setMatrixAt(i, m);
    thornMesh.setColorAt(i, t.rust ? cRust : cCharcoal);
  });
  thornMesh.castShadow = true;
  thornMesh.name = 'thorns';

  const group = new THREE.Group();
  group.add(mesh, thornMesh);
  return group;
}

export function createRubble(count: number, seed = 3) {
  const rng = mulberry32(seed);
  // Mineral chunks: a subdivided sphere pushed around by low-frequency noise (no shards).
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 0.8 + 0.35 * fbm(x * 1.3 + 5, z * 1.3 + y * 0.7, 3);
    pos.setXYZ(i, x * k, y * k * 0.55, z * k);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
  mat.colorNode = mix(color(PALETTE.sediment), color(PALETTE.bone), mx_fractal_noise_float(positionWorld.mul(6), 2, 2, 0.5).mul(0.5).add(0.5));
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  let n = 0;
  for (let guard = 0; n < count && guard < count * 10; guard++) {
    const x = (rng() - 0.5) * 56 - 3;
    const z = (rng() - 0.5) * 56 - 10;
    const v = new THREE.Vector2(x, z);
    if (distToRoute(v) < 1.2 || v.distanceTo(pool2) < 2.0 || v.distanceTo(mirror2) < 2.4) continue;
    const size = 0.05 + Math.pow(rng(), 3) * 0.32;
    e.set(rng() * 0.6, rng() * Math.PI * 2, rng() * 0.6);
    q.setFromEuler(e);
    sc.set(size * (1 + rng()), size, size * (1 + rng()));
    m.compose(new THREE.Vector3(x, heightAt(x, z) + size * 0.15, z), q, sc);
    mesh.setMatrixAt(n++, m);
  }
  mesh.count = n;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'rubble';
  return mesh;
}
