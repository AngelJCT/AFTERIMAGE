import * as THREE from 'three/webgpu';
import { attribute, color, float, mix, modelWorldMatrixInverse, vec4 } from 'three/tsl';
import { mulberry32 } from '../core/noise';
import { filmLight } from '../core/filmLight';
import type { CharacterUniforms } from './character';

/** Fine silhouette strands anchored to the scanned hair, following the animated head bone.
 * Opaque tapered tubes avoid transparency sorting and alpha shimmer around the face.
 * The existing scan remains the groom's volume; these only soften its outer contour.
 */
export function addHairDetail(model: THREE.Object3D, source: THREE.Mesh, toModel: THREE.Matrix4, u: CharacterUniforms,
  sway: (rest: any, push: CharacterUniforms['hair']) => any) {
  const head = model.getObjectByName('Head');
  const geo = source.geometry, mask = geo.getAttribute('hairMask');
  if (!head || !mask) return;
  model.updateMatrixWorld(true);
  const toHead = new THREE.Matrix4().copy(head.matrixWorld).invert().multiply(model.matrixWorld);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(toModel);
  const rng = mulberry32(8109), roots: { p: THREE.Vector3; n: THREE.Vector3; flex: number }[] = [];
  for (let i = 0; i < mask.count; i++) {
    if (mask.getX(i) < 0.72) continue;
    const p = new THREE.Vector3().fromBufferAttribute(geo.attributes.position, i).applyMatrix4(toModel);
    const n = new THREE.Vector3().fromBufferAttribute(geo.attributes.normal, i).applyNormalMatrix(normalMatrix);
    // Keep cheek, collar, eyebrows and hanging cyan fibres out of the groom.
    if (p.y < 1.50 || n.y < -0.25 || (p.z > 0.065 && p.y < 1.58)) continue;
    roots.push({ p, n, flex: geo.getAttribute('hairW').getX(i) });
  }
  if (!roots.length) return;
  const positions: number[] = [], shades: number[] = [], weights: number[] = [], indices: number[] = [];
  const rootPositions: number[] = [], rootWeights: number[] = [];
  const occupied = new Set<string>();
  const segments = 7, sides = 3;
  for (let attempt = 0, made = 0; attempt < 2400 && made < 260; attempt++) {
    const { p, n, flex } = roots[Math.floor(rng() * roots.length)];
    const key = `${Math.round(p.x * 500)},${Math.round(p.y * 500)},${Math.round(p.z * 500)}`;
    if (occupied.has(key)) continue;
    occupied.add(key); made++;
    const length = 0.018 + rng() * 0.032;
    const flow = new THREE.Vector3(-0.25 + rng() * 0.5, -0.8, -0.25 + rng() * 0.5);
    flow.addScaledVector(n, -flow.dot(n) * 0.7).normalize();
    const root = p.clone().addScaledVector(n, -0.0006);
    const curve = new THREE.CubicBezierCurve3(
      root,
      root.clone().addScaledVector(n, length * 0.42),
      root.clone().addScaledVector(n, length * 0.65).addScaledVector(flow, length * 0.55),
      root.clone().addScaledVector(n, length * 0.2).addScaledVector(flow, length),
    );
    const frames = curve.computeFrenetFrames(segments, false);
    const radius = 0.00032 + rng() * 0.00024, shade = rng(), start = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments, c = curve.getPoint(t);
      for (let j = 0; j < sides; j++) {
        const a = j / sides * Math.PI * 2;
        const v = c.clone().addScaledVector(frames.normals[i], Math.cos(a) * radius * (1 - t * 0.96))
          .addScaledVector(frames.binormals[i], Math.sin(a) * radius * (1 - t * 0.96)).applyMatrix4(toHead);
        positions.push(v.x, v.y, v.z); shades.push(shade); weights.push(t * t * 0.35);
        rootPositions.push(p.x, p.y, p.z); rootWeights.push(flex);
        if (i < segments) {
          const a0 = start + i * sides + j, b0 = start + i * sides + (j + 1) % sides;
          indices.push(a0, b0, a0 + sides, b0, b0 + sides, a0 + sides);
        }
      }
    }
  }
  const detail = new THREE.BufferGeometry();
  detail.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  detail.setAttribute('strandShade', new THREE.Float32BufferAttribute(shades, 1));
  detail.setAttribute('strandFlex', new THREE.Float32BufferAttribute(weights, 1));
  detail.setAttribute('strandRoot', new THREE.Float32BufferAttribute(rootPositions, 3));
  detail.setAttribute('hairW', new THREE.Float32BufferAttribute(rootWeights, 1));
  detail.setIndex(indices); detail.computeVertexNormals();
  const mat = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.48, metalness: 0, side: THREE.DoubleSide });
  mat.colorNode = mix(color(0x646d70), color(0xa9aeac), attribute('strandShade', 'float'));
  mat.emissiveNode = filmLight(mat.colorNode, 0.3);
  // Follow exactly the source root's wind displacement before adding the free tip's lag.
  // Head parenting alone would leave roots behind when the scanned groom sways during a run.
  mat.positionNode = sway(attribute('strandRoot', 'vec3'), u.hair)
    .add(modelWorldMatrixInverse.mul(vec4(u.hair.mul(attribute('strandFlex', 'float')).mul(0.008), float(0))).xyz);
  const strands = new THREE.Mesh(detail, mat);
  strands.name = 'hair-flyaways'; strands.frustumCulled = false; strands.receiveShadow = true;
  head.add(strands);
}
