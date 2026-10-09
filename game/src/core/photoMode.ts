import * as THREE from 'three/webgpu';
import type { Game } from '../main';
import { lensToFov } from './lens';
import { heightAt } from '../world/terrain';

/**
 * Photo mode (C, or from the pause menu): the moment holds (story time stops), and a free
 * camera drifts within a few metres of her.
 *
 * - Move: WASD or the stick; R / F rise and sink; Shift is faster. Look: drag. Wheel: lens.
 * - Panel: lens, focus (on her, or a set distance), aperture, exposure, roll, grain,
 *   vignette, a look (film, warm, cold, silver), and toggles for her, the bars and the panel
 *   itself (H). "save" writes a full-size JPEG.
 * - C or Esc leaves, and everything is as it was.
 */
const LOOKS: Record<string, { sat: number; tint: [number, number, number]; warm: number }> = {
  film: { sat: 1, tint: [1, 1, 1], warm: 0 },
  warm: { sat: 1.05, tint: [1.06, 1.0, 0.88], warm: 0.6 },
  cold: { sat: 0.85, tint: [0.9, 0.98, 1.08], warm: 0 },
  silver: { sat: 0, tint: [1.02, 1.0, 0.97], warm: 0 },
};

const RANGE = 7;   // how far from her the camera may go (m)

export class PhotoMode {
  active = false;
  private el: HTMLElement;
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private pos = new THREE.Vector3();
  private lens = 35;
  private focusOnHer = true;
  private focus = 3;
  private aperture = 7;
  private exposure = 0;
  private look = 'film';
  private hidden = false;
  private saved: Record<string, unknown> | null = null;
  private keys = new Set<string>();

  constructor(private g: Game) {
    this.el = document.getElementById('photo')!;
    addEventListener('keydown', (e) => {
      if (!document.body.classList.contains('playing')) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') { if (e.code === 'Escape') (e.target as HTMLElement).blur(); return; }
      if (e.code === 'KeyC' && !e.repeat && document.getElementById('menu')!.hidden) this.toggle();
      else if (this.active && (e.code === 'Escape')) { e.stopImmediatePropagation(); this.exit(); }
      else if (this.active && e.code === 'KeyH') this.setHidden(!this.hidden);
      if (this.active) this.keys.add(e.code);
    }, true);
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('wheel', (e) => {
      if (!this.active) return;
      this.lens = THREE.MathUtils.clamp(this.lens * Math.exp(e.deltaY * 0.001), 16, 135);
      this.sync();
    }, { passive: true });
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const v = Number(t.value);
      switch (t.name) {
        case 'lens': this.lens = v; break;
        case 'focus': this.focus = v; this.focusOnHer = false; break;
        case 'aperture': this.aperture = v; break;
        case 'exposure': this.exposure = v; break;
        case 'roll': this.roll = THREE.MathUtils.degToRad(v); break;
        case 'grain': this.g.post.uGrain.value = v; break;
        case 'vignette': this.g.post.uVignette.value = v; break;
      }
      this.sync();
    });
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.look) { this.look = b.dataset.look; this.sync(); }
      switch (b.dataset.photo) {
        case 'her': this.g.player.root.visible = !this.g.player.root.visible; this.sync(); break;
        case 'bars': document.body.classList.toggle('photo-bars'); this.sync(); break;
        case 'focus-her': this.focusOnHer = true; this.sync(); break;
        case 'hide': this.setHidden(true); break;
        case 'save': void this.save(); break;
        case 'exit': this.exit(); break;
      }
    });
  }

  toggle() { if (this.active) this.exit(); else this.enter(); }

  enter() {
    const { g } = this;
    if (this.active || g.paused) return;
    const cam = g.cam.camera, post = g.post;
    this.saved = {
      grain: post.uGrain.value, vignette: post.uVignette.value, warm: post.uWarm.value,
      exposure: g.renderer.toneMappingExposure, fov: cam.fov,
    };
    this.active = true;
    g.photo = true;
    this.pos.copy(cam.position);
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    this.yaw = e.y; this.pitch = e.x; this.roll = 0;
    this.lens = THREE.MathUtils.clamp(g.cam.lensNow, 16, 135);
    this.focusOnHer = true;
    this.aperture = THREE.MathUtils.clamp(post.uBokeh.value, 0, 14);
    this.exposure = 0;
    this.look = 'film';
    document.body.classList.add('photo');
    this.el.hidden = false;
    this.setHidden(false);
    (this.el.querySelector('[name=grain]') as HTMLInputElement).value = String(post.uGrain.value);
    (this.el.querySelector('[name=vignette]') as HTMLInputElement).value = String(post.uVignette.value);
    this.sync();
  }

  exit() {
    const { g } = this;
    if (!this.active) return;
    const s = this.saved!;
    g.post.uGrain.value = s.grain as number;
    g.post.uVignette.value = s.vignette as number;
    g.post.uWarm.value = s.warm as number;
    g.renderer.toneMappingExposure = s.exposure as number;
    g.post.uSat.value = 1;
    g.post.uTint.value.setRGB(1, 1, 1);
    g.player.root.visible = true;
    g.cam.camera.fov = s.fov as number;
    g.cam.camera.updateProjectionMatrix();
    document.body.classList.remove('photo', 'photo-bars', 'photo-clean');
    this.el.hidden = true;
    this.active = false;
    g.photo = false;
    this.keys.clear();
  }

  private setHidden(v: boolean) {
    this.hidden = v;
    document.body.classList.toggle('photo-clean', v);
  }

  /** Panel values and the look, from the state. */
  private sync() {
    const { g } = this;
    const set = (name: string, v: number) => { const i = this.el.querySelector(`[name=${name}]`) as HTMLInputElement; if (i && document.activeElement !== i) i.value = String(v); };
    set('lens', Math.round(this.lens));
    set('focus', +this.focus.toFixed(1));
    set('aperture', this.aperture);
    set('exposure', this.exposure);
    set('roll', Math.round(THREE.MathUtils.radToDeg(this.roll)));
    const out = (name: string, text: string) => { const o = this.el.querySelector(`output[for=${name}]`); if (o) o.textContent = text; };
    out('lens', `${Math.round(this.lens)} mm`);
    out('focus', this.focusOnHer ? 'on her' : `${this.focus.toFixed(1)} m`);
    out('aperture', this.aperture < 0.5 ? 'deep' : `${this.aperture.toFixed(1)}`);
    out('exposure', `${this.exposure > 0 ? '+' : ''}${this.exposure.toFixed(1)}`);
    out('roll', `${Math.round(THREE.MathUtils.radToDeg(this.roll))}°`);
    out('grain', g.post.uGrain.value.toFixed(3));
    out('vignette', g.post.uVignette.value.toFixed(2));
    const L = LOOKS[this.look];
    g.post.uSat.value = L.sat;
    g.post.uTint.value.setRGB(...L.tint);
    g.post.uWarm.value = Math.max(this.saved?.warm as number ?? 0, L.warm);
    g.renderer.toneMappingExposure = (this.saved?.exposure as number ?? 0.8) * Math.pow(2, this.exposure);
    this.el.querySelectorAll<HTMLButtonElement>('[data-look]').forEach((b) => b.classList.toggle('on', b.dataset.look === this.look));
    this.el.querySelector('[data-photo=her]')!.classList.toggle('on', g.player.root.visible);
    this.el.querySelector('[data-photo=bars]')!.classList.toggle('on', document.body.classList.contains('photo-bars'));
    this.el.querySelector('[data-photo=focus-her]')!.classList.toggle('on', this.focusOnHer);
  }

  /** Per frame while active (the story is held): fly the camera, set the lens and focus. */
  update(dt: number) {
    const { g } = this;
    const input = g.input, cam = g.cam.camera, k = this.keys;
    this.yaw -= input.look.x * 0.0035;
    this.pitch = THREE.MathUtils.clamp(this.pitch - input.look.y * 0.0035, -1.45, 1.45);
    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1.1) * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.pos.addScaledVector(fwd, input.move.y * speed).addScaledVector(right, input.move.x * speed);
    this.pos.y += ((k.has('KeyR') ? 1 : 0) - (k.has('KeyF') ? 1 : 0)) * speed;
    // Stay near her and above the ground.
    const her = g.player.position.clone().setY(g.player.position.y + 1.2);
    const off = this.pos.clone().sub(her);
    if (off.length() > RANGE) this.pos.copy(her).addScaledVector(off.normalize(), RANGE);
    this.pos.y = Math.max(this.pos.y, heightAt(this.pos.x, this.pos.z) + 0.08);

    cam.position.copy(this.pos);
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));
    cam.fov = lensToFov(this.lens, cam.aspect);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    const focusDist = this.focusOnHer ? cam.position.distanceTo(her) : this.focus;
    g.post.uFocus.value = focusDist;
    g.post.uFocusRange.value = THREE.MathUtils.clamp(focusDist * 0.35, 0.25, 6);
    g.post.uBokeh.value = g.q.dof ? this.aperture : 0;
    if (this.focusOnHer) { this.focus = focusDist; const o = this.el.querySelector('output[for=focus]'); if (o) o.textContent = 'on her'; }
  }

  /** The frame at full size, as a JPEG download. */
  private async save() {
    const src = this.g.renderer.domElement;
    const url = await this.g.captureFrame(Math.min(3840, src.width));
    if (!url) return;
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url; a.download = `afterimage-${stamp}.jpg`;
    a.click();
    this.el.classList.add('saved');
    setTimeout(() => this.el.classList.remove('saved'), 1200);
  }
}
