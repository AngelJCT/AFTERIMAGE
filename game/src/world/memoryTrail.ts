import * as THREE from 'three/webgpu';
import { texture, uniform, uv, color, smoothstep } from 'three/tsl';
import { heightAt, WATER_LEVEL } from './terrain';

const PRINTS = 16;
const STRIDE = 0.34;       // a child's step (m)
const PACE = 1.05;         // m/s: small, quick steps
const AHEAD = 11;          // how far the walk goes before it starts again from near her
const LIFE = 3.4;          // seconds a print stays

/** A small boot print, heel and sole, soft edged. White on black (R). */
function drawPrint() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
  g.filter = 'blur(3px)';
  g.fillStyle = '#fff';
  g.beginPath(); g.ellipse(32, 44, 18, 30, 0, 0, Math.PI * 2); g.fill();     // sole
  g.beginPath(); g.ellipse(32, 100, 14, 16, 0, 0, Math.PI * 2); g.fill();    // heel
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

const numU = () => uniform(0);
interface Print { mesh: THREE.Mesh; o: ReturnType<typeof numU>; age: number }

/**
 * The way on, as the grove remembers it: small warm footprints appear one after another ahead
 * of her, someone small walking on in front, and fade behind. Nobody is seen; only where the
 * feet were. It shows fully with her eyes closed (the afterimage behind the lids), faintly or
 * not at all with them open (the guide setting).
 */
export class MemoryTrail {
  /** 0..1, set every frame by the story. */
  intensity = 0;
  /** Called for each new print (a small wet step for the ear). */
  onStep?: (p: THREE.Vector3, level: number) => void;
  private path: THREE.Vector3[] = [];
  private prints: Print[] = [];
  private next = 0;
  private walked = 0;       // metres along the path
  private stepT = 0;
  private side = 1;
  private pause = 0;

  constructor(scene: THREE.Scene) {
    const tex = drawPrint();
    const geo = new THREE.PlaneGeometry(0.1, 0.2);   // a little larger than life: it has to read from behind her
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < PRINTS; i++) {
      const o = numU();
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      m.fog = false;
      const edge = smoothstep(0.0, 0.08, uv().x).mul(smoothstep(1.0, 0.92, uv().x));
      m.colorNode = color(1.0, 0.64, 0.32).mul(texture(tex, uv()).r).mul(edge).mul(o).mul(1.25);
      m.polygonOffset = true; m.polygonOffsetFactor = -2;
      const mesh = new THREE.Mesh(geo, m);
      mesh.visible = false;
      mesh.renderOrder = 3;
      mesh.name = 'memoryPrint';
      scene.add(mesh);
      this.prints.push({ mesh, o, age: 99 });
    }
  }

  /** Where the steps go: from near her toward (and through) these points. */
  setPath(points: THREE.Vector3[]) {
    this.path = points.map((p) => p.clone().setY(0));
    this.walked = 0;
    this.pause = 0.6;
  }

  /** Point `d` metres along the polyline; returns the metres left after it (< 0 past the end). */
  private static along(route: THREE.Vector3[], d: number, out: THREE.Vector3, dir: THREE.Vector3) {
    let left = d;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i], b = route[i + 1];
      const len = a.distanceTo(b);
      if (len < 1e-4) continue;
      dir.subVectors(b, a).normalize();
      if (left <= len) {
        out.copy(a).addScaledVector(dir, left);
        let rest = len - left;
        for (let j = i + 1; j < route.length - 1; j++) rest += route[j].distanceTo(route[j + 1]);
        return rest;
      }
      left -= len;
    }
    return -1;
  }

  update(dt: number, from: THREE.Vector3) {
    // Fade what's there.
    for (const p of this.prints) {
      p.age += dt;
      const k = p.age < 0.18 ? p.age / 0.18 : Math.max(0, 1 - (p.age - 0.18) / LIFE);
      p.o.value = k * k * this.intensity;
      p.mesh.visible = p.o.value > 0.004;
    }
    if (!this.path.length || this.intensity < 0.02) { this.walked = 0; return; }
    if (this.pause > 0) { this.pause -= dt; return; }
    this.stepT += dt;
    if (this.stepT < STRIDE / PACE) return;
    this.stepT = 0;
    this.walked += STRIDE;
    // The walk begins a metre and a half ahead of her and goes on toward the points.
    const route = [from.clone().setY(0), ...this.path];
    const pos = new THREE.Vector3(), dir = new THREE.Vector3();
    const rest = MemoryTrail.along(route, 1.0 + this.walked, pos, dir);
    if (rest < 0.3 || this.walked > AHEAD) { this.walked = 0; this.pause = 1.6; return; }
    const sideV = new THREE.Vector3(-dir.z, 0, dir.x);
    this.side = -this.side;
    pos.addScaledVector(sideV, 0.055 * this.side);
    pos.y = Math.max(heightAt(pos.x, pos.z), WATER_LEVEL) + 0.006;
    const p = this.prints[this.next];
    this.next = (this.next + 1) % PRINTS;
    p.mesh.position.copy(pos);
    p.mesh.rotation.set(0, Math.atan2(dir.x, dir.z) + Math.PI, 0);
    p.age = 0;
    this.onStep?.(pos, this.intensity);
  }
}
