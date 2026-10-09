import * as THREE from 'three/webgpu';
import { color, mix, smoothstep, positionWorld, mx_fractal_noise_float, float, vec3, attribute, sin, clamp } from 'three/tsl';
import { PALETTE } from '../core/palette';
import { groveMaterial } from './groveKit';
import { BEAM, SQUEEZE, bumpNormal, heightAt } from './terrain';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/** The kit's conduit length (blender/scripts/crossing_kit.py CONDUIT_LEN). */
const KIT_CONDUIT_LEN = 10.22;

/**
 * The crossing's pieces (chapter V): a fallen conduit bundle across the flooded channel (the
 * balance walk), and two leaning slabs with a narrow gap between them (the squeeze), a pinch
 * of broken stone halfway through.
 */
export interface Crossing {
  group: THREE.Group;
  /** The walking line along the top of the conduit (world): point and surface height at s 0..1. */
  beamAt(s: number, out?: THREE.Vector3): THREE.Vector3;
  beamLength: number;
  beamDir: THREE.Vector3;
  /** Across the gap: from its mouth to its far end (world, on the ground). */
  gapAt(s: number, out?: THREE.Vector3): THREE.Vector3;
  gapLength: number;
  gapDir: THREE.Vector3;
  /** Where the gap pinches (0..1 along it). */
  pinch: number;
  blockers: { a: THREE.Vector2; b: THREE.Vector2; r: number }[];
  /** Points along the slabs the follow camera keeps clear of. */
  camObstacles: THREE.Vector2[];
  /** Swap in the Blender-built pieces (blender/build_crossing.sh); the stand-ins stay if it fails. */
  loadKit(url: string): Promise<void>;
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/**
 * Broken stone with the kit's masks (R = occlusion, G = pale crust, B = rust stain): bone-pale
 * mineral over dark stone, horizontal strata and grit rather than the grove's bark grain.
 */
export function kitStoneMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const c = attribute('color', 'vec4');
  const p = positionWorld;
  const vary = mx_fractal_noise_float(p.mul(0.7), 2, 2, 0.5);
  const crust = clamp(c.g.add(vary.mul(0.3)), 0.0, 1.0);
  const strata = sin(p.y.mul(26).add(mx_fractal_noise_float(p.mul(1.3), 2, 2, 0.5).mul(3))).mul(0.5).add(0.5);
  const grit = mx_fractal_noise_float(p.mul(22), 2, 2, 0.5);
  const base = mix(color(PALETTE.charcoal).mul(1.5), color(PALETTE.bone).mul(0.8), smoothstep(0.3, 0.75, crust));
  m.colorNode = mix(base, color(PALETTE.rust).mul(1.1), smoothstep(0.35, 0.8, c.b).mul(0.6))
    .mul(mix(float(0.4), float(1.0), c.r))
    .mul(mix(float(0.9), float(1.05), strata)).mul(grit.mul(0.1).add(0.96));
  m.roughnessNode = float(0.93);
  m.normalNode = bumpNormal(strata.mul(0.0025).add(grit.mul(0.0012)));
  return m;
}

export function stoneMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const n = mx_fractal_noise_float(p.mul(0.9), 3, 2, 0.5).mul(0.5).add(0.5);
  const fine = mx_fractal_noise_float(p.mul(7), 2, 2, 0.5);
  const streak = smoothstep(0.55, 0.9, mx_fractal_noise_float(vec3(p.x.mul(2), p.y.mul(0.3), p.z.mul(2)), 2, 2, 0.5).abs());
  m.colorNode = mix(color(PALETTE.charcoal).mul(1.4), color(PALETTE.bone).mul(0.72), smoothstep(0.3, 0.75, n))
    .mul(float(1).sub(streak.mul(0.3))).mul(fine.mul(0.12).add(0.94));
  m.roughnessNode = float(0.94);
  m.normalNode = bumpNormal(fine.mul(0.004).add(n.mul(0.006)));
  return m;
}

export function createCrossing(): Crossing {
  const group = new THREE.Group();
  group.name = 'crossing';

  // ── The conduit across the channel ──
  const a = BEAM.a.clone(), b = BEAM.b.clone();
  a.y = heightAt(a.x, a.z); b.y = heightAt(b.x, b.z);
  const dir = b.clone().sub(a).setY(0).normalize();
  const side = V(-dir.z, 0, dir.x);
  const over = 0.9;   // it lies a little past each bank
  const A = a.clone().addScaledVector(dir, -over), B = b.clone().addScaledVector(dir, over);
  const len = A.distanceTo(B);
  const R = 0.22;
  // Its axis: a straight line resting on the banks.
  const axis = (s: number) => {
    const p = A.clone().lerp(B, s);
    p.y = THREE.MathUtils.lerp(A.y, B.y, s) + R + 0.02;
    return p;
  };
  // The stand-ins (replaced by the Blender kit when it loads), and where the kit pieces go.
  const standIns = new THREE.Group();
  group.add(standIns);
  const conduitAt = { pos: axis(0), yaw: Math.atan2(-dir.z, dir.x), pitch: Math.atan2(B.y - A.y, Math.hypot(B.x - A.x, B.z - A.z)), len };
  const slabsAt: { pos: THREE.Vector3; yaw: number; lean: number }[] = [];
  const strands = 3;
  for (let k = 0; k < strands; k++) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const s = i / 40, tw = s * Math.PI * 2.4 + (k * Math.PI * 2) / strands;
      pts.push(axis(s).addScaledVector(side, Math.cos(tw) * R * 0.48).add(V(0, Math.sin(tw) * R * 0.48, 0)));
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, R * 0.55, 10, false);
    // Masks for the grove material: R = occlusion (dark underneath), G = pale crust, B = rust.
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const ny = nor.getY(i), x = pos.getX(i), z = pos.getZ(i);
      col[i * 4] = 0.45 + 0.55 * (ny * 0.5 + 0.5);
      col[i * 4 + 1] = Math.max(0, Math.min(1, 0.45 + 0.4 * Math.sin(x * 1.7 + z * 2.3) * Math.cos(z * 0.9 - x * 0.4) + 0.2 * ny));
      col[i * 4 + 2] = Math.max(0, Math.sin(x * 3.1 - z * 1.3 + k) * Math.sin(z * 2.2 + x * 0.7) - 0.2);
      col[i * 4 + 3] = 1;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    const mesh = new THREE.Mesh(geo, groveMaterial());
    mesh.castShadow = true; mesh.receiveShadow = true;
    standIns.add(mesh);
  }
  // Where she walks: the top of the bundle, from bank to bank.
  const s0 = over / len, s1 = 1 - over / len;
  const beamAt = (s: number, out = V()) => out.copy(axis(THREE.MathUtils.lerp(s0, s1, s))).add(V(0, R * 0.95, 0));

  // ── The slabs ──
  const g0 = SQUEEZE.a.clone(), g1 = SQUEEZE.b.clone();
  const gdir = g1.clone().sub(g0).setY(0).normalize();
  const gside = V(-gdir.z, 0, gdir.x);
  const glen = g0.distanceTo(g1);
  const stone = stoneMaterial();
  const mid = g0.clone().lerp(g1, 0.5);
  const gap = 0.56, thick = 0.55, tall = 3.4, long = glen + 0.8;
  for (const sgn of [-1, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(long, tall, thick, 6, 6, 2), stone);
    // Rough the faces a little so they read as broken stone, not boxes.
    const p = slab.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      p.setZ(i, z + Math.sin(x * 3.1 + y * 1.7 + sgn) * 0.035 + Math.sin(y * 5.3 - x * 2.2) * 0.02);
      if (y > 0) p.setY(i, y - Math.abs(Math.sin(x * 1.3 + sgn * 2)) * 0.6);
    }
    slab.geometry.computeVertexNormals();
    const c = mid.clone().addScaledVector(gside, sgn * (gap / 2 + thick / 2));
    c.y = heightAt(c.x, c.z) + tall / 2 - 0.25;
    slab.position.copy(c);
    slab.rotation.y = Math.atan2(-gdir.z, gdir.x);
    slab.rotateX(sgn * 0.07);   // leaning a little apart at the top
    slab.castShadow = true; slab.receiveShadow = true;
    standIns.add(slab);
    slabsAt.push({ pos: c.clone().setY(heightAt(c.x, c.z) - 0.25), yaw: slab.rotation.y, lean: sgn * 0.07 });
  }
  // The pinch: a broken block jutting from one slab, halfway.
  const pinch = 0.5;
  const block = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34, 0), stone);
  const bp = g0.clone().lerp(g1, pinch).addScaledVector(gside, gap / 2 + 0.12);
  bp.y = heightAt(bp.x, bp.z) + 1.25;
  block.position.copy(bp);
  block.scale.set(1.2, 0.8, 0.7);
  block.rotation.set(0.4, 0.9, 0.2);
  block.castShadow = true;
  standIns.add(block);

  const gapAt = (s: number, out = V()) => {
    out.copy(g0).lerp(g1, s);
    out.y = heightAt(out.x, out.z);
    return out;
  };
  const v2 = (p: THREE.Vector3) => new THREE.Vector2(p.x, p.z);
  const blockers = [-1, 1].map((sgn) => {
    const o = gside.clone().multiplyScalar(sgn * (gap / 2 + thick / 2));
    return { a: v2(g0.clone().addScaledVector(gdir, -0.4).add(o)), b: v2(g1.clone().addScaledVector(gdir, 0.4).add(o)), r: thick / 2 };
  });
  const camObstacles: THREE.Vector2[] = [];
  for (const bl of blockers) {
    const n = Math.ceil(bl.a.distanceTo(bl.b) / 0.4);
    for (let i = 0; i <= n; i++) camObstacles.push(bl.a.clone().lerp(bl.b, i / n));
  }
  const loadKit = async (url: string) => {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    const bark = groveMaterial(), rock = kitStoneMaterial();
    const piece = (name: string) => {
      const node = gltf.scene.getObjectByName(name);
      if (!node) throw new Error(`crossing kit: no ${name}`);
      const holder = new THREE.Group();
      const n = node.clone();
      const mat = name === 'conduit' ? bark : rock;
      n.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = mat; m.castShadow = true; m.receiveShadow = true; } });
      holder.add(n);
      return holder;
    };
    const kit = new THREE.Group();
    kit.name = 'crossingKit';
    // The conduit: built along +X from its start, its axis at the origin (KIT_CONDUIT_LEN long).
    const c = piece('conduit');
    c.position.copy(conduitAt.pos);
    c.rotation.y = conduitAt.yaw;
    c.rotateZ(conduitAt.pitch);
    c.scale.set(conduitAt.len / KIT_CONDUIT_LEN, 1, 1);
    kit.add(c);
    // The slabs stand from their base.
    for (const at of slabsAt) {
      const s = piece('slab');
      s.position.copy(at.pos);
      // One turned end for end, so the two aren't twins (its lean flips with its axis).
      const turned = at.lean < 0;
      s.rotation.y = at.yaw + (turned ? Math.PI : 0);
      s.rotateX(turned ? -at.lean : at.lean);
      kit.add(s);
    }
    const pb = piece('pinch');
    pb.position.copy(block.position);
    pb.rotation.set(0.4, 0.9, 0.2);
    kit.add(pb);
    const rb = piece('rubble');
    rb.position.copy(mid).setY(heightAt(mid.x, mid.z));
    rb.rotation.y = Math.atan2(-gdir.z, gdir.x);
    kit.add(rb);
    group.add(kit);
    standIns.visible = false;
  };
  return { group, beamAt, beamLength: a.distanceTo(b), beamDir: dir, gapAt, gapLength: glen, gapDir: gdir, pinch, blockers, camObstacles, loadKit };
}
