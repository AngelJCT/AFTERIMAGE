import * as THREE from 'three/webgpu';
import { texture, uniform, uv, color, float, sin, time, length, smoothstep } from 'three/tsl';
import { heightAt } from './terrain';

/**
 * A warm glow lying in the dust (the thicket's afterimage): a soft, small, curled shape of
 * light on the ground, with a few motes drifting up out of it. Faceless and wordless.
 */
export class DustGlow {
  group = new THREE.Group();
  readonly uOpacity = uniform(0);
  private motes: THREE.Sprite[] = [];
  private base = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d')!;
    // Curled: a longer body with a rounder head end, all soft (radial falloffs, no edges).
    const blob = (x: number, y: number, rx: number, ry: number, a: number) => {
      g.save();
      g.translate(x, y); g.scale(rx / ry, 1);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, ry);
      grad.addColorStop(0, `rgba(255,255,255,${a})`);
      grad.addColorStop(0.55, `rgba(255,255,255,${a * 0.45})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(0, 0, ry, 0, Math.PI * 2); g.fill();
      g.restore();
    };
    g.globalCompositeOperation = 'lighter';
    blob(118, 66, 92, 40, 0.8);
    blob(198, 58, 38, 34, 0.7);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.NoColorSpace;
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.fog = false;
    const breath = sin(time.mul(1.9)).mul(0.12).add(0.88);
    const a = texture(tex, uv()).a;   // the gradients vary alpha, colour stays white
    mat.colorNode = color(1.0, 0.7, 0.36).mul(a.mul(a).mul(0.9)).mul(breath).mul(this.uOpacity);
    mat.opacityNode = float(1);
    const geo = new THREE.PlaneGeometry(0.95, 0.48);
    geo.rotateX(-Math.PI / 2);
    const glow = new THREE.Mesh(geo, mat);
    glow.renderOrder = 4;
    this.group.add(glow);
    const mm = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mm.fog = false;
    // Round, soft motes.
    const r = smoothstep(0.5, 0.0, length(uv().sub(0.5)));
    mm.colorNode = color(1.0, 0.8, 0.5).mul(r.mul(r)).mul(this.uOpacity).mul(1.2);
    for (let i = 0; i < 18; i++) {
      const sp = new THREE.Sprite(mm);
      sp.scale.setScalar(0.012 + Math.random() * 0.01);
      sp.userData = { x: (Math.random() - 0.5) * 0.8, z: (Math.random() - 0.5) * 0.35, ph: Math.random() * 6, sp: 0.05 + Math.random() * 0.08 };
      this.motes.push(sp);
      this.group.add(sp);
    }
    this.group.visible = false;
    this.group.name = 'dustGlow';
    scene.add(this.group);
  }

  /** Lay it on the ground at `p`, its length along `yaw`. */
  place(p: THREE.Vector3, yaw: number) {
    this.base.set(p.x, heightAt(p.x, p.z) + 0.07, p.z);
    this.group.position.copy(this.base);
    this.group.rotation.set(0, yaw, 0);
  }

  update(t: number) {
    for (const m of this.motes) {
      const d = m.userData;
      const h = ((t * d.sp + d.ph) % 1);
      m.position.set(d.x + Math.sin(t * 0.7 + d.ph) * 0.03, 0.03 + h * 0.5, d.z);
    }
  }

  set opacity(v: number) {
    this.uOpacity.value = v;
    this.group.visible = v > 0.001;
  }
}
