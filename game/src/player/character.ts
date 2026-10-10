import * as THREE from 'three/webgpu';
import {
  Fn, texture, uv, smoothstep, float, color, max, min, mix, uniform, vec3, vec4, positionGeometry, sqrt, abs,
  normalMap, normalView, mat4, mx_noise_float, length, step, luminance, mx_worley_noise_vec2,
  positionLocal, modelWorldMatrixInverse, sin, time, attribute, cameraViewMatrix, normalWorld, positionWorld,
  cameraPosition, dot, pow,
} from 'three/tsl';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { PALETTE } from '../core/palette';
import { uPortDark, uPortGlow, type Placeholder } from './placeholder';
import { filmLight } from '../core/filmLight';
import { bumpNormal } from '../world/terrain';
import { addHairDetail } from './hairDetail';

/**
 * Load the rigged character (see docs/character-pipeline.md) and wrap it the same way as
 * the placeholder: root (placement + yaw) -> pivot (at the hips, for lying/kneeling) -> model.
 */
export interface CharacterOptions {
  /** synthetic: her ceramic shell, metal gaps and cyan emitters. human: skin and cloth only. */
  kind?: 'synthetic' | 'human';
  /** Uniform scale (the pipeline works at 1.65 m; the child is smaller). */
  scale?: number;
  name?: string;
}

export async function loadCharacter(url: string, onProgress?: (k: number) => void, opts: CharacterOptions = {}): Promise<Placeholder> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
  const model = gltf.scene;
  const human = opts.kind === 'human';
  // The woman drives the shared uniforms; anyone else gets their own.
  const u: CharacterUniforms = human || opts.name ? newUniforms() : WOMAN;
  if (opts.scale) model.scale.setScalar(opts.scale);

  model.updateMatrixWorld(true);
  const hips = model.getObjectByName('Hips');
  const tip = model.getObjectByName('RightIndexTip');
  if (!hips || !tip) throw new Error('character is missing required bones (Hips, RightIndexTip)');
  const hipsHeight = hips.getWorldPosition(new THREE.Vector3()).y;

  const root = new THREE.Group();
  root.name = opts.name ?? 'player';
  const pivot = new THREE.Group();
  pivot.position.y = hipsHeight;
  model.position.y = -hipsHeight;
  pivot.add(model);
  root.add(pivot);

  // Rest-pose fingertip in character space, for the wet patch after touching water.
  model.updateMatrixWorld(true);
  u.tipBind.value.copy(tip.getWorldPosition(new THREE.Vector3())).applyMatrix4(new THREE.Matrix4().copy(model.matrixWorld).invert());

  const lidMorphs: { mesh: THREE.Mesh; index: number }[] = [];
  const hairMeshes: { mesh: THREE.Mesh; toModel: THREE.Matrix4 }[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // skinned bounds don't follow the pose
    let eyes = typeof mesh.userData.eyes === 'string' ? (JSON.parse(mesh.userData.eyes) as EyeData) : null;
    const toModel = geoToModel(model, mesh);
    const src = mesh.material as THREE.MeshStandardMaterial;
    const armor = !human && mesh.userData.layeredArmor === true;
    if (!eyes && !human && !armor && src.map) raiseCeramicEdges(mesh, src.map, toModel);
    const hairW = !!eyes && !human && !!src.map && bakeHairWeights(mesh, src.map, toModel, eyes);
    if (hairW) hairMeshes.push({ mesh, toModel });
    if (eyes && src.map) measureLidSkin(mesh, src.map, toModel, eyes);
    if (eyes) eyes = toGeometrySpace(eyes, model, mesh);
    mesh.material = toNodeMaterial(src, eyes, toModel, u, human, hairW, armor);
    const idx = mesh.morphTargetDictionary?.eyesClosed;
    if (idx !== undefined) lidMorphs.push({ mesh, index: idx });
  });
  // Attach after traversing the source meshes so these fine strands keep their own material.
  for (const { mesh, toModel } of hairMeshes) addHairDetail(model, mesh, toModel, u, hairSway);

  // The shape key relaxes the sculpted iris dome into a smooth lid as the painted lid closes.
  const setBlink = (v: number) => {
    for (const m of lidMorphs) m.mesh.morphTargetInfluences![m.index] = Math.min(1, v * 1.25);
  };
  return { root, pivot, fingertip: tip, hipsHeight, setBlink, u };
}

interface Eye { c: [number, number, number]; hw: number; hh: number; iris: number; lid: [number, number, number]; depth?: number; skin?: [number, number, number] }
type EyeData = { L?: Eye; R?: Eye };

/**
 * Eye measurements are in character (bind-pose model) space. Meshopt quantisation stores a
 * skinned mesh's positions in a normalised space and folds the scale/offset into the inverse
 * bind matrices, so geometry -> character = boneRest * boneInverse * bindMatrix (any bone).
 */
function geoToModel(model: THREE.Object3D, mesh: THREE.Object3D) {
  model.updateMatrixWorld(true);
  const sm = mesh as THREE.SkinnedMesh;
  const m = new THREE.Matrix4().copy(model.matrixWorld).invert();
  if (sm.isSkinnedMesh) {
    m.multiply(sm.skeleton.bones[0].matrixWorld).multiply(sm.skeleton.boneInverses[0]).multiply(sm.bindMatrix);
  } else {
    m.multiply(mesh.matrixWorld);
  }
  return m;
}

function toGeometrySpace(eyes: EyeData, model: THREE.Object3D, mesh: THREE.Object3D): EyeData {
  const toGeo = geoToModel(model, mesh).invert();
  const s = new THREE.Vector3().setFromMatrixScale(toGeo);
  const out: EyeData = {};
  for (const k of ['L', 'R'] as const) {
    const e = eyes[k];
    if (!e) continue;
    const c = new THREE.Vector3(...e.c).applyMatrix4(toGeo);
    out[k] = { ...e, c: [c.x, c.y, c.z], hw: e.hw * s.x, hh: e.hh * s.y, iris: e.iris * s.x, depth: s.z };
  }
  return out;
}

/** Per-character shader state, driven by its Player. */
const numU = () => uniform(0);
const vecU = () => uniform(new THREE.Vector3());
export interface CharacterUniforms {
  /** 0 = eyes open, 1 = closed (idle blinks + story). */
  blink: ReturnType<typeof numU>;
  wetLegs: ReturnType<typeof numU>;
  wetHand: ReturnType<typeof numU>;
  tipBind: ReturnType<typeof vecU>;
  /** World-space push on her hair (wind, and the lag as she moves), ~0..1. */
  hair: ReturnType<typeof vecU>;
  /** The way her face points (world), for shading a closed lid smoothly. */
  face: ReturnType<typeof vecU>;
}
function newUniforms(): CharacterUniforms {
  return { blink: numU(), wetLegs: numU(), wetHand: numU(), tipBind: vecU(), hair: vecU(), face: vecU() };
}

/** 0 = eyes open, 1 = closed. Driven by the Player (idle blinks + story). */
export const uBlink = uniform(0);

/**
 * Wet skin, in character (rest-pose) space so the marks move with her: everything below
 * `uWetLegs` metres (after wading or kneeling in water) and within `uWetHand` metres of the
 * fingertip (after touching it). Driven by the Player; dries slowly.
 */
export const uWetLegs = uniform(0);
export const uWetHand = uniform(0);
export const uTipBind = uniform(new THREE.Vector3());
/** The woman's uniforms (the globals above). */
export const WOMAN: CharacterUniforms = { blink: uBlink, wetLegs: uWetLegs, wetHand: uWetHand, tipBind: uTipBind, hair: uniform(new THREE.Vector3()), face: uniform(new THREE.Vector3(0, 0, 1)) };

/**
 * The scanned eyes are painted on the face, so the lids are painted too: inside each eye's
 * opening (an ellipse in bind-pose space, measured by blender/scripts/eye_data.py) a
 * skin-coloured upper lid slides down to the lower lash line, with a dark lash edge.
 */
function eyelids(eyes: EyeData, uBlink: CharacterUniforms['blink'], human = false) {
  // The left eye is fully visible; the right is partly under the fringe and measures small.
  const ref = eyes.L ?? eyes.R!;
  // The skin measured under the eyes (measureLidSkin; both eyes averaged, so the lids match), a
  // touch deeper and pinker: lids carry a little more blood colour. Without a measurement, the
  // scan's own lid sample (taken in the crease's shadow).
  const skins = [eyes.L?.skin, eyes.R?.skin].filter((c): c is [number, number, number] => !!c);
  const skin = skins.length ? ([0, 1, 2].map((i) => skins.reduce((a, c) => a + c[i], 0) / skins.length) as [number, number, number]) : null;
  const k = skin ? [0.95, 0.9, 0.89] : human ? [0.99, 0.95, 0.95] : [0.96, 0.9, 0.88];
  const base = skin ?? ref.lid;
  const lidCol = color(new THREE.Color().setRGB(base[0] * k[0], base[1] * k[1], base[2] * k[2], THREE.SRGBColorSpace));
  const lash = color(0x1e1816);
  const p = positionGeometry;
  let cover: any = float(0);
  let edgeLine: any = float(0);
  let region: any = float(0);
  let shade: any = float(0);
  for (const e of [eyes.L, eyes.R]) {
    if (!e) continue;
    const hw = Math.max(e.hw, ref.hw) * 1.12, hh = Math.max(e.hh, ref.hh) * 1.2;
    const u = p.x.sub(e.c[0]).div(hw);
    const v = p.y.sub(e.c[1]).div(hh);
    const dz = e.depth ?? 1; // metres -> geometry units along z
    const front = smoothstep(e.c[2] - 0.022 * dz, e.c[2] - 0.01 * dz, p.z);
    const t = sqrt(max(float(1).sub(u.mul(u)), 0.0));
    // Soft outer rim so the lid blends into the surrounding skin.
    const inside = smoothstep(1.0, 0.72, u.mul(u).add(v.mul(v))).mul(front);
    // Upper lid edge descends from the top of the opening and rests just above the painted
    // lower lashes, so a closed eye reads as a dark lash arc under a smooth lid.
    const edge = t.sub(uBlink.mul(t).mul(1.84));
    const covered = smoothstep(edge.sub(0.05), edge.add(0.05), v).mul(inside);
    // Over the lid: the round of the eyeball under it catches a little light up top, and the
    // skin deepens toward the lashes.
    const across = v.sub(edge).div(max(t.sub(edge), 0.05)).clamp(0, 1);
    shade = max(shade, covered.mul(float(1).sub(across)).mul(0.14));
    const onEdge = float(1).sub(smoothstep(0.0, 0.16, abs(v.sub(edge)))).mul(inside).mul(smoothstep(0.02, 0.12, uBlink));
    // Lid crease: a faint shadow following the top of the opening while closing.
    const crease = float(1).sub(smoothstep(0.0, 0.14, abs(v.sub(t.mul(0.8))))).mul(inside).mul(uBlink).mul(0.16);
    cover = max(cover, covered);
    edgeLine = max(edgeLine, max(onEdge, crease));
    region = max(region, inside);
  }
  return { cover, edgeLine, region, lidCol, lash, shade, colour: vec3(lidCol as any) };
}

/** The texture's pixels at w×h (RGBA bytes), read once on the CPU. */
function texturePixels(img: ImageBitmap | HTMLImageElement, w: number, h: number) {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/** A millimetre of real shell thickness supplements the normal-map bevel at silhouettes.
 * Weld the displacement across UV seams, retain all skin weights, and leave soles in place.
 */
function raiseCeramicEdges(mesh: THREE.Mesh, map: THREE.Texture, toModel: THREE.Matrix4) {
  const img = map.image as ImageBitmap | HTMLImageElement | undefined;
  const geo = mesh.geometry, pos = geo.attributes.position, normals = geo.attributes.normal, tex = geo.attributes.uv;
  if (!img?.width || !tex || !normals) return;
  const size = 512, pixels = texturePixels(img, size, size), fromModel = toModel.clone().invert();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(toModel);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Color();
  const keys: string[] = [], offsets = new Map<string, { d: THREE.Vector3; count: number }>();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(toModel);
    n.fromBufferAttribute(normals, i).applyNormalMatrix(normalMatrix);
    const x = Math.max(0, Math.min(size - 1, Math.floor(tex.getX(i) * size)));
    const y = Math.max(0, Math.min(size - 1, Math.floor(tex.getY(i) * size)));
    const k = (y * size + x) * 4;
    c.setRGB(pixels[k] / 255, pixels[k + 1] / 255, pixels[k + 2] / 255, THREE.SRGBColorSpace);
    const lum = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    const port = THREE.MathUtils.smoothstep(c.b - Math.max(c.r, c.g * 0.6), 0.18, 0.4);
    const height = THREE.MathUtils.smoothstep(lum, 0.10, 0.30) * (1 - port)
      * THREE.MathUtils.smoothstep(p.y, 0.035, 0.09) * 0.0012;
    const key = `${Math.round(p.x * 100000)},${Math.round(p.y * 100000)},${Math.round(p.z * 100000)}`;
    keys.push(key);
    const entry = offsets.get(key) ?? { d: new THREE.Vector3(), count: 0 };
    entry.d.addScaledVector(n, height); entry.count++; offsets.set(key, entry);
  }
  for (let i = 0; i < pos.count; i++) {
    const entry = offsets.get(keys[i])!;
    p.fromBufferAttribute(pos, i).applyMatrix4(toModel).addScaledVector(entry.d, 1 / entry.count).applyMatrix4(fromModel);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  geo.computeBoundingBox(); geo.computeBoundingSphere();
}

/**
 * Her skin just under each eye, measured from the texture (warm and saturated; lashes and hair
 * left out). A closed lid is lit skin of that tone: the texture above the eye is painted with
 * the crease's and the fringe's shadow, and the colour sampled for the lid at scan time sat in
 * it, so a closed eye read as a dark hollow.
 */
function measureLidSkin(mesh: THREE.Mesh, map: THREE.Texture, toModel: THREE.Matrix4, eyes: EyeData) {
  const img = map.image as ImageBitmap | HTMLImageElement | undefined;
  const geo = mesh.geometry, pos = geo.attributes.position, uvA = geo.attributes.uv;
  if (!img || !uvA || !img.width) return;
  const W = 512, H = 512;
  const px = texturePixels(img, W, H);
  const v = new THREE.Vector3();
  for (const e of [eyes.L, eyes.R]) {
    if (!e) continue;
    const sum = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toModel);
      const dy = v.y - e.c[1], dx = Math.abs(v.x - e.c[0]);
      if (dy > -e.hh * 1.6 || dy < -e.hh * 3.2 || dx > e.hw * 0.9 || v.z < e.c[2] - 0.015) continue;
      const x = Math.min(W - 1, Math.max(0, Math.floor(uvA.getX(i) * W)));
      const y = Math.min(H - 1, Math.max(0, Math.floor(uvA.getY(i) * H)));
      const o = (y * W + x) * 4;
      const r = px[o] / 255, g = px[o + 1] / 255, b = px[o + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      // Skin: warm, a little saturated, neither lash-dark nor hair-silver.
      if (!(r >= g && g >= b * 0.9 && mx > 0.35 && (mx - mn) / mx > 0.12)) continue;
      sum[0] += r; sum[1] += g; sum[2] += b; n++;
    }
    if (n >= 4) e.skin = [sum[0] / n, sum[1] / n, sum[2] / n];
  }
}

/**
 * Her hair moves: each vertex's share (`hairW`, baked at load by `bakeHairWeights`) is pushed
 * along `push` (wind, and the lag as she moves, in world space) a few centimetres at most, with
 * a finer flutter that grows with it. Applied after skinning, so it rides on the head.
 */
function hairSway(rest: any, push: CharacterUniforms['hair']) {
  const w = attribute('hairW', 'float');
  const strength = length(push);
  const phase = rest.y.mul(41.0).add(rest.x.mul(27.0)).add(rest.z.mul(19.0));
  const flutter = sin(time.mul(7.3).add(phase)).mul(0.5).add(sin(time.mul(11.9).add(phase.mul(1.6))).mul(0.3));
  const along = push.mul(float(0.026).add(flutter.mul(0.006)));
  const lift = vec3(0, flutter.mul(0.004).mul(strength), 0);
  return positionLocal.add(modelWorldMatrixInverse.mul(vec4(along.add(lift).mul(w), 0)).xyz);
}

/**
 * How much of each vertex of her head is loose hair (0..1), as a `hairW` attribute. The scan's
 * texture atlas is fragmented, so a per-pixel mask would tear the surface apart: instead each
 * vertex samples the texture once (silver-grey, unsaturated: hair), the samples are welded
 * across UV seams and smoothed over the surface, then weighted from nothing at the crown to most
 * at the fringe and nape, and nothing on the face around the eyes.
 */
function bakeHairWeights(mesh: THREE.Mesh, map: THREE.Texture, toModel: THREE.Matrix4, eyes: EyeData) {
  const img = map.image as ImageBitmap | HTMLImageElement | undefined;
  const geo = mesh.geometry;
  const pos = geo.attributes.position, uvA = geo.attributes.uv, index = geo.index;
  if (!img || !uvA || !index || !img.width) return false;
  const W = 256, H = 256;
  const px = texturePixels(img, W, H);
  const n = pos.count;
  const v = new THREE.Vector3();
  const ys = new Float32Array(n), hair = new Float32Array(n);
  const group = new Int32Array(n);
  const keys = new Map<string, number>();
  const eyeC = [eyes.L, eyes.R].filter(Boolean).map((e) => new THREE.Vector3(...e!.c));
  const eyeY = Math.max(...eyeC.map(c => c.y));
  const near = new Float32Array(n);
  let groups = 0;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toModel);
    ys[i] = v.y;
    near[i] = Math.min(...eyeC.map((c) => c.distanceTo(v)));
    const k = `${Math.round(v.x * 5000)},${Math.round(v.y * 5000)},${Math.round(v.z * 5000)}`;
    let gi = keys.get(k);
    if (gi === undefined) keys.set(k, (gi = groups++));
    group[i] = gi;
    const x = Math.min(W - 1, Math.max(0, Math.floor(uvA.getX(i) * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor(uvA.getY(i) * H)));
    const o = (y * W + x) * 4;
    const r = px[o] / 255, g = px[o + 1] / 255, b = px[o + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = (mx - mn) / (mx + 0.001);
    const grey = 1 - THREE.MathUtils.smoothstep(sat, 0.07, 0.16);
    // The scan bakes warm light into the dark fringe. Above the forehead, include those
    // dark strands too; the brighter skin and the eye-distance exclusion protect the face.
    const fringe = THREE.MathUtils.smoothstep(v.y, eyeY + 0.022, eyeY + 0.067)
      * (1 - THREE.MathUtils.smoothstep(mx, 0.22, 0.62));
    hair[i] = Math.max(grey, fringe);
  }
  // Weld, then smooth over the surface's edges.
  let val = new Float32Array(groups), cnt = new Float32Array(groups);
  for (let i = 0; i < n; i++) { val[group[i]] += hair[i]; cnt[group[i]]++; }
  for (let gI = 0; gI < groups; gI++) val[gI] /= cnt[gI];
  const nb: Set<number>[] = Array.from({ length: groups }, () => new Set<number>());
  for (let t = 0; t < index.count; t += 3) {
    const a = group[index.getX(t)], b = group[index.getX(t + 1)], c = group[index.getX(t + 2)];
    nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b);
  }
  for (let it = 0; it < 8; it++) {
    const next = new Float32Array(groups);
    for (let gI = 0; gI < groups; gI++) {
      let sum = val[gI], k = 1;
      for (const o of nb[gI]) { sum += val[o]; k++; }
      next[gI] = sum / k;
    }
    val = next;
  }
  const out = new Float32Array(n), mask = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const h = THREE.MathUtils.smoothstep(val[group[i]], 0.35, 0.8);
    const fall = 1 - THREE.MathUtils.smoothstep(ys[i], 1.46, 1.64);
    const neck = THREE.MathUtils.smoothstep(ys[i], 1.3, 1.4);
    const face = THREE.MathUtils.smoothstep(near[i], 0.03, 0.07);
    mask[i] = h * neck * face;
    out[i] = mask[i] * fall;
  }
  geo.setAttribute('hairW', new THREE.BufferAttribute(out, 1));
  geo.setAttribute('hairMask', new THREE.BufferAttribute(mask, 1));
  return true;
}

/**
 * Rebuild the glTF material as a node material. The shoulder port and neck fibers only
 * exist as cyan in the base colour, so a cyan key on that texture drives emission.
 */
function toNodeMaterial(src: THREE.MeshStandardMaterial, eyes: EyeData | null, toModel: THREE.Matrix4,
  u: CharacterUniforms, human: boolean, hairWeighted = false, armor = false) {
  const { wetLegs: uWetLegs, wetHand: uWetHand, tipBind: uTipBind } = u;
  const m = new THREE.MeshPhysicalNodeMaterial();
  // Character-space position of this fragment (rest pose), for the wet marks.
  const rest = mat4(toModel).mul(vec4(positionGeometry, 1)).xyz;
  const wet = Fn(() => {
    // A slightly ragged line with short drips below it.
    const n = mx_noise_float(vec3(rest.x.mul(40), rest.z.mul(40), 0)).mul(0.012);
    const drip = mx_noise_float(vec3(rest.x.mul(90), 0, rest.z.mul(90))).max(0).mul(0.03);
    const legs = smoothstep(uWetLegs.add(n).add(drip), uWetLegs.add(n).sub(0.02), rest.y).mul(step(0.001, uWetLegs));
    const hand = smoothstep(uWetHand, uWetHand.mul(0.5), length(rest.sub(uTipBind))).mul(step(0.001, uWetHand));
    return max(legs, hand);
  })();
  m.map = src.map;
  m.normalMap = src.normalMap;
  m.normalScale.copy(src.normalScale);
  const lids0 = eyes ? eyelids(eyes, u.blink, human) : null;
  if (lids0 && src.normalMap) {
    // Under a closed lid the painted iris relief shouldn't show: fade to the smooth surface.
    m.normalMap = null;
    const mapped = normalMap(texture(src.normalMap, uv()), src.normalScale as any) as any;
    // Under the lid the geometry is the open eye's (the shape key moves points, not normals):
    // lean its normal toward the way her face points, so the lid lights as one smooth round.
    const faceView = cameraViewMatrix.mul(vec4(u.face, 0)).xyz.normalize();
    const lidNormal = mix(normalView, faceView, 0.65).normalize();
    m.normalNode = mix(mapped, lidNormal, lids0.cover).normalize();
  }
  m.metalnessMap = src.metalnessMap;
  m.roughness = 1;
  m.metalness = src.metalness;
  const lids = lids0;
  let surfaceRoughness: any = null;
  if (hairWeighted) m.positionNode = hairSway(rest, u.hair);
  if (armor) {
    // These are real closed plates: COLOR_0 separates ivory faces, chipped bevels and
    // dark undercuts. Keep the surface quiet so the geometry supplies the larger cracks.
    const base = attribute('color', 'vec3');
    const grain = mx_noise_float(rest.mul(270));
    const age = mx_noise_float(rest.mul(38)).mul(0.10);
    const cells = mx_worley_noise_vec2(rest.mul(112).add(mx_noise_float(rest.mul(28)).mul(0.65)));
    const gap = cells.y.sub(cells.x);
    const wear = smoothstep(0.04, 0.46, mx_noise_float(rest.mul(53)));
    const aa = gap.fwidth().max(0.002);
    const crack = smoothstep(float(0.020).add(aa), float(0.006).sub(aa), gap).mul(wear);
    const groove = smoothstep(0.020, 0.006, gap).mul(wear);
    const dry = base.mul(float(0.97).add(age)).mul(float(1).sub(crack.mul(0.38)));
    m.colorNode = vec4(mix(dry, dry.mul(dry).mul(0.85).add(dry.mul(0.35)), wet.mul(0.8)), 1);
    m.metalnessNode = smoothstep(0.22, 0.08, luminance(base)).mul(0.18);
    m.clearcoatNode = float(0.12).mul(float(1).sub(wet));
    m.clearcoatRoughness = 0.45;
    m.normalNode = bumpNormal(grain.mul(0.00007).sub(groove.mul(0.00016)), normalView);
    surfaceRoughness = float(0.49).add(age.mul(0.4)).add(grain.mul(0.035)).add(crack.mul(0.10));
  } else if (src.map) {
    const c = texture(src.map, uv());
    // The shared atlas covers shell, mechanical gaps and the face. Give these distinct
    // responses: ceramic and skin are dielectrics; retain metal only in the dark gaps.
    const ceramic = smoothstep(0.10, 0.30, luminance(vec3(c.rgb)));
    const metal = src.metalnessMap ? texture(src.metalnessMap, uv()).b.mul(src.metalness) : float(src.metalness);
    m.metalnessNode = eyes || human ? float(0) : max(metal.mul(0.65), 0.38).mul(float(1).sub(ceramic));
    m.clearcoatNode = eyes || human ? float(0) : ceramic.mul(0.16).mul(float(1).sub(wet));
    m.clearcoatRoughness = 0.4;
    let glow: any = smoothstep(0.18, 0.4, c.b.sub(max(c.r, c.g.mul(0.6))));
    // Blue irises aren't emitters.
    if (lids) glow = glow.mul(float(1).sub(lids.region));
    // (Only she has a port and fibres; blue paint on a coat isn't a light.)
    if (!human) m.emissiveNode = color(PALETTE.cyan).mul(glow).mul(uPortGlow.mul(1.35));
    // Dark: the painted cyan goes to a dead grey-blue (her core is off).
    const cyanOff = (rgb: any): any => (human ? rgb : mix(rgb, vec3(luminance(rgb)).mul(vec3(0.32, 0.36, 0.4)), glow.mul(uPortDark)));
    // Wet: darker, a little more saturated, and glossy.
    const wetten = (rgb: any): any => mix(rgb, rgb.mul(rgb).mul(0.85).add(rgb.mul(0.35)), wet.mul(0.8));
    if (lids) {
      m.colorNode = Fn(() => {
        // Keep the scan's strand contrast. A large constant lift turned the grey hair into
        // white plastic and left a brown fringe wherever the old colour key missed it.
        let base: any = vec3(c.rgb);
        if (!human) {
          const hairMask = hairWeighted ? attribute('hairMask', 'float') : float(0);
          const silver = vec3(luminance(base).mul(1.12).add(0.026).clamp(0.028, 0.42)).mul(vec3(0.94, 0.99, 1.02));
          base = mix(base, silver, hairMask.mul(0.92));
        }
        const skin = mix(cyanOff(base), lids.colour.mul(float(1).sub(lids.shade)), lids.cover);
        return vec4(wetten(mix(skin, lids.lash, min(lids.edgeLine.mul(0.9), 1.0))), float(1));
      })();
    } else if (!human) {
      // The atlas defines the plates. Use that same boundary for colour, relief and roughness
      // so a chipped edge catches light instead of reading as a flat patch of paint.
      const lum = luminance(vec3(c.rgb));
      const shell = ceramic.mul(float(1).sub(glow));
      const vary = mx_noise_float(rest.mul(11)).mul(0.5).add(0.5);
      const pores = mx_noise_float(rest.mul(260));
      const bevel = smoothstep(0.075, 0.34, lum).mul(float(1).sub(glow));
      const cells = mx_worley_noise_vec2(rest.mul(39).add(mx_noise_float(rest.mul(13)).mul(0.6)));
      const gap = cells.y.sub(cells.x);
      // Filter subpixel cracks; a sharp step here sparkles as the camera or limb moves.
      const aa = gap.fwidth().max(0.002);
      const crack = smoothstep(float(0.023).add(aa), float(0.009).sub(aa), gap).mul(smoothstep(0.1, 0.6, vary));
      // Height is differentiated by bumpNormal; keep derivative-based filtering out of it
      // (nested screen derivatives are undefined on the WebGL fallback).
      const groove = smoothstep(0.023, 0.009, gap).mul(smoothstep(0.1, 0.6, vary));
      const plateLip = smoothstep(0.008, 0.08, gap).mul(shell);
      const relief = bevel.mul(0.0017).add(plateLip.mul(0.00065)).sub(groove.mul(shell).mul(0.00028)).add(pores.mul(shell).mul(0.000045));
      const mapped = src.normalMap ? normalMap(texture(src.normalMap, uv()), src.normalScale as any) : normalView;
      m.normalMap = null;
      m.normalNode = bumpNormal(relief, mapped);
      surfaceRoughness = mix(float(0.6), float(0.43).add(vary.mul(0.10)), shell).add(crack.mul(shell).mul(0.12));
      m.colorNode = Fn(() => {
        const rgb = vec3(c.rgb);
        const ivory = mix(color(0xd8d3c8), color(0xece7dd), vary.mul(0.65).add(lum.mul(0.35)));
        const plate = ivory.mul(mix(float(0.82), float(1.06), smoothstep(0.12, 0.65, lum)))
          .mul(float(1).sub(crack.mul(0.42)));
        const steel = mix(rgb, vec3(lum).mul(vec3(0.72, 0.81, 0.86)), float(1).sub(glow).mul(0.6));
        return vec4(wetten(cyanOff(mix(steel, plate, shell.mul(0.94)))), float(1));
      })();
    } else {
      m.colorNode = vec4(wetten(cyanOff(vec3(c.rgb))), float(1));
    }
  }
  // Tripo's roughness reads glossy on the ceramic and hair; keep a floor so it stays glazed, not
  // wet, except where she actually is wet.
  const rough = src.roughnessMap ? texture(src.roughnessMap, uv()).g : float(0.65);
  const dryRoughness = surfaceRoughness ?? rough.clamp(human ? 0.55 : 0.52, human ? 0.95 : 0.82);
  m.roughnessNode = mix(dryRoughness, float(0.18), wet.mul(0.9));
  // Film lighting on the characters (core/filmLight.ts).
  if (m.colorNode) {
    const film = filmLight(vec3((m.colorNode as any).rgb), human ? 1 : 0.68);
    m.emissiveNode = m.emissiveNode ? (m.emissiveNode as any).add(film) : film;
  }
  return m;
}
