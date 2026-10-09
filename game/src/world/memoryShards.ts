import * as THREE from 'three/webgpu';
import { texture, uniform, uv, color, smoothstep, sin, time, float, min, mix } from 'three/tsl';

type P2 = [number, number];

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clip(poly: P2[], m: P2, n: P2): P2[] {
  const out: P2[] = [];
  const side = (p: P2) => (p[0] - m[0]) * n[0] + (p[1] - m[1]) * n[1];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const sa = side(a), sb = side(b);
    if (sa <= 0) out.push(a);
    if ((sa <= 0) !== (sb <= 0)) { const t = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

interface Shard { mesh: THREE.Mesh; rim: THREE.Line; centre: THREE.Vector3; depth: number; spin: THREE.Vector3; phase: number }

/**
 * A memory broken into crystal and hung in the air: fragments of one image (a film still),
 * each at its own depth along the lines of sight from a single viewpoint. From anywhere else
 * they are scattered shards with pieces of a picture on them; seen from that point they line
 * up into the whole image. As the view nears it they gather (their depths close in and their
 * tilt settles) until it holds; then it can play.
 */
export class MemoryShards {
  group = new THREE.Group();
  /** 0 scattered .. 1 gathered into the image. */
  gathered = 0;
  /** How well the current view lines up, 0..1 (set by update). */
  alignment = 0;
  readonly view: THREE.Vector3;
  readonly target: THREE.Vector3;
  private shards: Shard[] = [];
  private uGlow = uniform(0);
  private uAlpha = uniform(0);
  private t = 0;

  constructor(scene: THREE.Scene, url: string, view: THREE.Vector3, target: THREE.Vector3, opts: { fov?: number; aspect?: number; seed?: number } = {}) {
    this.view = view.clone();
    this.target = target.clone();
    const fov = THREE.MathUtils.degToRad(opts.fov ?? 34);
    const aspect = opts.aspect ?? 1280 / 560;
    const d0 = view.distanceTo(target);
    const fwd = target.clone().sub(view).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const h = 2 * d0 * Math.tan(fov / 2), w = h * aspect;
    // A point of the picture (u, v in 0..1) on the image plane.
    const onPlane = (u: number, v: number) => target.clone().addScaledVector(right, (u - 0.5) * w).addScaledVector(up, (v - 0.5) * h);

    const tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
    mat.fog = false;
    // The picture, a touch lifted as it gathers, with its edges fading so the whole never reads as a rectangle.
    const e = min(min(uv().x, uv().x.oneMinus()), min(uv().y, uv().y.oneMinus()));
    const vignette = smoothstep(0.0, 0.12, e);
    const flicker = sin(time.mul(2.1)).mul(0.04).add(0.96);
    mat.colorNode = texture(tex, uv()).rgb.mul(float(0.8).add(this.uGlow.mul(0.35))).mul(flicker);
    // Scattered, the pieces are faint glass; gathered, the picture is solid (its outer edge still soft).
    mat.opacityNode = this.uAlpha.mul(mix(vignette.mul(0.7).add(0.15), vignette.mul(0.3).add(0.7), this.uGlow));
    const rimMat = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    rimMat.fog = false;
    rimMat.colorNode = color(1.0, 0.8, 0.55).mul(this.uAlpha.mul(float(0.55).add(this.uGlow.mul(0.9))));

    // Fracture the picture: Voronoi cells over the unit square.
    const r = mulberry(opts.seed ?? 11);
    const seeds: P2[] = [];
    for (let i = 0; i < 34; i++) seeds.push([r(), r()]);
    const square: P2[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    seeds.forEach((s, i) => {
      let poly = square;
      for (let j = 0; j < seeds.length && poly.length; j++) {
        if (j === i) continue;
        const o = seeds[j];
        poly = clip(poly, [(s[0] + o[0]) / 2, (s[1] + o[1]) / 2], [o[0] - s[0], o[1] - s[1]]);
      }
      if (poly.length < 3) return;
      const cu = poly.reduce((a, p) => a + p[0], 0) / poly.length, cv = poly.reduce((a, p) => a + p[1], 0) / poly.length;
      const centre = onPlane(cu, cv);
      // Geometry around the shard's own centre (on the image plane); scaled about the view later.
      const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
      pos.push(0, 0, 0); uvs.push(cu, cv);
      for (const [u, v] of poly) { const p = onPlane(u, v).sub(centre); pos.push(p.x, p.y, p.z); uvs.push(u, v); }
      for (let k = 0; k < poly.length; k++) idx.push(0, 1 + k, 1 + ((k + 1) % poly.length));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, mat);
      // A closed outline (WebGPU has no line loops: a strip back to its first point).
      const rimGeo = new THREE.BufferGeometry();
      rimGeo.setAttribute('position', new THREE.Float32BufferAttribute([...pos.slice(3), ...pos.slice(3, 6)], 3));
      const rim = new THREE.Line(rimGeo, rimMat);
      mesh.add(rim);
      mesh.renderOrder = 6;
      this.group.add(mesh);
      this.shards.push({
        mesh, rim, centre,
        depth: 0.45 + r() * 1.25,
        spin: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(1.4),
        phase: r() * Math.PI * 2,
      });
    });
    this.group.name = 'memoryShards';
    this.group.visible = false;
    scene.add(this.group);
    this.place();
  }

  /** Set the shards' depth and tilt for how gathered they are. */
  private place() {
    const g = this.gathered;
    const e = g * g * (3 - 2 * g);
    for (const s of this.shards) {
      const k = THREE.MathUtils.lerp(s.depth, 1, e);           // scale about the viewpoint
      const bob = (1 - e) * 0.06 * Math.sin(this.t * 0.7 + s.phase);
      s.mesh.position.copy(this.view).lerp(s.centre, k).add(new THREE.Vector3(0, bob, 0));
      s.mesh.scale.setScalar(k);
      const tilt = 1 - e;
      s.mesh.rotation.set(s.spin.x * tilt, s.spin.y * tilt, s.spin.z * tilt);
    }
  }

  set visible(v: boolean) { this.group.visible = v; }

  /**
   * Follow the camera: how close it is to the viewpoint and how straight it looks at the
   * picture decide how far the shards gather. Returns the alignment (0..1).
   */
  update(dt: number, cam: THREE.Camera, fadeIn = 1) {
    this.t += dt;
    const p = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3());
    // Where the camera stands matters most; which way it looks only across (the follow camera
    // always tilts a little down at her).
    const want = this.target.clone().sub(this.view).setY(0).normalize();
    dir.setY(0).normalize();
    const near = THREE.MathUtils.clamp(1 - p.distanceTo(this.view) / 3.2, 0, 1);
    const facing = THREE.MathUtils.clamp((dir.dot(want) - 0.88) / 0.1, 0, 1);
    this.alignment = near * facing;
    const goal = Math.max(this.gathered > 0.97 ? 1 : 0, this.alignment);
    this.gathered += (goal - this.gathered) * (1 - Math.exp(-dt * 1.6));
    this.uAlpha.value += (fadeIn - this.uAlpha.value) * (1 - Math.exp(-dt * 2));
    this.uGlow.value = this.gathered * this.gathered;
    this.place();
    return this.alignment;
  }

  /** Fade the whole thing (0..1). */
  set opacity(v: number) { this.uAlpha.value = v; }

  /** Lock it gathered (the memory holds). */
  hold() { this.gathered = 1; this.place(); }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); });
  }
}
