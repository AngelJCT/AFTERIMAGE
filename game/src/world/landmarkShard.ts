import * as THREE from 'three/webgpu';
import {
  mix, float, normalWorld, positionWorld, cameraPosition, normalize, dot, max, pow, uniform, hash, instanceIndex, vec3,
  uv, abs, exp, smoothstep, mx_fractal_noise_float, mx_worley_noise_vec2, time, clamp, attribute, length,
} from 'three/tsl';
import { SUN_DIR } from './atmosphere';

/**
 * The shard on the horizon: a vast fractured crystal hanging far beyond the arcade, high in the
 * haze. Visible from everywhere in the grove, never reached, never explained: what she is
 * searching for, which may not be real. Split along a gap into two halves, with loose fragments
 * slowly turning round it. Pale and faint, it takes the sky's colour at its edges and catches
 * the sun on its facets; it sits beyond the fog (drawn unfogged, blended into the haze here).
 */
/** North-east of the grove, clear of the sun (which stands a little west of north). */
export const SHARD_AT = new THREE.Vector3(170, 112, -250);

function crystal(h: number, w: number, d: number, seed: number) {
  const g = new THREE.OctahedronGeometry(1, 1);
  const p = g.attributes.position;
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    // Long and tapering, its faces a little uneven.
    p.setXYZ(i, p.getX(i) * w * (1 - Math.abs(y) * 0.35) * (0.85 + r() * 0.3), y * h * (0.9 + r() * 0.2), p.getZ(i) * d * (0.85 + r() * 0.3));
  }
  g.computeVertexNormals();
  return g;
}

export function createLandmarkShard(atmos: { uHorizon: any; uSunCol: any }) {
  const group = new THREE.Group();
  group.name = 'landmarkShard';
  group.position.copy(SHARD_AT);
  group.scale.setScalar(1.8);

  const uSun = uniform(SUN_DIR);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  mat.fog = false;
  const n = normalize(normalWorld);
  const v = normalize(cameraPosition.sub(positionWorld));
  const fres = pow(float(1).sub(max(dot(n, v), 0.0)), 2.0);
  const glint = pow(max(dot(n, normalize(uSun.add(v))), 0.0), 18.0);
  const facet = hash(instanceIndex.add(1)).mul(0.08);
  // Live with the weather (dusk turns it amber, the other side's night turns it cold).
  const horizon = atmos.uHorizon, sunCol = atmos.uSunCol;
  // Pale crystal, the haze at its rims; light catching its sun-facing facets.
  mat.colorNode = mix(vec3(0.9, 0.9, 0.88).add(facet), horizon, fres.mul(0.7)).add(sunCol.mul(glint).mul(0.6));
  mat.opacityNode = float(0.58).add(fres.mul(0.28)).add(glint.mul(0.3)).min(0.92);

  // The two halves, a gap between them.
  const halfA = new THREE.Mesh(crystal(46, 14, 10, 7), mat);
  halfA.position.set(-3, 22, 0);
  halfA.rotation.z = 0.08;
  const halfB = new THREE.Mesh(crystal(30, 12, 9, 13), mat);
  halfB.position.set(5, -24, 2);
  halfB.rotation.z = -0.12;
  // The crystal turns slowly (the rupture behind it doesn't).
  const spin = new THREE.Group();
  group.add(spin);
  spin.add(halfA, halfB);

  // Loose fragments turning slowly round it.
  // (One instanced draw: one crystal, each fragment its own size and turn.)
  const FRAGS = 18;
  const fragMesh = new THREE.InstancedMesh(crystal(1, 1, 1, 31), mat, FRAGS);
  fragMesh.frustumCulled = false;
  spin.add(fragMesh);
  const frags: { size: THREE.Vector3; r: number; a: number; y: number; speed: number; rot: THREE.Euler; spin: THREE.Vector3 }[] = [];
  for (let i = 0; i < FRAGS; i++) {
    frags.push({
      size: new THREE.Vector3(1.4 + (i % 3), 3 + (i % 5) * 1.6, 1.2 + (i % 4) * 0.5),
      r: 26 + (i * 7.3) % 22, a: i * 0.9, y: -30 + (i * 13.7) % 60, speed: 0.012 + (i % 4) * 0.004,
      rot: new THREE.Euler(i * 0.7, i * 1.3, i * 0.4), spin: new THREE.Vector3((i % 3) * 0.02, 0.03, (i % 2) * 0.02),
    });
  }
  const fo = new THREE.Object3D();
  // The rupture behind it: a bright fracture in the sky, branching, with debris streaming out of
  // it and turning away. It grows chapter by chapter (setStage), so the horizon itself tells
  // that time is passing.
  const uR = uniform(0);
  const rupture = new THREE.Group();
  // Behind the shard as seen from the grove.
  rupture.position.copy(SHARD_AT.clone().setY(0).normalize().multiplyScalar(28)).setY(34);
  group.add(rupture);
  {
    const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    m.fog = false;
    const p = uv().sub(0.5);
    const len = uR.mul(0.42);
    const along = smoothstep(len, len.sub(0.08), abs(p.y));
    const path = mx_fractal_noise_float(vec3(p.y.mul(3.0), 1.7, time.mul(0.01)), 3, 2, 0.5).mul(0.1);
    const off = abs(p.x.sub(path));
    const width = float(0.005).add(uR.mul(0.013)).mul(float(1).sub(abs(p.y).mul(1.6)).max(0.2));
    const main = smoothstep(width.mul(2.5), width.mul(0.3), off);
    // Branches: cell edges near the main fracture, fewer further out.
    const warp = mx_fractal_noise_float(vec3(p.mul(4.0), 3.3), 2, 2, 0.5).mul(0.05);
    const cells = mx_worley_noise_vec2(p.mul(vec3(7.0, 4.0, 0).xy).add(warp));
    const branch = smoothstep(0.035, 0.0, cells.y.sub(cells.x)).mul(exp(off.mul(-8.0))).mul(along).mul(uR);
    const glow = exp(off.mul(off).mul(-400.0)).mul(along);
    const core = main.mul(along);
    // A rift, not a line: the sky darkens in a ragged band either side of the fracture (so it
    // reads against the pale haze), and the light inside it is far brighter than the day.
    const rag = mx_fractal_noise_float(vec3(p.mul(vec3(3.0, 6.0, 0).xy), 9.1), 3, 2, 0.5).mul(0.05);
    const rift = smoothstep(uR.mul(0.09).add(0.02), 0.0, off.add(rag)).mul(along);
    const bright = clamp(core.add(branch.mul(0.8)).add(glow.mul(0.6)), 0, 1);
    const dark = horizon.mul(0.5);
    const light = vec3(1.0, 0.94, 0.82).mul(core.mul(5.0).add(glow.mul(2.5)).add(1.0)).add(vec3(0.7, 0.9, 1.0).mul(branch.mul(3.0)));
    m.colorNode = mix(dark, light, bright);
    m.opacityNode = max(rift.mul(0.6), bright).mul(smoothstep(0.0, 0.05, uR));
    // Leaning across the sky, not standing on the ground.
    m.rotationNode = float(0.42);
    const crack = new THREE.Sprite(m);
    crack.scale.set(150, 230, 1);
    crack.renderOrder = -3;
    rupture.add(crack);
  }
  // The debris: crystal chunks leaving the fracture, drifting outward and fading.
  const DEBRIS = 90;
  const dmat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  dmat.fog = false;
  dmat.colorNode = mat.colorNode;
  dmat.opacityNode = attribute('fade', 'float').mul(0.75);
  const dgeo = crystal(1, 0.5, 0.4, 101);
  const fade = new THREE.InstancedBufferAttribute(new Float32Array(DEBRIS), 1);
  dgeo.setAttribute('fade', fade);
  const debris = new THREE.InstancedMesh(dgeo, dmat, DEBRIS);
  debris.frustumCulled = false;
  rupture.add(debris);
  const bits = Array.from({ length: DEBRIS }, (_, i) => ({
    y: ((i * 0.618) % 1) - 0.5, phase: (i * 0.377) % 1, speed: 0.008 + (i % 5) * 0.003,
    dir: new THREE.Vector3(Math.sin(i * 2.4) * 0.8, Math.cos(i * 1.7) * 0.35, 0.4 + (i % 3) * 0.3).normalize(),
    size: 1.2 + (i % 4) * 0.9, spin: i * 0.7,
  }));
  const o = new THREE.Object3D();
  let stage = 0, t = 0;

  group.renderOrder = -1;
  return {
    group,
    /** 0..1: how far the rupture has opened (the story's progress). */
    setStage(k: number, now = false) {
      stage = k;
      if (now) uR.value = k;
    },
    update(dt: number) {
      t += dt;
      uR.value += (stage - uR.value) * (1 - Math.exp(-dt * 0.15));
      const r = uR.value;
      for (const [i, b] of bits.entries()) {
        const k = (t * b.speed + b.phase) % 1;
        o.position.set(0, b.y * 150 * r * 0.9, 0).addScaledVector(b.dir, k * 70);
        o.rotation.set(b.spin + t * 0.1, b.spin * 2 + t * 0.07, 0);
        o.scale.setScalar(b.size * (1 - k * 0.5));
        o.updateMatrix();
        debris.setMatrixAt(i, o.matrix);
        fade.setX(i, Math.sin(k * Math.PI) * Math.min(1, r * 3) * (Math.abs(b.y) < r * 0.46 ? 1 : 0));
      }
      debris.instanceMatrix.needsUpdate = true;
      fade.needsUpdate = true;
      spin.rotation.y += dt * 0.006;
      for (const [i, f] of frags.entries()) {
        f.a += dt * f.speed;
        f.rot.x += f.spin.x * dt; f.rot.y += f.spin.y * dt; f.rot.z += f.spin.z * dt;
        fo.position.set(Math.cos(f.a) * f.r, f.y + Math.sin(f.a * 1.7) * 2, Math.sin(f.a) * f.r * 0.6);
        fo.rotation.copy(f.rot);
        fo.scale.copy(f.size);
        fo.updateMatrix();
        fragMesh.setMatrixAt(i, fo.matrix);
      }
      fragMesh.instanceMatrix.needsUpdate = true;
    },
  };
}
