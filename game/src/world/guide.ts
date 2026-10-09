import * as THREE from 'three/webgpu';
import { uniform, uv, color, length, smoothstep, sin, time } from 'three/tsl';
import { heightAt } from './terrain';

export type GuideMode = 'subtle' | 'always' | 'off';

const TRAIL = 12;
const AHEAD = 3.4;      // how far ahead of her it drifts
const WAIT = 5.5;       // it waits if she falls further behind than this
const ARRIVE = 3.2;     // near the goal it hands over to the place itself
const STALE = 18;       // subtle: seconds without real progress before it shows

/**
 * A faint mote of warm light that shows the way: it drifts a few metres ahead of her toward
 * the current goal, weaving a little, waits when she falls behind, and trails a few fading
 * sparks. In "subtle" mode it only appears once she has stopped getting closer for a while,
 * and fades again when she is clearly on her way; "always" keeps it out whenever there is a
 * goal; "off" never shows it.
 */
export class Guide {
  /** Where the story wants her to go next, shown or not (the grove's trail sets it); the dev autoplay follows it. */
  waypoint: THREE.Vector3 | null = null;
  mode: GuideMode = 'subtle';
  private goal: THREE.Vector3 | null = null;
  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private placed = false;
  private opacity = 0;
  private best = Infinity;
  private stale = 0;
  private shownAt = Infinity;   // distance to the goal when it appeared
  private showing = false;
  private readonly uOpacity = uniform(0);
  private core: THREE.Sprite;
  private halo: THREE.Sprite;
  private trail: THREE.Sprite[] = [];
  private history: THREE.Vector3[] = [];
  private histT = 0;
  group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    const soft = (k: number) => { const r = smoothstep(0.5, 0.0, length(uv().sub(0.5))); return r.mul(r).mul(k); };
    const flicker = sin(time.mul(3.7)).mul(0.08).add(sin(time.mul(9.1)).mul(0.05)).add(0.9);
    const mk = (k: number, c = color(1.0, 0.82, 0.55)) => {
      const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      m.fog = false;
      m.colorNode = c.mul(soft(k)).mul(flicker).mul(this.uOpacity);
      return m;
    };
    this.core = new THREE.Sprite(mk(2.4));
    this.core.scale.setScalar(0.11);
    this.halo = new THREE.Sprite(mk(0.55, color(1.0, 0.68, 0.36)));
    this.halo.scale.setScalar(0.9);
    this.group.add(this.core, this.halo);
    const tm = mk(0.9);
    for (let i = 0; i < TRAIL; i++) {
      const s = new THREE.Sprite(tm.clone());
      (s.material as THREE.SpriteNodeMaterial).colorNode = color(1.0, 0.8, 0.5).mul(soft(0.9 * (1 - i / TRAIL))).mul(this.uOpacity);
      s.scale.setScalar(0.05 * (1 - i / TRAIL) + 0.015);
      this.trail.push(s);
      this.group.add(s);
      this.history.push(new THREE.Vector3());
    }
    this.group.visible = false;
    this.group.name = 'guide';
    this.group.renderOrder = 5;
    scene.add(this.group);
  }

  /** The goal the story set (null: none). */
  get target() { return this.goal; }

  /** Where she should go now (null: nowhere; it fades). */
  setGoal(goal: THREE.Vector3 | null) {
    const changed = (goal === null) !== (this.goal === null) || (goal && this.goal && goal.distanceToSquared(this.goal) > 0.25);
    this.goal = goal ? goal.clone() : null;
    if (changed) { this.best = Infinity; this.stale = 0; this.showing = false; this.shownAt = Infinity; }
  }

  update(dt: number, t: number, player: THREE.Vector3) {
    const goal = this.goal;
    let want = 0;
    if (goal && this.mode !== 'off') {
      const d = Math.hypot(goal.x - player.x, goal.z - player.z);
      if (d < this.best - 0.75) { this.best = d; this.stale = 0; } else { this.stale += dt; }
      if (this.mode === 'always') this.showing = d > ARRIVE;
      else {
        if (!this.showing && this.stale > STALE && d > ARRIVE) { this.showing = true; this.shownAt = d; }
        // Clearly on her way (or there): let it go.
        if (this.showing && (d < this.shownAt - 6 || d < ARRIVE)) { this.showing = false; this.stale = 0; this.best = d; }
      }
      want = this.showing ? 1 : 0;
    }
    this.opacity += (want - this.opacity) * (1 - Math.exp(-dt * (want ? 0.9 : 1.6)));
    this.uOpacity.value = this.opacity;
    this.group.visible = this.opacity > 0.01;
    if (!goal) return;

    // Drift ahead of her toward the goal; wait if she's far behind; weave a little.
    const dir = new THREE.Vector3(goal.x - player.x, 0, goal.z - player.z);
    const dist = dir.length();
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const ahead = Math.min(AHEAD, Math.max(0.5, dist - 0.8));
    const target = player.clone().addScaledVector(dir, ahead)
      .addScaledVector(side, Math.sin(t * 0.7) * 0.35);
    target.y = heightAt(target.x, target.z) + 1.0 + Math.sin(t * 1.3) * 0.12;
    if (!this.placed || this.opacity < 0.02) {
      // Appear just ahead of her, not somewhere across the map.
      this.pos.copy(target); this.vel.set(0, 0, 0); this.placed = true;
      for (const h of this.history) h.copy(target);
    }
    const behind = this.pos.distanceTo(player) > WAIT;
    const to = behind ? this.pos.clone().setY(target.y) : target;
    // Critically damped follow, capped speed: it glides, never snaps.
    const k = 3.2;
    const acc = to.clone().sub(this.pos).multiplyScalar(k * k).addScaledVector(this.vel, -2 * k);
    this.vel.addScaledVector(acc, dt);
    if (this.vel.length() > 2.6) this.vel.setLength(2.6);
    this.pos.addScaledVector(this.vel, dt);
    this.core.position.copy(this.pos);
    this.halo.position.copy(this.pos);
    // Waiting: it pulses a little.
    const pulse = behind ? 1 + 0.25 * Math.sin(t * 4) : 1;
    this.halo.scale.setScalar(0.9 * pulse);

    this.histT += dt;
    if (this.histT > 0.05) {
      this.histT = 0;
      this.history.pop();
      this.history.unshift(this.pos.clone());
    }
    this.trail.forEach((s, i) => s.position.copy(this.history[i]));
  }
}
