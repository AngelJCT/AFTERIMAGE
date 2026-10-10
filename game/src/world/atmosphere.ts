import * as THREE from 'three/webgpu';
import {
  Fn, uniform, vec3, vec4, color, mix, pow, max, dot, smoothstep, normalize, positionWorld,
  positionWorldDirection, cameraPosition, fog, densityFogFactor, instancedArray, time, sin, mod, uv,
  length, hash, instanceIndex, exp, vec2, mx_fractal_noise_float, float,
} from 'three/tsl';
import { PALETTE } from '../core/palette';

/**
 * How the weather's light is shared: more from the sun, less from the sky's fill, so shade is
 * shade and the backlight reads (world/weather.ts multiplies its presets by these).
 */
export const LIGHT = { sun: 1.08, fill: 0.72 };

/** Toward the sun. Weather (world/weather.ts) moves it in place for the time of day. */
export const SUN_DIR = new THREE.Vector3(-0.42, 0.3, -1).normalize();
/** Direct sunlight relative to clear day; shared by sky, shafts and surface glints. */
export const uDirectSun = uniform(1);
/** Shared with the story's gradual reveal of the refuge. */
export const ATMOSPHERE_BASE = { mist: 0.32, fog: 0.016 } as const;

/** Sky dome, haze with sun in-scattering, sun + fill light. */
export function createAtmosphere(scene: THREE.Scene, shadowSize: number) {
  // Shared with SUN_DIR (same vector), so moving the sun moves its glow and haze.
  const uSun = uniform(SUN_DIR);
  const uSunCol = uniform(new THREE.Color(PALETTE.sun));
  const uHorizon = uniform(new THREE.Color(PALETTE.haze));
  const uZenith = uniform(new THREE.Color(PALETTE.sky));
  const sunCol = uSunCol, horizon = uHorizon, zenith = uZenith;

  // Haze and sky are one thing: light scattered by dust, so it depends on where you look. Into
  // the sun it glows hot (forward scattering: a wide warm bloom and a tight core round the
  // disc); away from it, a dim cooler veil, so the far side of the grove keeps its depth and the
  // backlit side burns, as in the boards. Far things dissolve into exactly the sky behind them.
  const uHazeAway = uniform(0.66);
  const uMie = uniform(0.34);
  const uMieCore = uniform(0.65);
  const skyAt = (d: any) => {
    const c = dot(d, uSun);
    const s = max(c, 0.0);
    const up = smoothstep(-0.1, 0.6, d.y);
    const base = mix(horizon.mul(0.95), zenith.mul(0.8), up)
      .mul(mix(uHazeAway, float(1.0), smoothstep(-0.7, 0.85, c)))
      .mul(mix(vec3(0.96, 0.98, 1.03), vec3(1), smoothstep(-0.3, 0.5, c)));
    return base.add(sunCol.mul(pow(s, 5.0).mul(uMie).add(pow(s, 40.0).mul(uMieCore))).mul(uDirectSun));
  };
  scene.backgroundNode = Fn(() => {
    const d = positionWorldDirection;
    const s = max(dot(d, uSun), 0.0);
    // The disc itself, and its tight halo, only in the sky.
    return skyAt(d).add(sunCol.mul(pow(s, 220.0).mul(1.3).add(pow(s, 2000.0).mul(30.0))).mul(uDirectSun));
  })();
  // For the haze, looking at the ground: the sky's colour toward the horizon in that direction.
  const hazeColor = Fn(() => {
    const v = normalize(positionWorld.sub(cameraPosition));
    return skyAt(vec3(v.x, v.y.clamp(-0.05, 0.25), v.z).normalize());
  })();
  const uFogDensity = uniform(ATMOSPHERE_BASE.fog);
  // The haze thickens from a few metres out: what's at her feet keeps its full contrast.
  const uFogStart = uniform(9);
  // Weather's share (world/weather.ts), added on top of what the story sets.
  const uFogExtra = uniform(0);
  const uMistExtra = uniform(0);
  // Ground mist: pools below about a metre (over water and in hollows), thickens with
  // distance so what's near stays clear, and drifts slowly in broken banks.
  const uMist = uniform(ATMOSPHERE_BASE.mist);
  const mist = Fn(() => {
    const p = positionWorld;
    const low = smoothstep(0.85, 0.02, p.y);
    const dist = length(p.sub(cameraPosition));
    const far = smoothstep(5.0, 32.0, dist);
    const drift = mx_fractal_noise_float(vec3(p.xz.mul(0.07).add(vec2(time.mul(0.025), time.mul(0.008))), time.mul(0.01)), 3, 2, 0.5);
    // Broken banks leave clear water between them; near feet and roots keep their contrast.
    const bank = smoothstep(-0.12, 0.30, drift).mul(0.88).add(0.12);
    return low.mul(far).mul(bank).mul(uMist.add(uMistExtra));
  })();
  const hazeFactor = Fn(() => {
    const d = max(length(positionWorld.sub(cameraPosition)).sub(uFogStart), 0.0);
    const k = d.mul(uFogDensity.add(uFogExtra).max(0));
    return float(1).sub(exp(k.mul(k).negate()));
  })();
  scene.fogNode = fog(hazeColor, max(hazeFactor, mist));

  // Diffuse light from the pale sky and mineral ground keeps shaded ceramic legible.
  const hemi = new THREE.HemisphereLight(0xd5e0e8, 0x79786e, 1.35);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(PALETTE.sun, 3.6);
  sun.position.copy(SUN_DIR).multiplyScalar(40);
  // Cloud shadows: broken banks drifting over the grove dim the direct sun only (the haze
  // and sky fill stay), so light comes and goes across the ground like in the film.
  const uSunColor = uniform(new THREE.Color());
  const uClouds = uniform(0.42);
  const cloud = Fn(() => {
    const p = positionWorld.xz.mul(0.03).add(vec2(time.mul(0.018), time.mul(0.007)));
    const n = mx_fractal_noise_float(vec3(p, time.mul(0.004)), 3, 2, 0.5);
    return float(1).sub(smoothstep(0.15, 0.45, n).mul(uClouds));
  })();
  (sun as any).colorNode = uSunColor.mul(cloud);
  if (shadowSize > 0) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    // Updated once a frame by the game loop (Game.frame), not once per camera.
    sun.shadow.autoUpdate = false;
    const c = sun.shadow.camera as THREE.OrthographicCamera;
    c.left = c.bottom = -16;
    c.right = c.top = 16;
    c.near = 1;
    c.far = 90;
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.008;
    sun.shadow.radius = 1.6;   // crisp, like the films' hard sun through the thorns
  }
  scene.add(sun, sun.target);

  return {
    sun, hemi, uFogDensity, uMist, uSunCol, uHorizon, uZenith, uFogExtra, uMistExtra,
    uClouds, uHazeAway, uMie, uMieCore, uFogStart, uDirectSun,
    /** Keep the shadow frustum centred on the player. */
    follow(p: THREE.Vector3) {
      uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
      sun.target.position.copy(p);
      sun.position.copy(p).addScaledVector(SUN_DIR, 40);
    },
  };
}

/**
 * The sky as the world's reflection environment: a scene holding only the sky (the same
 * scattering formula as the background and the haze), captured into a prefiltered cube map.
 * Metal, wet ground and glossy bark see the haze and the sun's glow instead of black, and
 * shade gets a little sky light. Recaptured as the weather changes (update(), throttled).
 */
export function createSkyEnvironment(renderer: THREE.WebGPURenderer, scene: THREE.Scene, intensity = 0.45) {
  const sky = new THREE.Scene();
  sky.backgroundNode = scene.backgroundNode;
  const pmrem = new THREE.PMREMGenerator(renderer);
  let target: THREE.RenderTarget | null = null;
  let wait = 0, dirty = false;
  const capture = () => {
    target = pmrem.fromScene(sky, 0.02, 0.1, 100, { size: 128, renderTarget: target });
    scene.environment = target.texture;
    dirty = false;
  };
  scene.environmentIntensity = intensity;
  capture();
  return {
    /** The sky changed (weather): recapture soon, or at once after a cut. */
    markDirty(now = false) { dirty = true; if (now) wait = 0; },
    /** Each frame: recapture when dirty, at most every `every` seconds. */
    update(dt: number, every = 0.75) {
      wait -= dt;
      if (!dirty || wait > 0) return;
      wait = every;
      capture();
    },
  };
}

/** Floating dust motes around the camera; they catch the backlight and bloom into bokeh. */
/** Wind carrying the dust (world units of drift, accumulated by world/weather.ts). */
export const uDustDrift = uniform(new THREE.Vector3());
/** Dust density and brightness multiplier (a storm thickens it). */
export const uDustLevel = uniform(1);

export function createDust(count: number) {
  const box = new THREE.Vector3(24, 7, 24);
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    data[i * 3] = Math.random() * box.x;
    data[i * 3 + 1] = Math.random() * box.y;
    data[i * 3 + 2] = Math.random() * box.z;
  }
  const seeds = instancedArray(data, 'vec3');
  const uBox = uniform(box);
  const uSun = uniform(SUN_DIR);

  const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  mat.positionNode = Fn(() => {
    const s = seeds.toAttribute();
    const drift = vec3(time.mul(0.05), sin(time.mul(0.3).add(s.x)).mul(0.15).add(time.mul(-0.02)), time.mul(0.03));
    const local = mod(s.add(drift).add(uDustDrift).sub(cameraPosition), uBox);
    return local.sub(uBox.mul(vec3(0.5, 0.15, 0.5))).add(cameraPosition);
  })();
  mat.scaleNode = hash(instanceIndex).mul(0.02).add(0.008);
  mat.colorNode = Fn(() => {
    const r = length(uv().sub(0.5)).mul(2.0);
    const a = smoothstep(1.0, 0.0, r);
    // Motes toward the sun read brighter (forward scattering).
    const v = normalize(positionWorld.sub(cameraPosition));
    const fwd = pow(max(dot(v, uSun), 0.0), 3.0).mul(3.0).add(0.25);
    return vec4(color(PALETTE.sun).mul(fwd), a.mul(0.55).mul(uDustLevel));
  })();

  const sprite = new THREE.Sprite(mat);
  sprite.count = count;
  sprite.frustumCulled = false;
  sprite.name = 'dust';
  return sprite;
}
