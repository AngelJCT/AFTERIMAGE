import * as THREE from 'three/webgpu';
import { uniform, color, float, uv, exp, sin, time } from 'three/tsl';

/**
 * Light inside a conduit: an additive cyan sleeve along a path (the ruins' arch). A pulse
 * travels along it (`uHead`, 0..1), over a faint overall level (`uLevel`), with a
 * whole-length flash (`uFlash`) for the surge.
 */
export class ConduitGlow {
  mesh: THREE.Mesh;
  readonly uHead = uniform(-1);
  readonly uLevel = uniform(0);
  readonly uFlash = uniform(0);

  constructor(scene: THREE.Scene, points: THREE.Vector3[], radius = 0.2) {
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 96, radius, 12, false);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.fog = false;
    const d = uv().x.sub(this.uHead);
    const pulse = exp(d.mul(d).mul(-260)).mul(2.4);
    const shimmer = sin(uv().x.mul(80).sub(time.mul(9))).mul(0.15).add(0.85);
    mat.colorNode = color(0.25, 0.83, 1.0).mul(pulse.add(this.uLevel.mul(0.35)).add(this.uFlash.mul(1.8)).mul(shimmer));
    mat.opacityNode = float(1);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    this.mesh.name = 'conduitGlow';
    scene.add(this.mesh);
  }

  set on(v: boolean) {
    this.mesh.visible = v;
  }
}
