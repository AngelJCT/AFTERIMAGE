import * as THREE from 'three/webgpu';
import { texture, uniform, uv, color, sin, time, float, smoothstep } from 'three/tsl';
import { WATER_LEVEL } from './terrain';

const SIZE = 0.2;      // metres across the texture: a child's hand is about 13 cm long
const RES = 256;

/** Finger capsules in texture pixels (palm-down right hand, fingers toward the top). */
const FINGERS: [number, number, number, number, number][] = [
  // baseX, baseY, tipX, tipY, width
  [104, 126, 90, 50, 12],   // index
  [124, 120, 122, 36, 13],  // middle
  [143, 124, 152, 46, 12],  // ring
  [160, 136, 180, 76, 10],  // pinky
];
const THUMB: [number, number, number, number, number] = [100, 178, 52, 136, 14];

/**
 * RGB channels: R = the hand's body, G = a bright rim just inside its outline, B = a wide
 * halo. The shader mixes them so it reads as light with a shape, not a solid.
 */
function drawHand() {
  const c = document.createElement('canvas');
  c.width = c.height = RES;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const shape = (blur: number) => {
    g.clearRect(0, 0, RES, RES);
    g.save();
    g.filter = blur > 0 ? `blur(${blur}px)` : 'none';
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round';
    g.beginPath(); g.ellipse(132, 166, 34, 40, 0.05, 0, Math.PI * 2); g.fill();
    for (const [x0, y0, x1, y1, w] of [...FINGERS, THUMB]) {
      g.lineWidth = w;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    g.restore();
    return g.getImageData(0, 0, RES, RES).data.slice();
  };
  const sharp = shape(0.5), soft = shape(2.2), halo = shape(9);
  const out = g.createImageData(RES, RES);
  for (let i = 0; i < out.data.length; i += 4) {
    const m = sharp[i] / 255, s = soft[i] / 255;
    out.data[i] = soft[i];                                              // body
    out.data[i + 1] = Math.round(255 * Math.min(1, m * (1 - s) * 3.2)); // rim
    out.data[i + 2] = halo[i];                                          // halo
    out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/**
 * A small hand made of light lying on the water: the first afterimage. Wordless and faceless;
 * only a hand, the rings its fingertips make, and warmth.
 */
export class LightHand {
  mesh: THREE.Mesh;
  readonly uOpacity = uniform(0);

  constructor(scene: THREE.Scene) {
    const tex = drawHand();
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.fog = false;   // additive: fog would add haze over the whole quad
    mat.depthTest = false; // light: it lies over her hand, not under it
    const t = texture(tex, uv());
    const flicker = sin(time.mul(2.3)).mul(0.08).add(sin(time.mul(5.1)).mul(0.04)).add(0.9);
    // Warm ivory rim, a faint body, an ochre halo.
    const warm = color(1.0, 0.8, 0.52), ochre = color(0.9, 0.55, 0.2);
    // Fade to nothing well inside the quad's edges.
    const edge = smoothstep(0.0, 0.12, uv().x).mul(smoothstep(1.0, 0.88, uv().x)).mul(smoothstep(0.0, 0.12, uv().y)).mul(smoothstep(1.0, 0.88, uv().y));
    mat.colorNode = warm.mul(t.g.mul(3.4).add(t.r.mul(0.1))).add(ochre.mul(t.b.mul(0.2))).mul(flicker).mul(this.uOpacity).mul(edge);
    mat.opacityNode = float(1);
    const geo = new THREE.PlaneGeometry(SIZE, SIZE);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    this.mesh.name = 'lightHand';
    scene.add(this.mesh);
  }

  /** Lay it on the water at `p`, fingers pointing along `yaw` (0 = +Z). */
  place(p: THREE.Vector3, yaw: number, lift = 0) {
    this.mesh.position.set(p.x, WATER_LEVEL + 0.004 + lift, p.z);
    // Texture "up" is -Z after the rotation; turn so fingers point along yaw.
    this.mesh.rotation.set(0, yaw + Math.PI, 0);
    this.mesh.updateMatrixWorld();
  }

  /** World positions of the four fingertips (where its rings start). */
  fingertips() {
    return FINGERS.map(([, , x, y]) => new THREE.Vector3((x / RES - 0.5) * SIZE, 0, (y / RES - 0.5) * SIZE)
      .applyMatrix4(this.mesh.matrixWorld));
  }

  set opacity(v: number) {
    this.uOpacity.value = v;
    this.mesh.visible = v > 0.001;
  }
}
