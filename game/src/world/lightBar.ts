import * as THREE from 'three/webgpu';
import { uniform, color, float, normalView, positionViewDirection, dot, abs, pow, sin, time, uv } from 'three/tsl';

/**
 * A bar made of light: the memory of a heavy edge coming down across her forearms (the
 * fallen giant's afterimage). A rim-lit tube, brighter at its silhouette, flickering faintly.
 */
export class LightBar {
  mesh: THREE.Mesh;
  readonly uOpacity = uniform(0);

  constructor(scene: THREE.Scene, length = 1.4) {
    const geo = new THREE.CylinderGeometry(0.03, 0.03, length, 20, 1, false);
    geo.rotateZ(Math.PI / 2);   // along local X
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.fog = false;
    const rim = pow(float(1).sub(abs(dot(normalView, positionViewDirection))), 1.6);
    // Fades toward both ends so it has no hard caps.
    const ends = sin(uv().y.mul(Math.PI)).max(0);
    const flicker = sin(time.mul(3.1)).mul(0.07).add(sin(time.mul(7.3)).mul(0.04)).add(0.9);
    mat.colorNode = color(1.0, 0.8, 0.52).mul(rim.mul(2.6).add(0.25)).mul(ends).mul(flicker).mul(this.uOpacity);
    mat.opacityNode = float(1);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    this.mesh.name = 'lightBar';
    scene.add(this.mesh);
  }

  /** Lay it between two points (e.g. just above both wrists). */
  span(a: THREE.Vector3, b: THREE.Vector3) {
    this.mesh.position.copy(a).lerp(b, 0.5);
    const dir = b.clone().sub(a).normalize();
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    this.mesh.updateMatrixWorld();
  }

  set opacity(v: number) {
    this.uOpacity.value = v;
    this.mesh.visible = v > 0.001;
  }
}
