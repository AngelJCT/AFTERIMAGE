import * as THREE from 'three/webgpu';
import { Fn, uniform, vec2, vec3, vec4, mod, time, hash, instanceIndex, instancedArray, cameraPosition, uv, smoothstep, abs, positionWorld, distance } from 'three/tsl';
import type { Game } from '../main';
import { LIGHT, SUN_DIR, uDirectSun, uDustDrift, uDustLevel } from './atmosphere';
import { PALETTE } from '../core/palette';
import { heightAt, WATER_LEVEL } from './terrain';

/**
 * Weather and time of day, as presets the story blends between: the sun's height and colour,
 * the sky, the haze and mist, cloud shadow, wind (the dust drifts with it, gusts come more
 * often), and rain (streaks around the camera, rings on the water, its hiss and patter).
 *
 * - day: the films' light. late: lower and warmer. dusk: the sun nearly down, amber, dim.
 * - storm: a dust storm, ochre and thick, the wind streaming the motes sideways.
 * - rain: overcast and grey, cool light, rain falling.
 * - other: the other side of the water (chapter VI), night and still.
 */
interface Preset {
  elev: number; sun: number; sunI: number; horizon: number; zenith: number; hemi: number;
  fog: number; mist: number; clouds: number; wind: number; dust: number; rain: number;
}
export const PRESETS = {
  day: { elev: 15.7, sun: PALETTE.sun, sunI: 4.8, horizon: PALETTE.haze, zenith: 0xdce2e3, hemi: 1.0, fog: 0, mist: 0, clouds: 0.42, wind: 1, dust: 1, rain: 0 },
  late: { elev: 9, sun: 0xffdcae, sunI: 4.3, horizon: 0xcbbb9c, zenith: 0xeadcc2, hemi: 0.95, fog: 0.002, mist: 0.1, clouds: 0.45, wind: 1.1, dust: 1.2, rain: 0 },
  dusk: { elev: 3, sun: 0xffa66c, sunI: 2.5, horizon: 0xa9937b, zenith: 0x9fa4a7, hemi: 0.78, fog: 0.006, mist: 0.3, clouds: 0.5, wind: 0.8, dust: 1.4, rain: 0 },
  storm: { elev: 12, sun: 0xffd6a0, sunI: 1.6, horizon: 0xb59c74, zenith: 0xc8b28b, hemi: 1.0, fog: 0.04, mist: 0.5, clouds: 0.85, wind: 2.6, dust: 3.2, rain: 0 },
  // The other side (chapter VI): night, a cold low light, the air clear and still.
  other: { elev: 22, sun: 0xb9c9e6, sunI: 0.9, horizon: 0x2f343c, zenith: 0x14171d, hemi: 0.42, fog: -0.008, mist: 0.2, clouds: 0.1, wind: 0.2, dust: 0.35, rain: 0 },
  rain: { elev: 14, sun: 0xdde2e2, sunI: 0.65, horizon: 0xb4b9b5, zenith: 0xcbd1cf, hemi: 2.2, fog: 0.01, mist: 0.4, clouds: 0.95, wind: 1.5, dust: 0.15, rain: 1 },
} satisfies Record<string, Preset>;
export type WeatherName = keyof typeof PRESETS;

const AZIMUTH = Math.atan2(SUN_DIR.x, SUN_DIR.z);
export const WIND_DIR = new THREE.Vector3(-1, 0, 0.25).normalize();

interface State { elev: number; sun: THREE.Color; sunI: number; horizon: THREE.Color; zenith: THREE.Color; hemi: number; fog: number; mist: number; clouds: number; wind: number; dust: number; rain: number }

function state(p: Preset): State {
  return { ...p, sun: new THREE.Color(p.sun), horizon: new THREE.Color(p.horizon), zenith: new THREE.Color(p.zenith) };
}
function lerpState(a: State, b: State, k: number): State {
  const n = (x: number, y: number) => x + (y - x) * k;
  return {
    elev: n(a.elev, b.elev), sunI: n(a.sunI, b.sunI), hemi: n(a.hemi, b.hemi), fog: n(a.fog, b.fog), mist: n(a.mist, b.mist),
    clouds: n(a.clouds, b.clouds), wind: n(a.wind, b.wind), dust: n(a.dust, b.dust), rain: n(a.rain, b.rain),
    sun: a.sun.clone().lerp(b.sun, k), horizon: a.horizon.clone().lerp(b.horizon, k), zenith: a.zenith.clone().lerp(b.zenith, k),
  };
}

export class Weather {
  private now = state(PRESETS.day);
  private from = state(PRESETS.day);
  private to = state(PRESETS.day);
  private t = 1;
  private dur = 1;
  private uRain = uniform(0);
  private rain: THREE.Sprite;
  private rippleT = 0;
  name: WeatherName = 'day';

  constructor(private g: Game) {
    // Rain: thin streaks falling through a box that follows the camera.
    const count = g.q.tier === 'high' ? 3200 : 1400;
    const box = new THREE.Vector3(18, 10, 18);
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { seeds[i * 3] = Math.random() * box.x; seeds[i * 3 + 1] = Math.random() * box.y; seeds[i * 3 + 2] = Math.random() * box.z; }
    const s = instancedArray(seeds, 'vec3');
    const uBox = uniform(box);
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    mat.fog = true;
    mat.positionNode = Fn(() => {
      const p = s.toAttribute();
      const fall = vec3(time.mul(-1.2), time.mul(-9.5).mul(hash(instanceIndex).mul(0.3).add(0.85)), time.mul(0.3));
      const local = mod(p.add(fall).sub(cameraPosition), uBox);
      return local.sub(uBox.mul(vec3(0.5, 0.3, 0.5))).add(cameraPosition);
    })();
    mat.scaleNode = vec2(0.007, hash(instanceIndex.add(7)).mul(0.2).add(0.22));
    mat.colorNode = Fn(() => {
      // Drops right at the lens would be huge smears: they fade in from a couple of metres.
      const near = smoothstep(1.2, 3.0, distance(positionWorld, cameraPosition));
      const a = smoothstep(0.5, 0.0, abs(uv().x.sub(0.5))).mul(smoothstep(0.0, 0.3, uv().y)).mul(this.uRain).mul(near).mul(0.45);
      return vec4(0.82, 0.85, 0.86, a);
    })();
    this.rain = new THREE.Sprite(mat);
    this.rain.count = count;
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rain.name = 'rain';
    g.scene.add(this.rain);
    g.onFrame((dt) => this.update(dt));
    this.apply();
  }

  /** Blend to a preset over `seconds` (0: at once). */
  set(name: WeatherName, seconds = 8) {
    this.name = name;
    this.blendTo(state(PRESETS[name]), seconds);
  }

  /** Somewhere between two presets (e.g. the day passing as memories return). */
  between(a: WeatherName, b: WeatherName, k: number, seconds = 8) {
    this.name = k < 0.5 ? a : b;
    this.blendTo(lerpState(state(PRESETS[a]), state(PRESETS[b]), THREE.MathUtils.clamp(k, 0, 1)), seconds);
  }

  private blendTo(s: State, seconds: number) {
    this.from = this.now;
    this.to = s;
    this.t = 0;
    this.dur = Math.max(1e-3, seconds);
    if (seconds <= 0) { this.t = 1; this.now = s; this.apply(); this.g.skyEnv?.markDirty(true); }
  }

  private update(dt: number) {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      const k = this.t * this.t * (3 - 2 * this.t);
      this.now = lerpState(this.from, this.to, k);
      this.apply();
    }
    const w = this.now;
    // The wind carries the dust: beyond its usual stir, the motes stream downwind.
    uDustDrift.value.addScaledVector(WIND_DIR, Math.max(0, w.wind - 1) * 2.2 * dt);
    // Rain rings on the water around her.
    if (w.rain > 0.05) {
      this.rippleT -= dt;
      const p = this.g.player.position;
      while (this.rippleT <= 0) {
        this.rippleT += 0.05 / w.rain;
        const x = p.x + (Math.random() - 0.5) * 16, z = p.z + (Math.random() - 0.5) * 16;
        if (heightAt(x, z) < WATER_LEVEL) this.g.water.addRipple(x, z, 0.0005 + Math.random() * 0.0005);
      }
    }
  }

  private apply() {
    const { atmos, audio } = this.g;
    const w = this.now;
    const e = THREE.MathUtils.degToRad(w.elev);
    SUN_DIR.set(Math.sin(AZIMUTH) * Math.cos(e), Math.sin(e), Math.cos(AZIMUTH) * Math.cos(e));
    atmos.sun.color.copy(w.sun);
    atmos.sun.intensity = w.sunI * LIGHT.sun;
    // Cloud cover hides the disc and its specular sparkle, while diffuse sky light remains.
    uDirectSun.value = (w.sunI / PRESETS.day.sunI) * (1 - THREE.MathUtils.smoothstep(w.clouds, 0.5, 0.98));
    atmos.uSunCol.value.copy(w.sun);
    atmos.uHorizon.value.copy(w.horizon);
    atmos.uZenith.value.copy(w.zenith);
    atmos.hemi.intensity = w.hemi * LIGHT.fill;
    atmos.hemi.color.setHex(0xd5e0e8).lerp(w.sun, 0.12);
    atmos.uFogExtra.value = w.fog;
    atmos.uMistExtra.value = w.mist;
    atmos.uClouds.value = w.clouds;
    uDustLevel.value = w.dust;
    this.uRain.value = w.rain;
    this.rain.visible = w.rain > 0.01;
    this.g.skyEnv?.markDirty();
    audio.setWind(w.wind);
    audio.setRain(w.rain);
  }
}
