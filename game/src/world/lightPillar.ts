import * as THREE from 'three/webgpu';
import {
  color, exp, float, fract, instancedArray, length, mx_fractal_noise_float, positionLocal, sin, smoothstep, time, uniform, uv,
  vec3, vec4,
} from 'three/tsl';
import { heightAt } from './terrain';
import type { GuideMode } from './guide';

const HEIGHT = 150;
const NEAR = 7;          // closer than this, the place itself takes over
const LOST = 22;         // seconds without getting closer before it brightens
const BASE = 0.14;       // its level until then, in the guide's "subtle" mode (a whisper: the core goes as level^1.5)

/**
 * A pillar of pale light falling from the sky onto where the story wants her next (after the
 * world references f9ff553b_2, 0d910b36_0): a way shown without any marker. One at a time.
 * Faint while she's finding her own way, brighter once she has stopped getting closer for a
 * while, gone as she nears it (and in cutscenes). Cool, like the ring and her memories, against
 * the warm present.
 *
 * Drawn as a tall card turned to face the camera round its own axis, a glow on the ground where
 * it lands, and motes drifting down through it.
 */
export class LightPillar {
  readonly group = new THREE.Group();
  private readonly uLevel = uniform(0);
  private beam: THREE.Mesh;
  private pool: THREE.Mesh;
  private at: THREE.Vector3 | null = null;
  private next: THREE.Vector3 | null = null;
  private level = 0;
  private best = Infinity;
  private stale = 0;

  constructor(scene: THREE.Scene) {
    const tint = vec3(0.8, 0.93, 1.0);
    const L = this.uLevel;

    // The beam: a bright core and a wide soft halo, a faint shimmer falling down it, fading
    // into the haze above and brightest where it lands.
    {
      const g = new THREE.PlaneGeometry(1, HEIGHT, 1, 1);
      g.translate(0, HEIGHT / 2, 0);
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      m.fog = false;
      const across = uv().x.sub(0.5).mul(2);   // -1..1 over 7 m
      const h = positionLocal.y;
      const core = exp(across.mul(across).mul(-260));
      const halo = exp(across.mul(across).mul(-14)).mul(0.22);
      const fall = mx_fractal_noise_float(vec3(across.mul(5), h.mul(0.05).add(time.mul(0.35)), float(2.3)), 2, 2, 0.5);
      const shimmer = smoothstep(-0.6, 0.6, fall).mul(0.6).add(0.7);
      const top = smoothstep(HEIGHT, HEIGHT * 0.25, h);
      const foot = exp(h.mul(-0.35)).mul(1.4).add(1);
      m.colorNode = tint.mul(core.mul(2.4).mul(L.sqrt()).add(halo)).mul(shimmer).mul(top).mul(foot).mul(L);
      this.beam = new THREE.Mesh(g, m);
      this.beam.scale.x = 7;
      this.beam.frustumCulled = false;
      this.beam.renderOrder = 3;
      this.group.add(this.beam);
    }

    // Where it lands: a soft glow on the ground, laid over the terrain.
    {
      const g = new THREE.PlaneGeometry(9, 9, 14, 14);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      m.fog = false;
      m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
      const r = length(uv().sub(0.5)).mul(2);
      m.colorNode = tint.mul(exp(r.mul(r).mul(-9)).mul(0.55).add(exp(r.mul(r).mul(-60)).mul(0.6))).mul(L);
      this.pool = new THREE.Mesh(g, m);
      this.pool.frustumCulled = false;
      this.pool.renderOrder = 3;
      this.group.add(this.pool);
    }

    // Motes drifting down through it, over the last 30 m.
    {
      const n = 70;
      const data = new Float32Array(n * 4);
      for (let i = 0; i < n * 4; i++) data[i] = Math.random();
      const sd = instancedArray(data, 'vec4').toAttribute();
      const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      m.fog = false;
      const y = fract(sd.y.sub(time.mul(sd.z.mul(0.02).add(0.012)))).mul(30);
      const r = sd.x.mul(sd.x).mul(1.6);
      const a = sd.w.mul(6.283).add(time.mul(0.15));
      m.positionNode = vec3(a.cos().mul(r), y, a.sin().mul(r));
      m.scaleNode = sd.z.mul(0.05).add(0.025);
      const q = length(uv().sub(0.5)).mul(2);
      const tw = sin(time.mul(3).add(sd.w.mul(50))).mul(0.35).add(0.65);
      m.colorNode = vec4(color(0.9, 0.97, 1.0).mul(smoothstep(1, 0, q)).mul(tw).mul(L).mul(1.4), 1);
      const s = new THREE.Sprite(m);
      s.count = n;
      s.frustumCulled = false;
      this.group.add(s);
    }

    this.group.name = 'lightPillar';
    this.group.visible = false;
    scene.add(this.group);
  }

  /**
   * Each frame: `goal` is where the story wants her (or null), `free` whether she's in play
   * (not a cutscene). Moving to a new goal, it fades out first and comes down again there.
   */
  update(dt: number, camera: THREE.Camera, player: THREE.Vector3, goal: THREE.Vector3 | null, mode: GuideMode, free: boolean) {
    if (goal && (!this.next || goal.distanceToSquared(this.next) > 4)) {
      this.next = goal.clone();
      this.best = Infinity; this.stale = 0;
    } else if (!goal) this.next = null;
    // Swap to the new place once it has faded out.
    if (this.next !== this.at && (!this.next || !this.at || this.next.distanceToSquared(this.at) > 4) && this.level < 0.01) {
      this.at = this.next;
      if (this.at) this.place(this.at);
    } else if (this.next && this.at && this.next !== this.at && this.next.distanceToSquared(this.at) <= 4) this.at = this.next;

    let want = 0;
    if (this.at && this.at === this.next && free && mode !== 'off') {
      const d = Math.hypot(this.at.x - player.x, this.at.z - player.z);
      if (d < this.best - 0.75) { this.best = d; this.stale = 0; } else this.stale += dt;
      const lost = mode === 'always' ? 1 : THREE.MathUtils.smoothstep(this.stale, LOST, LOST + 6);
      want = (BASE + (1 - BASE) * lost) * THREE.MathUtils.smoothstep(d, NEAR, NEAR + 9);
    }
    this.level += (want - this.level) * (1 - Math.exp(-dt * (want > this.level ? 0.5 : 1.2)));
    this.uLevel.value = this.level;
    this.group.visible = this.level > 0.003 && !!this.at;
    if (!this.group.visible || !this.at) return;
    // Turn the beam to the camera round its upright axis.
    const c = camera.getWorldPosition(new THREE.Vector3());
    this.beam.rotation.y = Math.atan2(c.x - this.at.x, c.z - this.at.z);
  }

  /** How bright it is now (0..1), for tests. */
  get shown() { return this.level; }

  private place(p: THREE.Vector3) {
    const y = heightAt(p.x, p.z);
    this.group.position.set(p.x, y, p.z);
    // Lay the ground glow over the terrain.
    const pos = this.pool.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightAt(p.x + pos.getX(i), p.z + pos.getZ(i)) - y + 0.04);
    }
    pos.needsUpdate = true;
  }
}
