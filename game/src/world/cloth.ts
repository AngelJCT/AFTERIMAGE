import * as THREE from 'three/webgpu';
import {
  uniform, uv, color, float, mix, sin, time, smoothstep, positionLocal, vec3, mx_fractal_noise_float, step,
} from 'three/tsl';
import { PALETTE } from '../core/palette';

const W = 0.038, L = 0.2;

/**
 * The aged ochre strip torn from the child's sleeve (Part II). It hangs from a point (the
 * LEFT jamb bolt, later her closed hand), swaying in the draft; the last few centimetres are
 * frayed threads. Faded and dirty: the strip has hung there a long time.
 */
export class OchreCloth {
  mesh: THREE.Mesh;
  /** Sway strength (1 = a light draft; more while carried or when it comes free). */
  readonly uFlutter = uniform(1);

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(W, L, 2, 16);
    geo.translate(0, -L / 2, 0);                // top edge at the pin
    const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
    const v = positionLocal.y.negate().div(L);  // 0 at the pin .. 1 at the frayed end
    const t = time;
    const f = this.uFlutter;
    const w = v.mul(v);
    const sway = vec3(
      sin(t.mul(1.7).add(v.mul(4))).mul(0.012).add(sin(t.mul(3.1).add(v.mul(7))).mul(0.004)),
      float(0),
      sin(t.mul(1.3).add(v.mul(3))).mul(0.018).add(sin(t.mul(4.3).add(v.mul(9))).mul(0.003)),
    ).mul(w).mul(f);
    // The top wraps a little round the pin; the strip is crumpled, twisting along its length
    // and narrower where it tore.
    const wrap = vec3(0, 0, smoothstep(0.12, 0.0, v).mul(-0.012));
    const crumple = vec3(
      positionLocal.x.mul(float(-0.35).mul(v)),
      float(0),
      positionLocal.x.mul(sin(v.mul(9).add(1.3)).mul(0.9)).add(sin(v.mul(23)).mul(0.004)),
    );
    mat.positionNode = positionLocal.add(sway).add(wrap).add(crumple);
    // Faded ochre, darker and dirtier toward the end, with a woven grain.
    const n = mx_fractal_noise_float(vec3(uv().x.mul(6), uv().y.mul(22), 0), 3, 2, 0.5);
    const weave = sin(uv().x.mul(180)).mul(sin(uv().y.mul(900))).mul(0.06).add(1);
    // Years on the bolt: faded, stained, darker where it's wet.
    const base = mix(color(PALETTE.ochre).mul(0.34), color(PALETTE.sediment).mul(0.5), v.mul(0.4).add(n.mul(0.35)).clamp(0, 1));
    mat.colorNode = base.mul(weave);
    mat.roughnessNode = float(0.96);
    // Fray: threads along the last quarter, uneven hem.
    const hem = float(0.78).add(mx_fractal_noise_float(vec3(uv().x.mul(9), 0, 3), 2, 2, 0.5).mul(0.08));
    const threads = sin(uv().x.mul(95)).mul(0.5).add(0.5);
    const cut = uv().y.oneMinus();               // 0 at the pin .. 1 at the end (uv.y is 1 at top)
    const keep = step(cut, hem).max(step(cut, float(1).sub(threads.mul(0.2))).mul(step(0.55, threads)));
    mat.opacityNode = keep;
    mat.alphaTest = 0.5;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'ochreCloth';
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Hang it from `p`, its face turned toward `yaw` (0 = +Z). */
  hangFrom(p: THREE.Vector3, yaw: number, tilt = 0) {
    this.mesh.position.copy(p);
    this.mesh.rotation.set(tilt, yaw, 0, 'YXZ');
  }

  /**
   * Stream it from `p` toward `dir` (world, horizontal), as if a wind blew that way: `k` 0
   * hangs straight down, 1 flies nearly level, flat face upright like a pennant, fluttering.
   */
  stream(p: THREE.Vector3, dir: THREE.Vector3, k: number) {
    const h = dir.clone().setY(0).normalize();
    const down = new THREE.Vector3(0, -1, 0);
    const along = down.clone().lerp(h, Math.min(0.95, k)).normalize();   // where the free end points
    const y = along.clone().negate();                                      // local +Y runs back to the pin
    const perp = new THREE.Vector3(-h.z, 0, h.x);
    const upish = new THREE.Vector3(0, 1, 0).addScaledVector(along, -along.y).normalize();
    const x = perp.lerp(upish, k).addScaledVector(y, -perp.dot(y)).normalize();
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    this.mesh.position.copy(p);
    this.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    this.uFlutter.value += (1 + k * 3.5 - this.uFlutter.value) * 0.1;
  }
}
