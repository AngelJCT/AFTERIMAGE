import * as THREE from 'three/webgpu';

/**
 * Bone-name contract shared by the placeholder and the real character.
 * Mixamo-style names (without the "mixamorig:" prefix) so Mixamo clips retarget cleanly.
 * See docs/character-pipeline.md.
 */
export const BONE_NAMES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _pqi = new THREE.Quaternion();
const _orig = new THREE.Quaternion();
const _eul = new THREE.Euler();

export interface LegMetrics {
  thigh: number;     // hip joint -> knee
  shin: number;      // knee -> ankle
  ankle: number;     // ankle height above the soles at rest
  hipOffset: number; // Hips bone height above the hip joints
}

export class Rig {
  bones = new Map<string, THREE.Object3D>();
  rest = new Map<string, THREE.Quaternion>();
  /** Rest orientation of each bone in character (model) space, and its inverse. */
  private restModel = new Map<string, THREE.Quaternion>();
  private restModelInv = new Map<string, THREE.Quaternion>();
  /** Model-space corrections applied before posing (e.g. lower A-pose arms). */
  private fix = new Map<string, THREE.Quaternion>();
  legs: LegMetrics;
  /** Corrective helpers: each turns half as far as its joint bone (keeps volume at bends). */
  private helpers: { helper: THREE.Object3D; bone: THREE.Object3D; rest: THREE.Quaternion }[] = [];
  /** Forearm twist bones: take part of the hand's roll about the forearm. */
  private twists: {
    bone: THREE.Object3D; rest: THREE.Quaternion; hand: THREE.Object3D; handRestInv: THREE.Quaternion;
    axisH: THREE.Vector3; axisT: THREE.Vector3;
  }[] = [];

  /** `root` must be the character root with an identity world transform at this point. */
  constructor(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const rootInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    root.traverse((o) => {
      const name = o.name.replace(/^mixamorig:?/, '');
      if ((BONE_NAMES as readonly string[]).includes(name) && !this.bones.has(name)) {
        this.bones.set(name, o);
        this.rest.set(name, o.quaternion.clone());
        const qm = rootInv.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()));
        this.restModel.set(name, qm);
        this.restModelInv.set(name, qm.clone().invert());
      }
    });

    const pos = (n: BoneName) => this.get(n).getWorldPosition(new THREE.Vector3()).sub(root.getWorldPosition(new THREE.Vector3()));
    this.legs = {
      thigh: pos('LeftUpLeg').distanceTo(pos('LeftLeg')),
      shin: pos('LeftLeg').distanceTo(pos('LeftFoot')),
      ankle: pos('LeftFoot').y,
      hipOffset: pos('Hips').y - pos('LeftUpLeg').y,
    };

    for (const side of ['Left', 'Right']) {
      const twist = root.getObjectByName(`${side}ForeArmTwist`);
      const hand = root.getObjectByName(`${side}Hand`);
      if (twist && hand) {
        // Forearm axis in the hand's rest frame and in the twist bone's rest frame.
        const axisF = hand.position.clone().normalize();
        this.twists.push({
          bone: twist, rest: twist.quaternion.clone(), hand, handRestInv: hand.quaternion.clone().invert(),
          axisH: axisF.clone().applyQuaternion(hand.quaternion.clone().invert()),
          axisT: axisF.clone().applyQuaternion(twist.quaternion.clone().invert()),
        });
      }
      for (const j of ['Arm', 'ForeArm', 'UpLeg', 'Leg']) {
        const helper = root.getObjectByName(`${side}${j}Helper`);
        const bone = this.bones.get(`${side}${j}`);
        if (helper && bone) this.helpers.push({ helper, bone, rest: this.rest.get(`${side}${j}`)! });
      }
    }

    // Arms hang slightly away from the body whatever the rest pose (T, A or down).
    for (const [side, sx] of [['Left', 1], ['Right', -1]] as const) {
      const restDir = pos(`${side}ForeArm`).sub(pos(`${side}Arm`)).normalize();
      const want = new THREE.Vector3(Math.sin(0.09) * sx, -Math.cos(0.09), 0.02).normalize();
      this.fix.set(`${side}Arm`, new THREE.Quaternion().setFromUnitVectors(restDir, want));
    }
  }

  /**
   * Pose a bone with a rotation expressed in character space (X = her left, Y = up,
   * Z = forward), composed on its rest pose. Rig-independent: bone axes don't matter.
   */
  rotate(name: BoneName, x: number, y = 0, z = 0) {
    const b = this.get(name);
    const e = _q.setFromEuler(_eul.set(x, y, z, 'XYZ'));
    const f = this.fix.get(name);
    if (f) e.multiply(f);
    // local = rest * (R^-1 * E * R)
    const local = this.restModelInv.get(name)!.clone().multiply(e).multiply(this.restModel.get(name)!);
    b.quaternion.copy(this.rest.get(name)!).multiply(local);
  }

  /**
   * Add a rotation on top of the current pose, in character space (like `rotate`, but
   * layered instead of absolute). `charQ` is the character root's world rotation.
   */
  nudge(name: BoneName, charQ: THREE.Quaternion, x: number, y = 0, z = 0) {
    const b = this.get(name);
    _q.setFromEuler(_eul.set(x, y, z, 'XYZ'));
    _q.premultiply(charQ).multiply(_pqi.copy(charQ).invert());     // to world
    b.parent!.getWorldQuaternion(_pq);
    b.quaternion.premultiply(_pq).premultiply(_q).premultiply(_pq.invert());
    b.updateMatrixWorld(true);
  }

  /** Call after all posing and IK for the frame. Helpers share their bone's parent and rest. */
  driveHelpers() {
    for (const h of this.helpers) h.helper.quaternion.copy(h.rest).slerp(h.bone.quaternion, 0.5);
    for (const t of this.twists) {
      // Swing-twist split of the hand's rotation (relative to rest) about the forearm axis.
      const d = _q.copy(t.handRestInv).multiply(t.hand.quaternion);
      const proj = d.x * t.axisH.x + d.y * t.axisH.y + d.z * t.axisH.z;
      let angle = 2 * Math.atan2(proj, d.w);
      angle = Math.atan2(Math.sin(angle), Math.cos(angle));
      t.bone.quaternion.copy(t.rest).multiply(_pq.setFromAxisAngle(t.axisT, angle * 0.6));
    }
  }

  get(name: BoneName) {
    return this.bones.get(name)!;
  }

  resetPose() {
    for (const [n, b] of this.bones) b.quaternion.copy(this.rest.get(n)!);
  }

  /**
   * Rotate a bone so the direction toward `childWorld` points at `targetWorld`.
   * Works for any rig orientation because it only uses world positions.
   */
  aim(bone: THREE.Object3D, childWorld: THREE.Vector3, targetWorld: THREE.Vector3, weight = 1) {
    bone.getWorldPosition(_a);
    const from = _b.subVectors(childWorld, _a).normalize();
    const to = _c.subVectors(targetWorld, _a).normalize();
    _q.setFromUnitVectors(from, to);
    bone.parent!.getWorldQuaternion(_pq);
    _pqi.copy(_pq).invert();
    _orig.copy(bone.quaternion);
    // local' = parent^-1 * q * parent * local
    bone.quaternion.premultiply(_pq).premultiply(_q).premultiply(_pqi);
    if (weight < 1) bone.quaternion.copy(_orig.slerp(bone.quaternion, weight));
    bone.updateMatrixWorld(true);
  }

  /** Analytic two-bone IK (e.g. arm: upper -> lower -> end). */
  twoBone(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D,
    target: THREE.Vector3, pole: THREE.Vector3, weight = 1) {
    if (weight <= 0) return;
    upper.getWorldPosition(_a);
    lower.getWorldPosition(_b);
    end.getWorldPosition(_c);
    const la = _a.distanceTo(_b);
    const lb = _b.distanceTo(_c);
    _t.subVectors(target, _a);
    const dist = THREE.MathUtils.clamp(_t.length(), 0.01, la + lb - 0.001);
    const dir = _t.normalize().clone();
    const poleDir = _e.subVectors(pole, _a);
    poleDir.addScaledVector(dir, -poleDir.dot(dir)).normalize();
    const cosA = THREE.MathUtils.clamp((la * la + dist * dist - lb * lb) / (2 * la * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const elbow = _a.clone().addScaledVector(dir, la * cosA).addScaledVector(poleDir, la * sinA);
    const reach = _a.clone().addScaledVector(dir, dist);

    this.aim(upper, _b.clone(), elbow, weight);
    lower.getWorldPosition(_b);
    end.getWorldPosition(_c);
    this.aim(lower, _c.clone(), reach, weight);
  }
}
