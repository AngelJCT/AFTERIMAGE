import * as THREE from 'three/webgpu';
import { filmLight } from '../core/filmLight';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  attribute, clamp, color, float, mix, smoothstep, positionWorld, vec3, mx_fractal_noise_float, mx_worley_noise_float, sin,
} from 'three/tsl';
import { footprint } from './groveKit';
import { EXIT, GATE, WATER_LEVEL, bumpNormal } from './terrain';
import type { Blocker } from './landmarks';

/**
 * The refuge gate (blender/scripts/gate_kit.py): the slab on its rails, the LEFT jamb's bolt,
 * the RIGHT pillar's receiver with its severed lead, the power cable and plug at rest.
 * Local +Z is the refuge side, turned to face the way out; the escape route lies behind it.
 */
export class Gate {
  root: THREE.Object3D;
  slab: THREE.Object3D;
  cable: THREE.Object3D;
  plug: THREE.Object3D;
  obstacles: THREE.Vector2[] = [];
  roof: THREE.SpotLight;
  /** How far the slab can rise (m). */
  readonly travel: number;
  private slabY: number;
  private pts: Record<string, THREE.Vector3> = {};
  private _lift = 0;

  constructor(gltf: { scene: THREE.Object3D }) {
    const root = gltf.scene;
    root.name = 'gate';
    const face = new THREE.Vector3().subVectors(EXIT, GATE).setY(0).normalize();
    root.position.set(GATE.x, WATER_LEVEL, GATE.z);
    root.rotation.y = Math.atan2(face.x, face.z);
    root.updateMatrixWorld(true);
    const mat = gateMaterial();
    const masonry = gateMaterial('masonry');
    const byName = new Map<string, THREE.Object3D>();
    let frame: THREE.Object3D | null = null;
    root.traverse((o) => {
      byName.set(o.name, o);
      if (o.userData.slab_open !== undefined) frame = o;
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = o.userData.surface === 'masonry' || o.name === 'gate_walls' ? masonry : mat;
      m.castShadow = m.receiveShadow = true;
    });
    const need = (n: string) => {
      const o = byName.get(n);
      if (!o) throw new Error(`gate kit: missing ${n}`);
      return o;
    };
    // The slab moves under a pivot at its bottom centre (the kit origin): meshopt keeps its
    // dequantisation on the mesh node, so the node itself isn't moved.
    this.slab = new THREE.Group();
    this.slab.name = 'gate_slab_pivot';
    root.add(this.slab);
    this.slab.add(need('gate_slab'));
    this.cable = need('gate_cable');
    this.slabY = this.slab.position.y;
    const extras = (frame as THREE.Object3D | null)?.userData ?? {};
    this.travel = extras.slab_open ?? 2.72;
    for (const k of ['bolt_tip', 'socket', 'cable_anchor', 'plug_rest'] as const) {
      const v = extras[k] as number[] | undefined;
      if (v) this.pts[k] = new THREE.Vector3(v[0], v[1], v[2]);
    }
    // The plug under a pivot at its contact nose, local -X pointing out of the nose (into a
    // socket); kept in place until the story takes it.
    const plugNode = need('gate_plug');
    const rest = this.pts.plug_rest ?? new THREE.Vector3();
    plugNode.updateMatrix();
    plugNode.matrixAutoUpdate = false;
    plugNode.matrix.premultiply(new THREE.Matrix4().makeTranslation(-rest.x, -rest.y, -rest.z));
    this.plug = new THREE.Group();
    this.plug.name = 'gate_plug_pivot';
    this.plug.position.copy(rest);
    root.add(this.plug);
    this.plug.add(plugNode);
    const frameMesh = need('gate_frame') as THREE.Mesh;
    // The masonry walls are their own mesh (crisp, not smoothed with the frame).
    const wallsMesh = byName.get('gate_walls') as THREE.Mesh | undefined;
    const stoneMesh = byName.get('gate_masonry') as THREE.Mesh | undefined;
    for (const c of [...footprint(frameMesh), ...(wallsMesh ? footprint(wallsMesh) : []), ...(stoneMesh ? footprint(stoneMesh) : [])]) {
      const w = c.clone().applyMatrix4(root.matrixWorld);
      this.obstacles.push(new THREE.Vector2(w.x, w.z));
    }
    // The refuge's open roof: soft ivory daylight falling on her side of the gate (the sun is
    // behind it, so without this the face of the gate sits in its own shadow).
    const roof = new THREE.SpotLight(0xe1e5e3, 44, 26, 0.95, 1, 1.4);
    roof.position.set(0.5, 11, 7);
    roof.target.position.set(0, 1.2, 0.5);
    roof.castShadow = false;
    root.add(roof, roof.target);
    this.roof = roof;
    this.root = root;
  }

  /** A named point of the kit in world space (bolt_tip, socket, cable_anchor, plug_rest). */
  point(name: 'bolt_tip' | 'socket' | 'cable_anchor' | 'plug_rest') {
    return this.root.localToWorld((this.pts[name] ?? new THREE.Vector3()).clone());
  }

  /** Where she stands to face the gate, `back` metres out on the refuge side, and her yaw. */
  approach(back = 1.2, along = 0) {
    const q = this.root.quaternion;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const at = this.root.position.clone().addScaledVector(fwd, back).addScaledVector(side, along);
    return { at, yaw: Math.atan2(-fwd.x, -fwd.z) };
  }

  /** A gate-local point in world space. */
  world(local: THREE.Vector3) {
    return this.root.localToWorld(local.clone());
  }

  /** A world direction in gate-local space. */
  localDir(worldDir: THREE.Vector3) {
    return worldDir.clone().applyQuaternion(this.root.quaternion.clone().invert());
  }

  /** 0 = shut, 1 = fully raised. */
  get lift() { return this._lift; }
  set lift(k: number) {
    this._lift = THREE.MathUtils.clamp(k, 0, 1);
    this.slab.position.y = this.slabY + this._lift * this.travel;
    this.slab.updateMatrixWorld(true);
  }

  /** Put the plug back where it lies at rest (on the floor by the right pillar). */
  restPlug() {
    this.plug.position.copy(this.pts.plug_rest ?? new THREE.Vector3());
    this.plug.quaternion.identity();
    this.plug.updateMatrixWorld(true);
    this.cable.visible = true;
  }

  /** Height of the slab's underside above the sill (m). */
  get gap() { return this._lift * this.travel; }
  set gap(m: number) { this.lift = m / this.travel; }

  /** Derelict: the slab hangs a little crooked in its rails (radians about the wall normal). */
  set jam(a: number) {
    this.slab.rotation.z = a;
    this.slab.updateMatrixWorld(true);
  }

  /** What she can't walk through: both walls with their jambs, and the slab unless raised. */
  blockers(): Blocker[] {
    const w = (x: number) => { const v = this.root.localToWorld(new THREE.Vector3(x, 0, 0)); return new THREE.Vector2(v.x, v.z); };
    const out: Blocker[] = [
      { a: w(-9.5), b: w(-1.7), r: 0.55 },
      { a: w(1.7), b: w(9.5), r: 0.55 },
    ];
    if (this._lift < 0.6) out.push({ a: w(-1.6), b: w(1.6), r: 0.25 });
    return out;
  }
}

/**
 * Weathered iron and masonry, read from the kit's masks (R = AO, G = crust, B = rust):
 * pitted plate, rain streaks running down, pale mineral crust that flakes, rust bleeding
 * from the edges. Tight in colour: charcoal and pewter metal, bone stone, muted rust.
 */
export function gateMaterial(surface: 'mixed' | 'masonry' = 'mixed') {
  const m = new THREE.MeshStandardNodeMaterial();
  m.envMapIntensity = surface === 'masonry' ? 0.4 : 0.8;
  const c = attribute('color', 'vec4');
  const ao = c.r;
  const pw = positionWorld;
  const vary = mx_fractal_noise_float(pw.mul(0.5), 2, 2, 0.5);
  const crust = clamp(c.g.add(vary.mul(0.3)), 0.0, 1.0);
  const stone = surface === 'masonry' ? float(1) : smoothstep(0.55, 0.8, crust);
  // Rain streaks: stretched noise, long in y.
  const streak = mx_fractal_noise_float(vec3(pw.x.mul(7), pw.y.mul(0.35), pw.z.mul(7)), 3, 2, 0.5);
  // Rust: the kit's mask, plus blooms across the plate (broken patches, as in the boards) and
  // runs bleeding down from the seams and rivet lines (bands of the plate's height).
  const blooms = smoothstep(0.55, 0.72, mx_fractal_noise_float(pw.mul(1.7).add(vec3(3.3, 0, 1.1)), 3, 2, 0.5).mul(0.5).add(0.5)
    .add(mx_fractal_noise_float(pw.mul(6.0), 2, 2, 0.5).mul(0.12)));
  const seams = smoothstep(0.75, 1.0, sin(pw.y.mul(Math.PI / 0.62)).abs()).mul(smoothstep(0.2, 0.6, streak.add(0.35)));
  // Extra corrosion blooms and seam stains belong to iron, not masonry.
  const onIron = float(1).sub(stone);
  const rust = smoothstep(0.3, 0.75, c.b.add(streak.mul(0.25))).max(blooms.mul(0.6).mul(onIron)).max(seams.mul(0.45).mul(onIron));
  // Pits: small worley cells in the plate; flakes where the crust sits.
  const pits = smoothstep(0.0, 0.18, mx_worley_noise_float(pw.mul(26)));
  const flake = smoothstep(0.15, 0.55, mx_fractal_noise_float(pw.mul(9), 2, 2, 0.5).abs());
  const grit = mx_fractal_noise_float(pw.mul(45), 2, 2, 0.5);

  const iron = mix(color(0x343b3b), color(0x696e6a), smoothstep(-0.4, 0.6, vary));
  // Pale mineral bloom on the plate, in broad patches.
  const bloom = smoothstep(0.1, 0.75, mx_fractal_noise_float(vec3(pw.x.mul(2.2), pw.y.mul(0.6), pw.z.mul(2.2)).add(7), 3, 2, 0.5).add(streak.mul(0.3))).mul(float(1).sub(stone));
  // Muted brown corrosion with a lighter ochre edge where it flakes.
  const rustC = mix(color(0x53473a), color(0x796047), flake.mul(0.7));
  const boneC = mix(color(0x92958b), color(0xc4c5ba), crust);
  let base = mix(iron, boneC, stone);
  base = mix(base, boneC.mul(0.75), bloom.mul(0.3));
  base = mix(base, rustC, rust.mul(mix(float(0.55), float(0.10), stone)));
  // Streaks darken (wet runs) or lighten (dried salt) a little; pits hold dark.
  const tone = float(1).add(streak.mul(0.12)).mul(mix(float(0.84), float(1), pits)).mul(float(1).sub(flake.mul(stone).mul(0.06)));
  const damp = smoothstep(0.4, -0.05, pw.y);
  m.colorNode = base.mul(tone).mul(mix(float(0.48), float(1.0), ao)).mul(float(1).sub(damp.mul(0.22)));
  m.roughnessNode = mix(float(0.67), float(0.92), stone).add(rust.mul(0.06)).sub(damp.mul(0.16));
  m.metalnessNode = mix(float(0.22), float(0.0), stone).mul(float(1).sub(rust.mul(0.7))).mul(float(1).sub(bloom));
  const relief = float(1).sub(pits).mul(0.0018).mul(float(1).sub(stone))
    .add(flake.mul(0.0014).mul(stone))
    .add(rust.mul(flake).mul(0.0015))
    .add(grit.mul(0.0006))
    .add(streak.mul(0.0007));
  m.normalNode = bumpNormal(relief);
  // Lit for the camera in cutscenes, like the characters (core/filmLight.ts): the gate is a set
  // piece seen up close, mostly backlit, and its iron would read as black.
  m.emissiveNode = filmLight(vec3((m.colorNode as any).rgb), surface === 'masonry' ? 0.12 : 0.55);
  return m;
}

export async function loadGate(url: string) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Gate(await loader.loadAsync(url));
}
