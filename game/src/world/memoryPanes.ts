import * as THREE from 'three/webgpu';
import {
  color, float, luminance, max, mix, mx_worley_noise_vec2, smoothstep, texture, uniform, uv, vec3, vec4, min,
} from 'three/tsl';
import type { Flakes } from './flakes';
import { LIFT, heightAt } from './terrain';

/**
 * Her memories as panes of glass: each afterimage she has found hangs in the air round the dead
 * lift, showing the frame she kept of it (the album), its edges pale crystal. They rise with the
 * lift's tower, so she passes them as she goes up. One not yet found is an empty pane. When she
 * spends one to power the lift, its pane cracks across, greys, and comes apart into flakes.
 */
export interface PaneState { id: string; found: boolean; spent: boolean; img?: string }

interface Pane { id: string; mesh: THREE.Mesh; crack: THREE.UniformNode<'float', number>; tex: THREE.Texture | null; base: THREE.Vector3; phase: number; breaking: number }

const W = 1.5, H = 0.84;

export class MemoryPanes {
  readonly group = new THREE.Group();
  private panes: Pane[] = [];
  private loader = new THREE.TextureLoader();
  private t = 0;
  private key = '';

  constructor(private flakes: Flakes) {
    this.group.name = 'memoryPanes';
    this.group.visible = false;
  }

  /** Build (or rebuild, when what she holds has changed) the panes for these memories. */
  set(states: PaneState[]) {
    const key = JSON.stringify(states.map((s) => [s.id, s.found, s.spent, !!s.img]));
    if (key === this.key) return;
    this.key = key;
    for (const p of this.panes) { this.group.remove(p.mesh); p.mesh.geometry.dispose(); (p.mesh.material as THREE.Material).dispose(); p.tex?.dispose(); }
    this.panes = [];
    const ground = heightAt(LIFT.x, LIFT.z);
    states.forEach((s, i) => {
      if (s.spent) return;
      // Up and round the tower, one turn over its height.
      const a = (i / states.length) * Math.PI * 2 + 0.4;
      const base = new THREE.Vector3(LIFT.x + Math.cos(a) * 4.2, ground + 2.4 + i * 1.5, LIFT.z + Math.sin(a) * 4.2);
      const tex = s.found && s.img ? this.loader.load(s.img) : null;
      if (tex) tex.colorSpace = THREE.SRGBColorSpace;
      const crack = uniform(0) as THREE.UniformNode<'float', number>;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), paneMaterial(tex, s.found, crack));
      mesh.position.copy(base);
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.panes.push({ id: s.id, mesh, crack, tex, base, phase: i * 1.7, breaking: 0 });
    });
  }

  /** The memory `id` is spent: its pane cracks, then comes apart. */
  spend(id: string) {
    const p = this.panes.find((q) => q.id === id);
    if (p) p.breaking = 0.0001;
  }

  update(dt: number, cam: THREE.Camera) {
    if (!this.group.visible) return;
    this.t += dt;
    const c = cam.getWorldPosition(new THREE.Vector3());
    for (const p of [...this.panes]) {
      // A slow drift, and turning (slowly) to face whoever looks.
      p.mesh.position.copy(p.base).add(new THREE.Vector3(0, Math.sin(this.t * 0.4 + p.phase) * 0.12, 0));
      const want = Math.atan2(c.x - p.mesh.position.x, c.z - p.mesh.position.z);
      let d = want - p.mesh.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      p.mesh.rotation.y += d * (1 - Math.exp(-dt * 0.8));
      p.mesh.rotation.z = Math.sin(this.t * 0.3 + p.phase) * 0.04;
      if (p.breaking > 0) {
        p.breaking += dt;
        p.crack.value = Math.min(1, p.breaking / 1.4);
        if (p.breaking > 1.6) {
          this.flakes.burst(p.mesh.position, 0.6, 60, 0.05, 0.5);
          this.group.remove(p.mesh);
          this.panes.splice(this.panes.indexOf(p), 1);
        }
      }
    }
  }
}

function paneMaterial(tex: THREE.Texture | null, found: boolean, crack: THREE.UniformNode<'float', number>) {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const u = uv();
  // Ragged crystal edges: Worley cells along the border, the pane's corners chipped.
  const edgeD = min(min(u.x, float(1).sub(u.x)).mul(W / H), min(u.y, float(1).sub(u.y)));
  const cells = mx_worley_noise_vec2(u.mul(vec3(14.0, 8.0, 0).xy));
  const rim = smoothstep(0.06, 0.0, edgeD.sub(cells.x.mul(0.05)));
  const inside = smoothstep(0.0, 0.02, edgeD.sub(cells.x.mul(0.05)).add(0.01));
  // The crack: cell edges across the whole pane, appearing as it goes.
  const big = mx_worley_noise_vec2(u.mul(vec3(5.0, 3.0, 0).xy));
  const crackLine = smoothstep(0.05, 0.0, big.y.sub(big.x)).mul(smoothstep(0.0, 0.4, crack.mul(1.6).sub(big.x)));
  const img = tex ? vec3(texture(tex, u).rgb) : vec3(0.82, 0.8, 0.76);
  const grey = vec3(luminance(img));
  // A kept frame glows a little (it's already graded, and the dusk would sink it to mud).
  const pic = mix(img, grey, crack.mul(0.85)).mul(tex ? 2.6 : 1.1);
  const glass = vec3(0.92, 0.96, 1.0);
  mat.colorNode = vec4(mix(pic, glass, max(rim.mul(0.8), crackLine)), 1).rgb.add(color(0x4fd8ff).mul(crackLine.mul(crack).mul(0.6)));
  mat.opacityNode = max(rim.mul(0.85), inside.mul(found ? 0.88 : 0.1)).mul(float(1).sub(crack.mul(crack).mul(0.3)));
  return mat;
}
