import * as THREE from 'three/webgpu';
import { float, instancedBufferAttribute, mix, mx_fractal_noise_float, smoothstep, time, uv, vec3, length, max } from 'three/tsl';

/**
 * Cloud banks: soft layers of haze standing between the distances, so the far world reads in
 * planes (near grove, the banks, the inverted world above, the sky) rather than one flat fog.
 * Large camera-facing cards, each its own patch of slow noise, pale on top where the light falls
 * and the sky's colour below. A deck of them hides the inverted world's roots.
 */
export interface Bank { at: THREE.Vector3; size: number }

export function createClouds(banks: Bank[], atmos: { uHorizon: any; uSunCol: any }) {
  const group = new THREE.Group();
  group.name = 'clouds';
  // One instanced sprite for all of them (one draw).
  const centres = new THREE.InstancedBufferAttribute(new Float32Array(banks.flatMap((b) => [b.at.x, b.at.y, b.at.z])), 3);
  const sizes = new THREE.InstancedBufferAttribute(new Float32Array(banks.flatMap((b) => [b.size, b.size * 0.42])), 2);
  const seeds = new THREE.InstancedBufferAttribute(new Float32Array(banks.map((_, i) => i * 3.17)), 1);
  const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  mat.fog = false;
  mat.positionNode = instancedBufferAttribute(centres);
  mat.scaleNode = instancedBufferAttribute(sizes);
  const seed = float(instancedBufferAttribute(seeds) as any);
  const p = uv().sub(0.5);
  const n = mx_fractal_noise_float(vec3(uv().mul(vec3(2.2, 1.4, 0).xy), seed.add(time.mul(0.004))), 4, 2.0, 0.5);
  // Flattened, soft-edged masses: wider than tall, dense in the middle.
  const r = length(p.mul(vec3(1.0, 1.9, 0).xy));
  const body = smoothstep(0.5, 0.12, r);
  const alpha = smoothstep(-0.05, 0.45, n.add(body.mul(0.55)).sub(0.25)).mul(body);
  const lit = smoothstep(0.35, 0.75, uv().y.add(n.mul(0.3)));
  mat.colorNode = mix(atmos.uHorizon.mul(0.94), atmos.uHorizon.mul(1.04).add(atmos.uSunCol.mul(0.08)), lit);
  mat.opacityNode = max(alpha.mul(0.75), float(0));
  const s = new THREE.Sprite(mat);
  s.count = banks.length;
  s.frustumCulled = false;
  s.renderOrder = -2;
  group.add(s);
  return group;
}

/** The banks: a ring between the grove and the far distance, and decks under each inverted copy. */
export function cloudBanks(centre: THREE.Vector3, decks: { at: THREE.Vector3; radius: number }[], ring = 22) {
  const out: Bank[] = [];
  let s = 5;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < ring; i++) {
    const a = (i / ring) * Math.PI * 2 + rnd() * 0.2;
    const d = 170 + rnd() * 220;
    out.push({ at: new THREE.Vector3(centre.x + Math.sin(a) * d, 18 + rnd() * 45, centre.z - Math.cos(a) * d), size: 90 + rnd() * 110 });
  }
  for (const k of decks) {
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * k.radius;
      out.push({ at: k.at.clone().add(new THREE.Vector3(Math.cos(a) * d, (rnd() - 0.6) * 14, Math.sin(a) * d)), size: 160 + rnd() * 140 });
    }
  }
  return out;
}
