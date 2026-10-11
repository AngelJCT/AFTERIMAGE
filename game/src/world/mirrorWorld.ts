import * as THREE from 'three/webgpu';
import {
  abs, attribute, color, exp, float, fract, instancedArray, length, mx_fractal_noise_float, normalGeometry, positionGeometry,
  positionWorld, sin, smoothstep, time, uniform, uv, vec3, vec4,
} from 'three/tsl';
import { stoneMaterial } from './crossing';

/**
 * The other side (chapter VI): a way across the still pool that exists only in its
 * reflection. A path of light (plates of pale glass hovering at the surface, a pulse running
 * along them, motes rising), small ochre lights floating either side, and an arch on the far
 * shore. All of it lives on REFLECTION_ONLY, a layer the
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
  /** 0..1: how bright the way of light is (the story dims it once she reaches the arch). */
  uWay: { value: number };
}

export function createMirrorWorld(points: THREE.Vector3[], arch: THREE.Vector3): MirrorWorld {
  const group = new THREE.Group();
  group.name = 'otherSide';
  const path = new THREE.CatmullRomCurve3(points.map((p) => p.clone().setY(0)));
  const len = path.getLength();
  const stone = stoneMaterial();
  // A path of light, only in the water: thin plates of pale glass hovering just above the
  // surface, staggered like stepping stones, glowing at their edges and faint across, with a
  // slow pulse of light running along them toward the arch; motes drifting up off them; small
  // ochre lights floating either side instead of posts. Mostly transparent, so the night, the
  // sky in the water and the arch at the end stay the picture.
  // (A reflection is clipped at the surface and sees the world from below: flat stones flush
  // with the water read only as thin slivers, so the plates float a few centimetres clear and
  // it is their undersides that show.)
  const uWay = uniform(1);
  const STEP = 0.78;
  const n = Math.max(2, Math.round(len / STEP));
  const plateGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
  const plates: THREE.Matrix4[] = [], along: number[] = [];
  const lights: THREE.Vector3[] = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  const rnd = (i: number, k: number) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = path.getPointAt(u);
    const t = path.getTangentAt(u).setY(0).normalize();
    const side = new THREE.Vector3(-t.z, 0, t.x);
    const r = 0.3 + rnd(i, 1) * 0.12;
    const at = p.clone().addScaledVector(side, (i % 2 ? 1 : -1) * 0.14 + (rnd(i, 2) - 0.5) * 0.1).setY(0.05 + rnd(i, 3) * 0.03);
    e.set((rnd(i, 4) - 0.5) * 0.06, rnd(i, 5) * Math.PI, (rnd(i, 6) - 0.5) * 0.06);
    plates.push(new THREE.Matrix4().compose(at, q.setFromEuler(e), new THREE.Vector3(r, 0.035, r * (0.8 + rnd(i, 7) * 0.3))));
    along.push(u);
    // A light every third step, alternating sides, hovering at about head height.
    if (i % 3 === 1) lights.push(p.clone().addScaledVector(side, (i % 6 === 1 ? 1 : -1) * (0.85 + rnd(i, 8) * 0.25)).setY(1.25 + rnd(i, 9) * 0.45));
  }
  {
    plateGeo.setAttribute('along', new THREE.InstancedBufferAttribute(new Float32Array(along), 1));
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    m.fog = false;
    // Radial position on the plate (0 centre, 1 rim) from the unit hexagon.
    const rr = length(positionGeometry.xz);
    // The glow's inner edge wavers, so the plates read as worn glass, not tiles.
    const waver = mx_fractal_noise_float(positionWorld.mul(3.2), 2, 2, 0.5).mul(0.1);
    const rim = smoothstep(0.8, 1.0, rr.add(waver));
    // Their thin edges glow less than their faces (seen low, they would read as bands).
    const face = abs(normalGeometry.y).mul(0.75).add(0.25);
    const u = attribute('along', 'float');
    // The pulse: a soft band of light moving slowly along the way, toward the arch.
    const wave = smoothstep(0.75, 1.0, sin(u.mul(26).sub(time.mul(1.1))).mul(0.5).add(0.5));
    const breathe = sin(time.mul(0.8).add(u.mul(40))).mul(0.12).add(0.88);
    // The last few steps fade, so she stands in the arch's reflection with nothing in front of it.
    const ends = smoothstep(0.0, 0.04, u).mul(smoothstep(1.0, 0.86, u).mul(0.75).add(0.25)).mul(uWay);
    m.colorNode = vec3(0.74, 0.88, 1.0).mul(rim.mul(0.45).add(0.03).add(wave.mul(rim.mul(0.45).add(0.1))))
      .mul(breathe).mul(face).mul(ends);
    const im = new THREE.InstancedMesh(plateGeo, m, plates.length);
    plates.forEach((x, i) => im.setMatrixAt(i, x));
    im.computeBoundingSphere();
    im.renderOrder = 2;
    group.add(im);
  }
  // Motes drifting up off the way, and the small ochre lights: one instanced sprite each.
  {
    const N = Math.round(len * 5);
    const pts = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const u = Math.random(), p = path.getPointAt(u), t = path.getTangentAt(u);
      const off = (Math.random() - 0.5) * 1.1;
      pts.set([p.x - t.z * off, p.z + t.x * off, Math.random(), Math.random()], i * 4);
    }
    const sd = instancedArray(pts, 'vec4').toAttribute();
    const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    m.fog = false;
    const life = fract(time.mul(sd.z.mul(0.05).add(0.04)).add(sd.w));
    m.positionNode = vec3(sd.x.add(sin(time.mul(0.4).add(sd.w.mul(20))).mul(0.06)), life.mul(1.8).add(0.06), sd.y);
    m.scaleNode = sd.z.mul(0.03).add(0.02);
    const qd = length(uv().sub(0.5)).mul(2);
    m.colorNode = vec4(vec3(0.82, 0.93, 1.0).mul(smoothstep(1, 0, qd)).mul(smoothstep(0, 0.15, life).mul(smoothstep(1, 0.5, life))).mul(1.2).mul(uWay), 1);
    const s = new THREE.Sprite(m);
    s.count = N;
    s.frustumCulled = false;
    group.add(s);
  }
  {
    const L = lights.length;
    const data = new Float32Array(L * 4);
    lights.forEach((v, i) => data.set([v.x, v.y, v.z, Math.random()], i * 4));
    const sd = instancedArray(data, 'vec4').toAttribute();
    const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    m.fog = false;
    m.positionNode = vec3(sd.x, sd.y.add(sin(time.mul(0.6).add(sd.w.mul(30))).mul(0.06)), sd.z);
    m.scaleNode = float(0.5);
    const qd = length(uv().sub(0.5)).mul(2);
    const flick = sin(time.mul(2.3).add(sd.w.mul(50))).mul(0.06).add(0.94);
    // A small bright point in a warm halo.
    const glow = exp(qd.mul(qd).mul(-80)).mul(3).add(exp(qd.mul(qd).mul(-9)).mul(0.35));
    m.colorNode = vec4(vec3(1.0, 0.72, 0.38).mul(glow).mul(flick), 1);
    const s = new THREE.Sprite(m);
    s.count = L;
    s.frustumCulled = false;
    group.add(s);
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
  const lamp = new THREE.MeshBasicNodeMaterial();
  lamp.colorNode = color(1.0, 0.72, 0.38).mul(2.2);
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
  return { group, path, offPath, arch, uWay };
}
