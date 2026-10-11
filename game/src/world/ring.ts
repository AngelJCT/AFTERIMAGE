import * as THREE from 'three/webgpu';
import {
  abs, atan, attribute, color, cos, cameraPosition, Discard, dot, exp, float, Fn, fract, If, instancedArray, length, max, mix,
  mx_fractal_noise_float, normalize, normalWorld, pow, positionGeometry, positionLocal, positionWorld, sin, smoothstep, step, time, uniform, uv,
  varying, vec3, vec4,
} from 'three/tsl';
import { OTHER_ARCH } from './terrain';
import { WORLD_CENTRE } from './invertedWorld';
import { SUN_DIR } from './atmosphere';
import { mulberry32 } from '../core/noise';

/**
 * The ring: a circle of cyan light standing on the horizon beyond the other side's arch, the
 * same ring as her core when she reboots. Whatever she is looking for has her shape. Like her
 * reboot ring it draws itself clockwise from the top, a little further with each chapter, its
 * leading edge brightest; inside it the haze is faintly lighter and cooler, as if it opened onto
 * something.
 *
 * After the world references (f9ff553b_0/3), it is a vortex rather than a clean torus:
 * - a band of streaked light round the line, turning slowly clockwise and drawn inward in a
 *   spiral, thin inside the ring and torn wide outside it;
 * - crystal dust spiralling in toward it from outside, glittering;
 * - spurs of cyan crystal grown out of it in a few clusters, each growing as the arc reaches it.
 * All of it only where the arc is drawn.
 */
const CYAN = 0x4fd8ff;
/** pow with its base kept above zero (pow(0, e) is NaN on some GPUs, and bloom spreads it). */
const spow = (x: any, e: number) => pow(max(x, 1e-4), float(e));

export function createRing(atmos: { uHorizon: any }, dust = 1400) {
  const group = new THREE.Group();
  group.name = 'ring';
  const dir = OTHER_ARCH.clone().sub(WORLD_CENTRE).setY(0).normalize();
  const R = 26;
  group.position.copy(WORLD_CENTRE).addScaledVector(dir, 300).setY(32);
  // Face the grove.
  group.lookAt(WORLD_CENTRE.clone().setY(32));

  const uArc = uniform(0.2);
  // Clockwise from the top, 0..1 round the ring, for a point in the ring's plane.
  const arcT = (x: any, y: any) => fract(float(0.25).sub(atan(y, x).div(Math.PI * 2)));
  // Shown up to the drawn arc (soft over its last few degrees), brightest at its leading edge.
  const drawn = (t: any) => smoothstep(uArc.add(0.004), uArc.sub(0.02), t);
  const headAt = (t: any) => exp(uArc.sub(t).mul(-28.0).abs().negate());
  const pulse = sin(time.mul(1.3)).mul(0.08).add(1.0);

  // The line itself.
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.fog = false;
  const t = arcT(positionLocal.x, positionLocal.y);
  mat.colorNode = Fn(() => {
    If(t.greaterThan(uArc), () => { Discard(); });
    return color(CYAN).mul(float(2.2).add(headAt(t).mul(4.0)).mul(pulse));
  })();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.4, 8, 220), mat);
  group.add(ring);

  // The swirl: streaks of light round the line, turning clockwise and drawn inward in a spiral.
  {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    m.fog = false;
    const p = positionLocal;
    const rr = length(p.xy).div(R);
    const a = atan(p.y, p.x);
    const ta = arcT(p.x, p.y);
    // A logarithmic twist: further out, further round, so the streaks read as a spiral in.
    const s = a.add(rr.sub(1).mul(4.5)).add(time.mul(-0.045));
    // Noise sampled round a circle (it wraps), fine across the radius and long along the angle.
    const flow = time.mul(0.25);
    const n1 = mx_fractal_noise_float(vec3(cos(s).mul(3), sin(s).mul(3), rr.mul(30).add(flow)), 3, 2, 0.5);
    const n2 = mx_fractal_noise_float(vec3(cos(s.mul(1).add(1.7)).mul(5), sin(s.add(1.7)).mul(5), rr.mul(70).add(flow.mul(1.6))), 2, 2, 0.5);
    const streak = spow(smoothstep(-0.05, 0.55, n1), 2.2).add(spow(smoothstep(0.1, 0.6, n2), 3).mul(0.6));
    // Uneven round the ring: torn wide where the crystal masses gather, thin elsewhere.
    const wide = smoothstep(-0.3, 0.5, mx_fractal_noise_float(vec3(cos(a).mul(1.3), sin(a).mul(1.3), float(4.1)), 2, 2, 0.5));
    const wOut = mix(float(0.09), float(0.42), wide);
    const dOut = rr.sub(1).div(wOut);
    const dIn = rr.sub(1).div(0.045);
    const env = exp(mix(dIn, dOut, step(1.0, rr)).mul(mix(dIn, dOut, step(1.0, rr))).negate());
    const lvl = streak.mul(env).mul(drawn(ta)).mul(float(1).add(headAt(ta).mul(2.5))).mul(pulse);
    m.colorNode = mix(color(CYAN), vec3(0.88, 0.97, 1.0), smoothstep(0.4, 1.4, lvl)).mul(lvl).mul(2.4);
    const band = new THREE.Mesh(new THREE.RingGeometry(R * 0.86, R * 1.55, 256, 6), m);
    band.position.z = 0.3;
    band.renderOrder = 1;
    group.add(band);
  }

  // Crystal dust spiralling in from outside, glittering. One instanced sprite.
  if (dust > 0) {
    const rng = mulberry32(73);
    const data = new Float32Array(dust * 4);
    for (let i = 0; i < dust; i++) {
      data[i * 4] = rng() * Math.PI * 2;               // start angle
      data[i * 4 + 1] = -0.12 + rng() ** 1.6 * 0.8;    // how far out it starts (× R)
      data[i * 4 + 2] = rng();                         // size, speed and depth
      data[i * 4 + 3] = rng();                         // phase
    }
    const seeds = instancedArray(data, 'vec4');
    const sd = seeds.toAttribute();
    const life = fract(time.mul(0.03).mul(sd.z.mul(0.6).add(0.7)).add(sd.w));
    const r = float(R).mul(float(1).add(sd.y.mul(spow(float(1).sub(life), 1.6))));
    const ang = sd.x.sub(time.mul(0.05)).sub(life.mul(1.4));
    const x = cos(ang).mul(r), y = sin(ang).mul(r);
    const z = fract(sd.z.mul(17.3)).sub(0.5).mul(7);
    const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    m.fog = false;
    m.positionNode = vec3(x, y, z);
    const big = spow(fract(sd.z.mul(31.7)), 5);
    m.scaleNode = float(0.5).add(big.mul(1.8));
    // Visible where the arc is drawn, fading in as it sets out and out as it reaches the line.
    const vis = varying(drawn(arcT(x, y)).mul(smoothstep(0.0, 0.15, life)).mul(smoothstep(1.0, 0.8, life))
      .mul(sin(time.mul(sd.z.mul(4).add(2)).add(sd.w.mul(40))).mul(0.4).add(0.6))
      .mul(float(1).add(headAt(arcT(x, y)).mul(1.5))));
    m.colorNode = Fn(() => {
      const q = length(uv().sub(0.5)).mul(2);
      const g = exp(q.mul(q).mul(-9)).add(exp(q.mul(q).mul(-45)).mul(1.8));
      return vec4(mix(color(CYAN), vec3(0.92, 0.98, 1.0), big.add(0.3)).mul(g).mul(vis).mul(1.6), 1);
    })();
    const sprite = new THREE.Sprite(m);
    sprite.count = dust;
    sprite.frustumCulled = false;
    sprite.renderOrder = 2;
    group.add(sprite);
  }

  // Crystal spurs grown out of the line in a few clusters, each growing as the arc reaches it.
  {
    const geo = new THREE.OctahedronGeometry(1, 0);
    geo.scale(0.2, 1, 0.2);
    geo.translate(0, 1, 0);   // base at the origin, tip at y = 2
    const clusters = [
      { t: 0.06, n: 9, len: 5 }, { t: 0.29, n: 22, len: 9 }, { t: 0.36, n: 8, len: 5 },
      { t: 0.57, n: 12, len: 6 }, { t: 0.8, n: 16, len: 7.5 },
    ];
    const rng = mulberry32(29);
    const total = clusters.reduce((k, c) => k + c.n, 0);
    const inst = new THREE.InstancedMesh(geo, undefined as any, total);
    const at = new Float32Array(total);
    const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    let i = 0;
    for (const c of clusters) {
      for (let k = 0; k < c.n; k++, i++) {
        const tt = c.t + (rng() - 0.5) * 0.05;
        const a = Math.PI * 2 * (0.25 - tt);
        const out = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
        const tan = new THREE.Vector3(Math.sin(a), -Math.cos(a), 0);
        pos.copy(out).multiplyScalar(R + (rng() - 0.3) * 1.6).setZ((rng() - 0.5) * 3);
        // Mostly outward, raked along the turn, some toward or away from the grove.
        const d = out.clone().multiplyScalar(0.8).addScaledVector(tan, (rng() - 0.3) * 1.1)
          .add(new THREE.Vector3(0, 0, (rng() - 0.5) * 0.9)).normalize();
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
        const L = c.len * (0.35 + rng() * 0.65);
        sc.set(L * (0.5 + rng() * 0.5), L * 0.5, L * (0.7 + rng() * 0.6));
        mm.compose(pos, q, sc);
        inst.setMatrixAt(i, mm);
        at[i] = tt;
      }
    }
    geo.setAttribute('arcT', new THREE.InstancedBufferAttribute(at, 1));
    const m = new THREE.MeshBasicNodeMaterial();
    m.fog = false;
    const ct = attribute('arcT', 'float');
    const grow = smoothstep(ct.sub(0.005), ct.add(0.03), uArc);
    m.positionNode = positionLocal.mul(grow);
    const n = normalize(normalWorld), v = normalize(cameraPosition.sub(positionWorld));
    const fres = pow(max(float(1).sub(abs(dot(n, v))), 1e-4), float(2));
    const lit = max(dot(n, uniform(SUN_DIR)), 1e-4);
    // The mesh's own position (positionLocal is already instance-transformed in the fragment).
    const tip = positionGeometry.y.div(2).clamp(1e-4, 1);
    // Faceted glass: each face lit or in shade from above-and-sunward, cyan at its edges, pale
    // and bright toward the tips.
    const facet = dot(n, normalize(uniform(SUN_DIR).add(vec3(0, 1.2, 0)))).mul(0.5).add(0.5);
    const glass = mix(vec3(0.08, 0.18, 0.22), vec3(0.66, 0.88, 0.95), spow(facet, 2))
      .add(color(CYAN).mul(fres.mul(0.5)))
      .add(vec3(1.0, 0.96, 0.88).mul(spow(lit, 10)).mul(0.8));
    // Far off, in the haze: partway to it, with its own light on top.
    m.colorNode = mix(glass, atmos.uHorizon, 0.24).add(vec3(0.75, 0.95, 1.0).mul(spow(tip, 3).mul(0.8)).mul(pulse));
    inst.material = m;
    inst.frustumCulled = false;
    group.add(inst);
  }

  // Inside it, the haze a little lighter and cooler: a soft disc, brightest where the ring is drawn.
  const inner = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  inner.fog = false;
  const rd = length(uv().sub(0.5)).mul(2);
  inner.colorNode = mix(atmos.uHorizon.mul(1.1), vec3(0.74, 0.92, 1.0), float(0.35));
  inner.opacityNode = smoothstep(1.0, 0.2, rd).mul(0.38).mul(uArc);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R * 0.98, 48), inner);
  disc.position.z = -0.5;
  group.add(disc);

  let target = 0.2;
  return {
    group,
    /** 0..1: how much of the ring is drawn (the story's progress). */
    setStage(k: number, now = false) {
      target = 0.12 + 0.88 * k;
      if (now) uArc.value = target;
    },
    /** How much of it is drawn now (0..1). */
    get arc() { return uArc.value; },
    update(dt: number) {
      uArc.value += (target - uArc.value) * (1 - Math.exp(-dt * 0.2));
    },
  };
}
