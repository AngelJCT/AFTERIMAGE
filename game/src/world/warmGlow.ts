import * as THREE from 'three/webgpu';
import { uniform, uv, color, length, smoothstep, sin, time } from 'three/tsl';

/**
 * A soft, faint warmth in the air (the mirror pool's afterimage): an ochre glow that shows
 * behind her shoulder in the reflection, as if someone stood there. No shape, no face.
 */
export class WarmGlow {
  sprite: THREE.Sprite;
  readonly uOpacity = uniform(0);

  constructor(scene: THREE.Scene, size = 0.8) {
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.fog = false;
    const r = smoothstep(0.5, 0.0, length(uv().sub(0.5)));
    const breath = sin(time.mul(1.4)).mul(0.1).add(0.9);
    mat.colorNode = color(0.95, 0.62, 0.3).mul(r.mul(r).mul(1.3)).mul(breath).mul(this.uOpacity);
    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.setScalar(size);
    this.sprite.renderOrder = 4;
    this.sprite.visible = false;
    this.sprite.name = 'warmGlow';
    scene.add(this.sprite);
  }

  set opacity(v: number) {
    this.uOpacity.value = v;
    this.sprite.visible = v > 0.001;
  }
}
