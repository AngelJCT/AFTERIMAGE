import * as THREE from 'three/webgpu';
import {
  attribute, color, float, mix, uniform, texture, uv, positionLocal, vec3, clamp, exp, sin, cos, normalize, dot, max, normalWorld,
} from 'three/tsl';
import { SUN_DIR } from './atmosphere';
import type { Flakes } from './flakes';

/**
 * A chapter's title set in the world (Remedy's lesson in our language): numeral and name stand
 * in the air beside her, a little beyond, catching the light as a sheen passes across them.
 * Then they come apart the way her memories do: piece by piece from the left, rising and
 * turning away on the wind, shedding flakes.
 *
 * The text is a canvas texture on a plane cut into irregular triangular shards; each shard moves
 * on its own in the vertex shader (its centre and a random seed are attributes).
 */
const W = 2.4, H = 0.6;
const COLS = 30, ROWS = 8;

export class WorldTitle {
  readonly mesh: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private uIn = uniform(0);
  private uOut = uniform(0);
  private uSheen = uniform(-1);
  private t = -1;
  private hold = 4.5;
  private done: (() => void) | null = null;
  private shed = 0;

  constructor(scene: THREE.Scene, private flakes: Flakes) {
    this.canvas.width = 2048; this.canvas.height = 512;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;

    // A jittered grid, each cell two triangles, every triangle with its own corners.
    const jit = (i: number, j: number) => {
      const edge = i === 0 || j === 0 || i === COLS || j === ROWS;
      const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
      const r = h - Math.floor(h), r2 = (h * 7.13) - Math.floor(h * 7.13);
      return new THREE.Vector2(i / COLS + (edge ? 0 : (r - 0.5) * 0.7 / COLS), j / ROWS + (edge ? 0 : (r2 - 0.5) * 0.7 / ROWS));
    };
    const pos: number[] = [], uvs: number[] = [], centre: number[] = [], seed: number[] = [];
    const tri = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) => {
      const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, s = Math.random();
      for (const p of [a, b, c]) {
        pos.push((p.x - 0.5) * W, (p.y - 0.5) * H, 0);
        uvs.push(p.x, p.y);
        centre.push((cx - 0.5) * W, (cy - 0.5) * H, 0);
        seed.push(s);
      }
    };
    for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) {
      const a = jit(i, j), b = jit(i + 1, j), c = jit(i + 1, j + 1), d = jit(i, j + 1);
      if ((i + j) % 2) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('centre', new THREE.Float32BufferAttribute(centre, 3));
    g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, k) => (k % 3 === 2 ? 1 : 0)), 3));

    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: true, side: THREE.FrontSide, fog: false });
    mat.alphaTest = 0.04;
    const c = attribute('centre', 'vec3'), s = attribute('seed', 'float');
    const u = uv();
    // Out: a front sweeping left to right, each piece a little early or late.
    const tOut = clamp(this.uOut.mul(1.8).sub(u.x.mul(0.65)).sub(s.mul(0.25)), 0, 1);
    // In: they gather from a little scatter, left first.
    const tIn = clamp(float(1).sub(this.uIn.mul(1.8).sub(u.x.mul(0.5)).sub(s.mul(0.3))), 0, 1);
    const tt = tOut.add(tIn.mul(0.35));
    const ang = tt.mul(s.mul(5.0).add(1.5));
    const rel = positionLocal.sub(c).mul(float(1).sub(tOut.mul(0.55)));
    const turned = vec3(rel.x.mul(cos(ang)), rel.y, rel.x.mul(sin(ang)).add(rel.z));
    const drift = vec3(tt.mul(0.7).add(s.sub(0.5).mul(tt).mul(0.4)), tt.mul(tt).mul(0.9).add(s.mul(tt).mul(0.3)), s.sub(0.5).mul(tt).mul(0.8));
    mat.positionNode = c.add(turned).add(drift);

    const tx = texture(this.tex, u);
    // Catching the light: brighter as it turns toward the sun, and a sheen that passes across.
    const toSun = max(dot(normalize(normalWorld), uniform(SUN_DIR)), 0.0);
    const sheen = exp(u.x.sub(this.uSheen).mul(5.0).pow(2).negate()).mul(1.4);
    const shimmer = max(sin(ang.mul(3.0)), 0.0).mul(tOut).mul(1.5);
    // The letters light, over a soft dark halo (so they read against the pale haze).
    const light = mix(color(0xe9e2d4), color(0xfff4dc), toSun.mul(0.5)).mul(float(1.6).add(sheen).add(shimmer));
    mat.colorNode = mix(color(0x16130f), light, tx.r);
    mat.opacityNode = tx.a.mul(float(1).sub(tOut)).mul(float(1).sub(tIn)).mul(0.92);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.mesh.name = 'chapter-title';
    scene.add(this.mesh);
  }

  private draw(n: string, title: string) {
    const ctx = this.canvas.getContext('2d')!;
    const { width: w, height: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    // Each line twice: a dark blurred halo, then the letters.
    const line = (text: string, x: number, y: number, alpha: number) => {
      ctx.save();
      ctx.fillStyle = '#000'; ctx.shadowColor = '#000'; ctx.shadowBlur = 28;
      ctx.globalAlpha = 0.3 * alpha;
      ctx.fillText(text, x, y); ctx.fillText(text, x, y);
      ctx.restore();
      ctx.fillStyle = '#fff'; ctx.globalAlpha = alpha;
      ctx.fillText(text, x, y);
      ctx.globalAlpha = 1;
    };
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font') || 'sans-serif';
    ctx.font = `300 84px ${font}`;
    (ctx as unknown as { letterSpacing: string }).letterSpacing = '30px';
    line(n, 40, h * 0.24, 0.75);
    // The name as large as the plane allows.
    let size = 230;
    const set = () => {
      ctx.font = `400 ${size}px ${font}`;
      (ctx as unknown as { letterSpacing: string }).letterSpacing = `${Math.round(size * 0.32)}px`;
    };
    set();
    while (ctx.measureText(title).width > w - 100 && size > 60) { size -= 6; set(); }
    line(title, 40, h * 0.64, 1);
    this.tex.needsUpdate = true;
  }

  /**
   * Set the title in the world, beside her and a little beyond as the camera (heading `yaw`
   * from her) sees her, facing it; resolves once it has come apart. While it gathers it keeps to
   * her and the camera (an opening shot may still be turning), then it stays where it formed.
   */
  show(n: string, title: string, place: () => { her: THREE.Vector3; yaw: number; halfW: number; narrow?: boolean }) {
    this.draw(n, title.toUpperCase());
    this.place = place;
    this.put(1);
    this.mesh.visible = true;
    this.t = 0; this.shed = 0;
    this.uIn.value = 0; this.uOut.value = 0; this.uSheen.value = -1;
    return new Promise<void>((res) => (this.done = res));
  }

  private place: (() => { her: THREE.Vector3; yaw: number; halfW: number; narrow?: boolean }) | null = null;
  private put(k: number) {
    if (!this.place) return;
    const { her, yaw, halfW, narrow = false } = this.place();
    // Sized to the view: across most of the left half of the frame, ending short of her. A narrow
    // (portrait) view has no room beside her: there it spans the frame, above her head.
    const sc = narrow ? THREE.MathUtils.clamp((halfW * 1.35) / W, 0.12, 1.2) : THREE.MathUtils.clamp((halfW * 0.85) / W, 0.4, 2.2);
    this.mesh.scale.setScalar(this.mesh.scale.x + (sc - this.mesh.scale.x) * k);
    // yaw 0: the camera sits to +Z of her, looking toward -Z.
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const at = her.clone().addScaledVector(fwd, 0.6).addScaledVector(right, narrow ? 0 : -halfW * 0.56);
    at.y = her.y + (narrow ? 2.15 : 1.2 + 0.2 * sc);
    this.mesh.position.lerp(at, k);
    const ry = yaw, cur = this.mesh.rotation.y;
    this.mesh.rotation.set(0, cur + Math.atan2(Math.sin(ry - cur), Math.cos(ry - cur)) * k, 0);
  }

  update(dt: number) {
    if (this.t < 0) return;
    this.t += dt;
    const t = this.t;
    if (t < 1.6) this.put(1 - Math.exp(-dt * 4));
    this.uIn.value = Math.min(1, t / 1.6);
    this.uSheen.value = -0.3 + (t - 0.8) * 0.45;
    const out = Math.max(0, (t - 1.6 - this.hold) / 2.6);
    this.uOut.value = out;
    // Flakes off the breaking edge.
    if (out > 0 && out < 1 && (this.shed -= dt) <= 0) {
      this.shed = 0.05;
      const x = (Math.min(1, out * 1.8 * 0.9) - 0.5) * W;
      const p = new THREE.Vector3(x, (Math.random() - 0.5) * H * 0.6, 0).applyMatrix4(this.mesh.matrixWorld);
      this.flakes.burst(p, 0.15, 2, 0.04, 0.4);
    }
    if (out >= 1) {
      this.t = -1;
      this.mesh.visible = false;
      this.done?.(); this.done = null;
    }
  }

  /** Gone at once (a chapter jump, the title screen). */
  cancel() {
    if (this.t < 0) return;
    this.t = -1;
    this.mesh.visible = false;
    this.done?.(); this.done = null;
  }
}
