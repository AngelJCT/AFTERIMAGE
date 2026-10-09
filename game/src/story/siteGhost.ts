import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { Game } from '../main';
import type { PoseState } from '../player/animator';
import { echoMaterial } from '../world/echo';
import { heightAt } from '../world/terrain';
import { giantTrunkAt, ruinsArchAt } from '../world/landmarks';

/**
 * What to do at a memory site, shown rather than said: as she nears the next one, a faint glass
 * afterimage of herself waits there in the pose to take (standing at the trunk, lying among the
 * thorns, kneeling at the water), like the trace of someone who was just there. When she acts,
 * it breaks into flakes as she takes its place.
 */
interface GhostSpec {
  pose: Partial<PoseState>;
  /** Metres from the site toward her approach (when `stand` isn't given). */
  offset: number;
  /** Where the act will stand her, facing which way (the same as the act itself works out). */
  stand?: (her: THREE.Vector3) => { spot: THREE.Vector3; yaw: number };
  /** Her right hand reaching (in her own space: x left, y up, z ahead), palm flat on something. */
  reach?: THREE.Vector3;
}

/** Beside a line-like thing (a trunk, a conduit), on her side of it, `gap` from its centre. */
function beside(centre: THREE.Vector3, along: THREE.Vector3, gap: number, her: THREE.Vector3) {
  const toHer = her.clone().sub(centre).setY(0);
  toHer.addScaledVector(along, -toHer.dot(along));
  const n = toHer.lengthSq() > 1e-4 ? toHer.normalize() : new THREE.Vector3(-along.z, 0, along.x);
  return { spot: centre.clone().addScaledVector(n, gap), yaw: Math.atan2(-n.x, -n.z) };
}

export const GHOSTS: Record<string, GhostSpec> = {
  giant: { pose: { headPitch: 0.1, lean: 0.08 }, offset: 0, reach: new THREE.Vector3(0.06, 1.12, 0.5), stand: (her) => {
    const t = giantTrunkAt(0.36);
    return beside(t.center, t.along, t.radius + 0.45, her);
  } },
  thicket: { pose: { lie: 1 }, offset: 0 },
  pool: { pose: { kneel: 1, lean: 0.45, headPitch: 0.5 }, offset: 1.5 },
  marsh: { pose: { headPitch: -0.12 }, offset: 0 },
  ruins: { pose: { headPitch: 0.05, lean: 0.05 }, offset: 0, reach: new THREE.Vector3(0.05, 1.0, 0.5), stand: (her) => {
    const touch = ruinsArchAt(0.13);
    const tan = ruinsArchAt(0.15).sub(ruinsArchAt(0.11)).setY(0).normalize();
    return beside(touch, tan, 0.62, her);
  } },
  mirror: { pose: { kneel: 1, lean: 0.35, headPitch: 0.55 }, offset: 1.5 },
};

const BASE: PoseState = { speed: 0, phase: 0, kneel: 0, lie: 0, lean: 0, breath: 2.0, headPitch: 0, accel: 0, turn: 0, step: 0 };

/** Her body in `pose`, as plain geometry in her own (root) space. */
function bake(g: Game, spec: GhostSpec) {
  const player = g.player, root = player.body.root;
  const p = player as any;
  const keep = {
    p: root.position.clone(), r: root.rotation.clone(), yaw: player.yaw, pose: player.pose,
    target: player.reachTarget.clone(), w: player.reachWeight, open: player.handOpen, up: player.palmUp, sup: player.supinate, lw: player.leftReachWeight,
  };
  root.position.set(0, 0, 0); root.rotation.set(0, 0, 0);
  player.yaw = 0;
  player.pose = { ...BASE, ...spec.pose };
  player.anim.apply(player.pose);
  root.updateMatrixWorld(true);
  // Her own reach (the same IK the act uses), and the lying arm's rest.
  player.reachWeight = spec.reach ? 1 : 0;
  if (spec.reach) { player.reachTarget.copy(spec.reach); player.handOpen = 1; player.palmUp = 1; player.supinate = 0; }
  player.leftReachWeight = 0;
  p.applyReach();
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const geos: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3(), m = new THREE.Matrix4();
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isMesh || !sm.visible) return;
    const src = sm.geometry, p = src.getAttribute('position');
    const out = new Float32Array(p.count * 3);
    m.multiplyMatrices(toRoot, sm.matrixWorld);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (sm.isSkinnedMesh) sm.applyBoneTransform(i, v);
      v.applyMatrix4(m);
      out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
    if (src.index) geo.setIndex(src.index);
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geos.push(geo);
  });
  root.position.copy(keep.p); root.rotation.copy(keep.r);
  player.yaw = keep.yaw; player.pose = keep.pose;
  player.reachTarget.copy(keep.target); player.reachWeight = keep.w; player.handOpen = keep.open; player.palmUp = keep.up;
  player.supinate = keep.sup; player.leftReachWeight = keep.lw;
  player.anim.apply(player.pose);
  root.updateMatrixWorld(true);
  return geos;
}

export class SiteGhost {
  private group: THREE.Group | null = null;
  private k = uniform(2) as THREE.UniformNode<'float', number>;
  private id = '';
  private age = 0;
  private leaving = 0;
  private cache = new Map<string, THREE.BufferGeometry[]>();

  constructor(private g: Game) {}

  /**
   * Each frame: the next site (id and where it is) and her distance to it; `acting` once she
   * has begun its act (the ghost then gives way).
   */
  update(dt: number, id: string | null, at: THREE.Vector3 | null, d: number, acting: boolean) {
    const want = !!id && !!at && GHOSTS[id] && d < 12 && !acting;
    if (want && this.id !== id) this.place(id!, at!);
    if (!this.group) return;
    if ((acting || id !== this.id) && this.leaving === 0) {
      this.leaving = 0.0001;
      this.g.flakes.burst(this.group.position.clone().setY(this.group.position.y + 0.8), 0.5, 40, 0.035, 0.5);
    }
    this.age += dt;
    if (this.leaving > 0) {
      this.leaving += dt;
      this.k.value = Math.min(1, this.leaving / 1.2);
      if (this.leaving > 1.2) this.clear();
      return;
    }
    // In over a second or two (assembling from the ground up), and out again if she walks away.
    const appear = Math.min(1, this.age / 1.6);
    const far = THREE.MathUtils.smoothstep(d, 10, 12);
    this.k.value = (1 - appear) * 2 + far;
  }

  private place(id: string, at: THREE.Vector3) {
    this.clear();
    const spec = GHOSTS[id];
    if (!this.cache.has(id)) this.cache.set(id, bake(this.g, spec));
    const geos = this.cache.get(id)!;
    const p = this.g.player.position;
    let spot: THREE.Vector3, yaw: number;
    if (spec.stand) ({ spot, yaw } = spec.stand(p));
    else {
      const toHer = new THREE.Vector3(p.x - at.x, 0, p.z - at.z);
      if (toHer.lengthSq() < 1e-4) toHer.set(0, 0, 1);
      toHer.normalize();
      spot = at.clone().addScaledVector(toHer, spec.offset);
      // Facing the site (for one standing or kneeling at it).
      yaw = Math.atan2(-toHer.x, -toHer.z);
    }
    spot.y = heightAt(spot.x, spot.z);
    const group = new THREE.Group();
    group.position.copy(spot);
    group.rotation.y = yaw;
    let minY = Infinity, maxY = -Infinity;
    for (const geo of geos) { minY = Math.min(minY, geo.boundingBox!.min.y); maxY = Math.max(maxY, geo.boundingBox!.max.y); }
    for (const geo of geos) {
      const mesh = new THREE.Mesh(geo, echoMaterial(this.k, spot.y + minY, spot.y + maxY));
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    this.g.scene.add(group);
    this.group = group;
    this.id = id;
    this.age = 0;
    this.leaving = 0;
    this.k.value = 2;
  }

  clear() {
    if (this.group) {
      this.g.scene.remove(this.group);
      for (const m of this.group.children as THREE.Mesh[]) (m.material as THREE.Material).dispose();
    }
    this.group = null;
    this.id = '';
    this.leaving = 0;
  }
}
