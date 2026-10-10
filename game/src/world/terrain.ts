import * as THREE from 'three/webgpu';
import {
  Fn, color, float, mix, smoothstep, positionWorld, vec2, vec3, mx_fractal_noise_float, mx_worley_noise_vec2,
  positionView, normalView, uniform, floor, fract, hash, normalize, reflect, cameraPosition, dot, max, length,
  normalWorld,
} from 'three/tsl';
import { SUN_DIR, uDirectSun } from './atmosphere';

/**
 * Bump from a procedural height (metres) with screen-space derivatives
 * (Mikkelsen's surface-gradient method; three's bumpMap only takes textures).
 */
export function bumpNormal(height: THREE.Node<"float">, base: any = normalView) {
  return Fn(() => {
    const sx = positionView.dFdx(), sy = positionView.dFdy();
    const n = base;
    const r1 = sy.cross(n), r2 = n.cross(sx);
    const det = sx.dot(r1);
    const grad = det.sign().mul(r1.mul(height.dFdx()).add(r2.mul(height.dFdy())));
    return det.abs().mul(n).sub(grad).normalize();
  })();
}
import { fbm } from '../core/noise';
import { PALETTE } from '../core/palette';

// World layout (metres). Sun is low ahead (-Z) so the default view is backlit, like the boards.
export const WAKE_POINT = new THREE.Vector3(0, 0, 7);
export const POOL = new THREE.Vector3(1.4, 0, -5.5);
/** Still, dark pool where she sees her reflection. */
export const MIRROR = new THREE.Vector3(-4.2, 0, -15.5);
/** Where Part I walks off: toward the distant arches (Part II's ruin, not reachable yet). */
export const EXIT = new THREE.Vector3(-7.5, 0, -27);
export const ARCHES = new THREE.Vector3(-11, 0, -58);
/** The refuge gate (Part II), between the way out and the arcade, facing the way out. */
export const GATE = new THREE.Vector3().lerpVectors(EXIT, ARCHES, 0.45);
/** The gate's frame: +z toward the way out (the refuge side), +x its RIGHT pillar. */
const GATE_YAW = Math.atan2(EXIT.x - GATE.x, EXIT.z - GATE.z);
/** A point given in the gate's local frame, in world space (y = 0). */
export function gateLocal(x: number, z: number) {
  const c = Math.cos(GATE_YAW), s = Math.sin(GATE_YAW);
  return new THREE.Vector3(GATE.x + x * c + z * s, 0, GATE.z - x * s + z * c);
}
/** The search: a dead lift up to the arcade's elevated route, beyond the gate. */
export const LIFT = gateLocal(-6.2, -14.9);
/**
 * Optional places off the route (no narration; found by wandering):
 * a wide salt marsh to the east, a fallen giant to the west, the half-buried remains of
 * refuge conduits on a rise near the way out, and a dense thicket behind where she wakes.
 */
export const SALT_FLAT = new THREE.Vector3(15, 0, -9);
export const FALLEN = new THREE.Vector3(-17, 0, -3);
export const RUINS = new THREE.Vector3(7, 0, -24);
export const THICKET = new THREE.Vector3(-5, 0, 16);
/**
 * The crossing (chapter V, beyond the grove's bounds, west of the gate): a deep flooded channel
 * running north–south, spanned by a fallen conduit (BEAM), then two leaning slabs with a
 * narrow gap between them (SQUEEZE), and past them a still pool the channel runs into
 * (STILL_POOL, chapter VI), reached at POOL_EDGE on its north shore.
 */
export const CHANNEL = { a: new THREE.Vector3(-44.5, 0, -26), b: new THREE.Vector3(-44.8, 0, -54), half: 3.3, depth: 2.4 };
export const CROSS_WAKE = new THREE.Vector3(-37.2, 0, -38.8);
export const BEAM = { a: new THREE.Vector3(-40.4, 0, -40), b: new THREE.Vector3(-48.8, 0, -40.6) };
export const SQUEEZE = { a: new THREE.Vector3(-51.2, 0, -41.0), b: new THREE.Vector3(-55.0, 0, -41.4) };
export const STILL_POOL = new THREE.Vector3(-52, 0, -53.5);
export const STILL_RADIUS = 7.5;
export const POOL_EDGE = new THREE.Vector3(-53.2, 0, -45.4);
/** The other side (chapter VI): the causeway seen only in the pool, and the arch it leads to. */
export const OTHER_PATH = [
  new THREE.Vector3(-53.0, 0, -46.6), new THREE.Vector3(-55.0, 0, -49.6), new THREE.Vector3(-55.5, 0, -53.2),
  new THREE.Vector3(-53.6, 0, -56.6), new THREE.Vector3(-51.3, 0, -60.3),
];
export const OTHER_ARCH = new THREE.Vector3(-50.7, 0, -62.0);
/** Soft bounds of the explorable area. */
export const BOUNDS = { x: -1, z: -7, r: 31 };
/** Walkable spine of Part I, used to keep trees and rubble off the route. */
export const ROUTE = [WAKE_POINT, POOL, MIRROR, EXIT];
/**
 * The grove chapter's path (story/afterimages.ts ORDER): from the way out round the grove to
 * each afterimage in turn and back. Trees keep a lane along it so the steps aren't blocked.
 */
export const GROVE_PATH = [EXIT, FALLEN, THICKET, POOL, SALT_FLAT, RUINS, MIRROR, EXIT];
export const WATER_LEVEL = 0;
export const TERRAIN_SIZE = 130;

/** Distance from (x, z) to the segment a–b on the ground plane. */
function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

function bump(x: number, z: number, cx: number, cz: number, r: number) {
  const dx = x - cx, dz = z - cz;
  return Math.exp(-(dx * dx + dz * dz) / (r * r));
}

/** Analytic ground height; used for mesh, player grounding and placement. */
export function heightAt(x: number, z: number): number {
  let h = (fbm(x * 0.07 + 11, z * 0.07 - 3, 4) - 0.5) * 0.85;
  h += (fbm(x * 0.45, z * 0.45, 3) - 0.5) * 0.1;
  // Distant mineral outcrops break up the horizon.
  const far = Math.min(1, Math.max(0, (Math.hypot(x - BOUNDS.x, z - BOUNDS.z) - 30) / 22));
  h += far * Math.max(0, fbm(x * 0.05 - 7, z * 0.05 + 5, 3) - 0.45) * 9;
  // Dry cracked patch where she wakes; a clear shallow pool ahead.
  h += 0.28 * bump(x, z, WAKE_POINT.x, WAKE_POINT.z, 3.2);
  h -= 0.32 * bump(x, z, POOL.x, POOL.z, 2.6);
  h -= 0.45 * bump(x, z, MIRROR.x, MIRROR.z, 2.2);
  // Salt marsh: a broad, very shallow basin, flattened so it reads as one still sheet with
  // low crusted islands.
  const salt = bump(x, z, SALT_FLAT.x, SALT_FLAT.z, 8.5);
  h = h * (1 - 0.75 * salt) - 0.16 * salt + 0.05 * salt * (fbm(x * 0.6 + 3, z * 0.6, 2) - 0.5);
  // A rise holding the buried conduit ruins; a shallow hollow under the fallen giant.
  h += 0.55 * bump(x, z, RUINS.x, RUINS.z, 5.5);
  h -= 0.12 * bump(x, z, FALLEN.x, FALLEN.z, 5);
  // The thicket stands on dry, cracked ground, like where she woke.
  h += 0.3 * bump(x, z, THICKET.x, THICKET.z, 6);
  // Keep the walk-off toward the arches mostly dry and even.
  h = h * (1 - 0.6 * bump(x, z, EXIT.x, EXIT.z, 5)) + 0.06 * bump(x, z, EXIT.x, EXIT.z, 5);
  // The refuge floor at the gate: level, just under the paving and the shallow water.
  const floor = Math.min(1, Math.max(0, (17 - Math.hypot(x - GATE.x, z - GATE.z)) / 6));
  h = h * (1 - floor) - 0.12 * floor;
  // The lift's landing: level ground in front of the arcade.
  const landing = Math.min(1, Math.max(0, (7 - Math.hypot(x - LIFT.x, z - LIFT.z)) / 3.5));
  h = h * (1 - landing) - 0.08 * landing;
  // The crossing: level dry banks where the conduit rests and along the way on, the channel
  // cut deep between them, and the still pool beyond.
  const bank = Math.min(1, Math.max(0, (6 - segDist(x, z, CROSS_WAKE.x, CROSS_WAKE.z, SQUEEZE.b.x, SQUEEZE.b.z)) / 3));
  h = h * (1 - bank) + 0.12 * bank;
  const cd = segDist(x, z, CHANNEL.a.x, CHANNEL.a.z, CHANNEL.b.x, CHANNEL.b.z);
  const cut = Math.min(1, Math.max(0, (CHANNEL.half - cd) / 1.1));
  h = h * (1 - cut) - CHANNEL.depth * cut * cut * (3 - 2 * cut);
  const still = Math.min(1, Math.max(0, (STILL_RADIUS - Math.hypot(x - STILL_POOL.x, z - STILL_POOL.z)) / 2.5));
  h = h * (1 - still) - 0.5 * still;
  return h;
}

export function createTerrain(segments: number) {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const large = mx_fractal_noise_float(vec3(p.x.mul(0.3), p.z.mul(0.3), 0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const fine = mx_fractal_noise_float(vec3(p.x.mul(4.0), p.z.mul(4.0), 1), 2, 2.0, 0.5).mul(0.5).add(0.5);
  // Desiccated clay occurs in islands. Silty runnels and gravel interrupt the cells rather
  // than covering the entire grove in the same cracked plate pattern.
  const clay = smoothstep(0.42, 0.56, large.add(fine.sub(0.5).mul(0.2)));
  const sediment = mx_fractal_noise_float(vec3(p.x.mul(0.65), p.z.mul(1.6), 12), 3, 2, 0.5).mul(0.5).add(0.5);
  const detail = smoothstep(35.0, 6.0, length(p.sub(cameraPosition)));
  // Domain-warped cells so the dried mud cracks don't read as tiles.
  const warp = vec2(fine.sub(0.5), large.sub(0.5)).mul(0.35);
  const cells = mx_worley_noise_vec2(vec2(p.x.mul(2.3), p.z.mul(2.3)).add(warp));
  const crackWidth = fine.mul(0.05).add(0.012);
  const crackEdge = smoothstep(0.0, crackWidth, cells.y.sub(cells.x));
  const crackAA = cells.y.sub(cells.x).fwidth().max(0.001);
  const visibleCrack = smoothstep(crackWidth.add(crackAA), crackWidth.sub(crackAA).max(0), cells.y.sub(cells.x));
  // A finer network inside the plates (thinner, shallower), and rare deep fissures across them.
  const small = mx_worley_noise_vec2(vec2(p.x.mul(7.5), p.z.mul(7.5)).add(warp.mul(2.2)));
  const smallEdge = smoothstep(0.0, 0.035, small.y.sub(small.x));
  const fissures = mx_worley_noise_vec2(vec2(p.x.mul(0.55), p.z.mul(0.55)).add(warp.mul(0.6)));
  const fissureOn = smoothstep(0.55, 0.75, mx_fractal_noise_float(vec3(p.x.mul(0.12), p.z.mul(0.12), 5), 2, 2.0, 0.5).mul(0.5).add(0.5));
  const fissure = smoothstep(0.025, 0.0, fissures.y.sub(fissures.x)).mul(fissureOn);

  // Dry above the waterline, darker and glossier as it gets wet; a pale salt crust just above
  // the line where the water has dried off.
  const dry = smoothstep(0.015, 0.16, p.y);
  const damp = smoothstep(0.0, 0.05, p.y).mul(smoothstep(0.2, 0.06, p.y));
  const saltPatch = smoothstep(0.45, 0.7, mx_fractal_noise_float(vec3(p.x.mul(1.4), p.z.mul(1.4), 9), 3, 2.0, 0.5).mul(0.5).add(0.5));
  const salt = smoothstep(0.03, 0.08, p.y).mul(smoothstep(0.24, 0.1, p.y)).mul(saltPatch);
  // Iron staining pools in the hollows; pale dust lies on the rises.
  const hollow = smoothstep(0.35, 0.05, p.y).mul(dry);
  const stain = smoothstep(0.55, 0.8, mx_fractal_noise_float(vec3(p.x.mul(0.5), p.z.mul(0.5), 3), 3, 2.0, 0.5).mul(0.5).add(0.5)).mul(hollow);
  const dust = smoothstep(0.35, 1.2, p.y);
  // Grit: dark specks scattered over the dry ground.
  const speck = smoothstep(0.62, 0.72, mx_fractal_noise_float(vec3(p.x.mul(38), p.z.mul(38), 7), 1, 2.0, 0.5).mul(0.5).add(0.5)).mul(dry);

  // Wet films: patches of the plates still holding a skin of water (more of them low down),
  // darker and glossy, so the backlight runs across the ground in sheets and points.
  const wetN = mx_fractal_noise_float(vec3(p.x.mul(0.45), p.z.mul(0.45), 11), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const wetFilm = smoothstep(0.5, 0.68, wetN.add(smoothstep(0.5, 0.0, p.y).mul(0.18))).mul(dry)
    .mul(mix(float(0.55), float(1), crackEdge));

  const gap = cells.y.sub(cells.x);
  const lip = smoothstep(crackWidth, crackWidth.mul(4), gap).oneMinus().mul(crackEdge);
  mat.colorNode = Fn(() => {
    // Neutral mineral silt takes its warmth from the light; damp soil has a cooler grey
    // undertone. Different-sized deposits remain legible beneath the film grade.
    const silt = mix(color(0x7f8179), color(0xc0beb3), smoothstep(0.35, 0.65, sediment));
    const base = mix(silt, color(0xcec9bc), clay.mul(0.68)).toVar();
    base.assign(mix(base, color(PALETTE.rust).mul(1.4), stain.mul(0.28)));
    base.assign(mix(base, color(PALETTE.bone).mul(1.08), dust.mul(0.25)));
    // Curled plate edges catch the light.
    base.assign(base.mul(float(1).add(lip.mul(0.035).mul(dry).mul(clay))));
    const cracked = base.mul(float(1).sub(visibleCrack.mul(dry).mul(clay).mul(0.45)))
      .mul(mix(float(1), mix(float(0.84), float(1), smallEdge), dry.mul(clay).mul(detail).mul(0.45)))
      .mul(float(1).sub(fissure.mul(0.30).mul(dry).mul(clay)))
      .mul(float(1).sub(speck.mul(0.16)));
    const wet = cracked.mul(mix(float(0.49), float(1.0), dry)).mul(float(1).sub(damp.mul(0.15)))
      .mul(float(1).sub(wetFilm.mul(0.23)));
    return mix(wet, color(0xe1dfd3), salt.mul(0.40).mul(float(1).sub(wetFilm)));
  })();
  mat.roughnessNode = mix(mix(float(0.60), float(0.93), dry).add(salt.mul(0.04)),
    float(0.48).add(fine.mul(0.10)), wetFilm.mul(0.72));
  mat.envMapIntensity = 0.45;
  // Glitter on the wet ground: tiny facets of the water skin that catch the sun (as on the
  // water itself), only where it's wet and only looking toward the light.
  const uSun = uniform(SUN_DIR);
  const glitter = Fn(() => {
    const q = p.xz.mul(26.0);
    const cell = floor(q), f = fract(q);
    const id = cell.x.mul(157.3).add(cell.y.mul(271.9));
    const k = id; // The soil's facets stay fixed as the camera moves.
    const n = normalize(normalWorld.add(vec3(hash(k).sub(0.5), 0, hash(k.add(1.7)).sub(0.5)).mul(0.5)));
    const v = normalize(p.sub(cameraPosition));
    const a = max(dot(reflect(v, n), uSun), 0.0);
    const at = vec2(hash(k.add(4.1)), hash(k.add(8.3))).mul(0.5).add(0.25);
    const point = smoothstep(0.3, 0.08, length(f.sub(at)));
    const near = smoothstep(26.0, 8.0, length(p.sub(cameraPosition)));
    return smoothstep(0.988, 0.999, a).mul(point).mul(max(wetFilm, float(1).sub(dry).mul(0.6))).mul(near).mul(smoothstep(0.0, 0.2, uSun.y));
  })();
  mat.emissiveNode = color(0xfff1d6).mul(glitter.mul(1.4)).mul(uDirectSun);
  // Millimetre-scale relief: shallow clay cracks and curled edges, with rare deeper fissures.
  const grit = mx_fractal_noise_float(vec3(p.x.mul(22), p.z.mul(22), 2), 2, 2.0, 0.5);
  // Keep the differentiated height independent of screen derivatives; filtered colour
  // cracks above must not feed bumpNormal (nested derivatives fail on WebGL).
  const relief = crackEdge.mul(0.0036).add(lip.mul(0.0008)).add(smallEdge.mul(0.00065).mul(detail))
    .sub(fissure.mul(0.005)).mul(clay).mul(dry)
    .add(fine.mul(0.0013)).add(grit.mul(0.00045).mul(detail)).add(salt.mul(0.0008));
  mat.normalNode = bumpNormal(relief);
  mat.metalnessNode = float(0);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/** R: normalized depth over 0.5 m. G: signed ground height, encoded as metres + 0.5.
 * Signed height preserves the waterline through bilinear filtering at dry/wet boundaries.
 */
export function createDepthTexture(res = 512) {
  const data = new Uint8Array(res * res * 4);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      // Sample texel centres so the shader's world / size + 0.5 UVs interpolate in place.
      const x = ((i + 0.5) / res - 0.5) * TERRAIN_SIZE;
      const z = ((j + 0.5) / res - 0.5) * TERRAIN_SIZE;
      const h = heightAt(x, z) - WATER_LEVEL;
      const d = Math.min(1, Math.max(0, -h / 0.5));
      const k = (j * res + i) * 4;
      data[k] = data[k + 2] = Math.round(d * 255);
      data[k + 1] = Math.round(Math.min(1, Math.max(0, h + 0.5)) * 255);
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
