import * as THREE from 'three/webgpu';
import {
  Fn, Loop, uniform, uniformArray, vec2, vec3, vec4, float, color, positionWorld, cameraPosition,
  normalize, length, exp, cos, sin, max, dot, pow, mix, smoothstep, reflector, texture, reflect, mx_noise_float,
  floor, fract, hash,
} from 'three/tsl';
import { PALETTE } from '../core/palette';
import { MIRROR, TERRAIN_SIZE, WATER_LEVEL } from './terrain';

const MAX_RIPPLES = 24;

/**
 * Shallow reflective water with analytic ripple rings.
 * Ripples are the game's main feedback for touch: gentle contact = one small ring,
 * rough contact = a large, fast, noisy one.
 */
export class Water {
  mesh: THREE.Mesh;
  private ripples: THREE.Vector4[] = [];
  private next = 0;
  private uTime = uniform(0);
  /** Wind on the water, 0..1 (follows the audio gusts). */
  readonly uGust = uniform(0);
  /** The other side (chapter VI): all the water turns to still, dark glass. */
  readonly uGlass = uniform(0);
  private reflection: ReturnType<typeof reflector>;

  constructor(scene: THREE.Scene, depthTex: THREE.Texture, reflectionScale: number, sunDir: THREE.Vector3) {
    for (let i = 0; i < MAX_RIPPLES; i++) this.ripples.push(new THREE.Vector4(0, 0, -1000, 0));
    const uRipples = uniformArray(this.ripples, 'vec4');
    const uTime = this.uTime;
    const uSun = uniform(sunDir); // shared: follows the time of day

    const reflection = reflector({ resolutionScale: reflectionScale });
    this.reflection = reflection;
    reflection.target.rotateX(-Math.PI / 2);
    reflection.target.position.y = WATER_LEVEL;
    scene.add(reflection.target);

    const uGust = this.uGust;
    const catsPaws = (p: any, t: any) => {
      const drift = vec2(t.mul(1.1), t.mul(0.38));
      const n = mx_noise_float(vec3(p.sub(drift).mul(vec2(0.16, 0.22)), t.mul(0.05)));
      const still = smoothstep(2.4, 4.2, length(p.sub(vec2(MIRROR.x, MIRROR.z))));
      return smoothstep(0.15, 0.55, n).mul(uGust.mul(0.9).add(0.12)).mul(still);
    };
    // Ring slopes alone (d height / d xz): the rings also catch a little light on their crests.
    const rings = Fn(() => {
      const p = positionWorld.xz;
      const g = vec2(0, 0).toVar();
      Loop(MAX_RIPPLES, ({ i }) => {
        const r = uRipples.element(i) as any;
        const d = p.sub(r.xy);
        const dist = max(length(d), 0.0001);
        const age = max(uTime.sub(r.z), 0.0);
        const front = age.mul(0.2);
        const x = dist.sub(front);
        const freq = float(55.0);
        const envelope = exp(x.mul(x).mul(-160.0)).mul(exp(age.mul(-0.55))).mul(r.w)
          .mul(smoothstep(0.0, 0.08, age));
        const s = cos(x.mul(freq)).mul(freq).mul(envelope);
        g.addAssign(d.div(dist).mul(s));
      });
      return g;
    })();
    // All slopes: rings plus a faint ambient shimmer.
    const slope = Fn(() => {
      const p = positionWorld.xz;
      const g = vec2(rings).toVar();
      // Ambient: slow crossing wavelets, very small.
      const t = uTime;
      const a1 = cos(p.x.mul(3.1).add(p.y.mul(1.7)).add(t.mul(0.9))).mul(0.012);
      const a2 = cos(p.x.mul(-2.3).add(p.y.mul(3.7)).add(t.mul(1.3))).mul(0.010);
      const a3 = sin(p.x.mul(9.0).sub(p.y.mul(7.0)).add(t.mul(2.1))).mul(0.004);
      g.addAssign(vec2(a1.mul(3.1).sub(a2.mul(2.3)).add(a3.mul(9.0)), a1.mul(1.7).add(a2.mul(3.7)).sub(a3.mul(7.0))));
      // Cat's paws: patches of wind-roughened water drifting downwind; stronger in gusts.
      // The still pool is sheltered.
      const paws = catsPaws(p, t);
      const b1 = cos(p.x.mul(13.0).add(p.y.mul(5.0)).add(t.mul(7.0))).mul(0.012);
      const b2 = cos(p.x.mul(-6.0).add(p.y.mul(14.0)).add(t.mul(8.3))).mul(0.010);
      g.addAssign(vec2(b1.mul(13.0).sub(b2.mul(6.0)), b1.mul(5.0).add(b2.mul(14.0))).mul(paws));
      // Chop: fine wavelets running every way (six directions, 2–5 cm), always a little there
      // and more in the wind, so a bright reflection breaks into shards instead of a smear.
      // Not on the still pool or the other side's glass.
      const calm = smoothstep(2.6, 4.2, length(p.sub(vec2(MIRROR.x, MIRROR.z)))).mul(float(1).sub(this.uGlass));
      const chopAmp = uGust.mul(0.6).add(0.55).mul(calm);
      const dirs: [number, number, number, number][] = [
        [0.95, 0.31, 21, 2.9], [-0.42, 0.91, 27, 3.7], [0.66, -0.75, 33, 4.3],
        [-0.88, -0.47, 41, 5.1], [0.17, 0.98, 52, 6.2], [-0.99, 0.12, 63, 7.4],
      ];
      for (const [dx, dz, k, w] of dirs) {
        const ph = p.x.mul(dx * k).add(p.y.mul(dz * k)).add(t.mul(w)).add(dx * 5.1);
        const a = cos(ph).mul((0.0022 * 21) / k);
        g.addAssign(vec2(a.mul(dx * k), a.mul(dz * k)).mul(chopAmp));
      }
      return g;
    })();

    const nWorld = normalize(vec3(slope.x.negate(), 1.0, slope.y.negate()));
    reflection.uvNode = reflection.uvNode!.add(slope.mul(0.012));

    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const viewDir = normalize(positionWorld.sub(cameraPosition));
    const cosT = max(dot(nWorld, viewDir.negate()), 0.0);
    const fresnel = float(0.03).add(float(0.97).mul(pow(float(1).sub(cosT), 5.0)));

    // Shoreline: depth from baked terrain map.
    const depthUV = positionWorld.xz.div(TERRAIN_SIZE).add(0.5);
    const depth = texture(depthTex, depthUV).r;
    const shore = smoothstep(0.0, 0.06, depth);

    const glintDir = reflect(viewDir, nWorld);
    const toSun = max(dot(glintDir, uSun), 0.0);
    // Glitter: tiny facets of the moving surface catching the sun, twinkling in and out. Out of
    // focus they bloom into the soft bokeh discs the films are full of.
    const twinkle = smoothstep(0.66, 0.9, mx_noise_float(vec3(positionWorld.xz.mul(26.0), uTime.mul(1.7))));
    // Sun glitter, as in the boards: the sun's path on the water broken into thousands of
    // points. Two grids of tiny facets (a few centimetres, and finer); each is tilted at random
    // and re-tilts now and then at its own pace, and flashes only while it faces the sun. They
    // are far brighter than anything else, so the bloom (and, in close shots, the focus) turns
    // them into soft discs.
    const facets = (scale: number, tilt: number, rate: number, seed: number) => {
      const q = positionWorld.xz.mul(scale);
      const cell = floor(q), f = fract(q);
      const id = cell.x.mul(127.1).add(cell.y.mul(311.7)).add(seed);
      const phase = floor(uTime.mul(rate).mul(hash(id).mul(0.8).add(0.6)).add(hash(id.add(7.0)).mul(10.0)));
      const k = id.add(phase.mul(57.3));
      const n = normalize(vec3(slope.x.add(hash(k).sub(0.5).mul(tilt)).negate(), 1.0, slope.y.add(hash(k.add(3.1)).sub(0.5).mul(tilt)).negate()));
      const a = max(dot(reflect(viewDir, n), uSun), 0.0);
      // A small round point inside the cell, not the whole square.
      const at = vec2(hash(k.add(5.3)), hash(k.add(9.7))).mul(0.5).add(0.25);
      const dot_ = smoothstep(0.32, 0.08, length(f.sub(at)));
      return smoothstep(0.985, 0.9985, a).mul(dot_);
    };
    const sparkle = facets(18.0, 0.55, 2.2, 0.0).add(facets(46.0, 0.7, 3.4, 41.0).mul(0.6))
      .mul(smoothstep(0.0, 0.2, uSun.y)).mul(float(1).sub(this.uGlass));
    const glint = pow(toSun, 1400.0).mul(3.0)
      .add(pow(toSun, 80.0).mul(0.1))
      .add(twinkle.mul(pow(toSun, 24.0)).mul(1.6))
      .add(sparkle.mul(14.0));

    // Mineral scum drifting in pale patches near the shores, and small floating flecks (the
    // films' shallows), never on the mirror pool or the other side's glass.
    const scumN = mx_noise_float(vec3(positionWorld.xz.mul(0.32), uTime.mul(0.01)));
    const nearShore = float(1).sub(smoothstep(0.04, 0.5, depth));
    const scum = smoothstep(0.25, 0.6, scumN).mul(nearShore).mul(0.55)
      .add(smoothstep(0.78, 0.9, mx_noise_float(vec3(positionWorld.xz.mul(7.0), 3.0))).mul(nearShore.add(0.2)).mul(0.5));
    // The mirror pool is deep and dark: it reflects almost like glass, even looking straight down.
    const mirror = max(smoothstep(3.6, 2.6, length(positionWorld.xz.sub(vec2(MIRROR.x, MIRROR.z)))), this.uGlass);
    const tint = mix(color(PALETTE.hazeDeep).mul(0.22), color(PALETTE.charcoal).mul(0.35), mirror);
    mat.colorNode = Fn(() => {
      // Where the reflection is blinding (the sun's path), it comes apart on the chop into
      // bright shards and points with darker water between, as in the boards.
      // (The sun's disc itself is left to the glitter: the mirrored sky is capped below it.)
      const raw = vec3(reflection.rgb);
      const lumR = raw.dot(vec3(0.3, 0.5, 0.2));
      const cap = mix(float(1e4), float(2.2), float(1).sub(mirror));
      const refl0 = raw.mul(cap.div(max(lumR, cap)));
      const hot = smoothstep(0.7, 2.0, lumR).mul(float(1).sub(mirror));
      const breakUp = smoothstep(0.42, 0.62, mx_noise_float(vec3(positionWorld.xz.mul(vec2(11.0, 19.0)), uTime.mul(1.3))));
      const refl = refl0.mul(mix(float(1), breakUp.mul(1.2).add(0.12), hot));
      // Roughened patches reflect less of the sky.
      const k = mix(fresnel.mul(0.85).add(0.12), float(0.9), mirror).mul(float(1).sub(catsPaws(positionWorld.xz, uTime).mul(0.25)));
      const c = mix(tint, refl, k);
      const crest = length(rings).mul(1.3).min(0.6);
      const clean = float(1).sub(mirror);
      const water = c.add(color(PALETTE.sun).mul(glint)).add(color(PALETTE.haze).mul(crest));
      return vec4(mix(water, color(0xcfc6b0).mul(0.9), scum.mul(clean).min(0.8)), 1.0);
    })();
    mat.opacityNode = mix(mix(float(0.35), float(0.97), fresnel), float(0.98), mirror).add(glint).add(scum.mul(float(1).sub(mirror)).mul(0.5)).mul(shore).min(1.0);

    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'water';
    scene.add(this.mesh);
  }

  /**
   * Let the reflection see a layer the camera itself doesn't: things that exist only in the
   * water (chapter VI's path). Its reflection camera is a clone of the view camera.
   */
  showInReflection(camera: THREE.Camera, layer: number, on = true) {
    const v = this.reflection.reflector.getVirtualCamera(camera);
    if (on) v.layers.enable(layer); else v.layers.disable(layer);
  }

  /**
   * Keep `objects` out of the reflection (small clutter, things far up in the sky): they move to
   * `layer`, which the view camera and the sun's shadow camera see but the reflection doesn't.
   * Saves a draw each in the reflection pass.
   */
  excludeFromReflection(camera: THREE.Camera, shadowCamera: THREE.Camera, layer: number, objects: THREE.Object3D[]) {
    camera.layers.enable(layer);
    shadowCamera.layers.enable(layer);
    for (const o of objects) o.traverse((c) => c.layers.set(layer));
    this.showInReflection(camera, layer, false);
  }

  /** amp ~0.0005 (fingertip) .. 0.006 (splash). */
  addRipple(x: number, z: number, amp: number) {
    const r = this.ripples[this.next];
    r.set(x, z, this.uTime.value, amp);
    this.next = (this.next + 1) % MAX_RIPPLES;
  }

  update(t: number) {
    this.uTime.value = t;
  }
}
