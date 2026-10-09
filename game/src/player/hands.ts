import * as THREE from 'three/webgpu';

/**
 * Finger posing for rigs with 3-joint fingers (`LeftHandIndex1..3` etc.).
 * Each joint curls about an axis measured at bind time (finger direction × palm normal),
 * so it works whatever the bone orientations are. Curl 0 = the scan's rest pose,
 * 1 = closed toward the palm, negative = straightened.
 */
export type Finger = 'Thumb' | 'Index' | 'Middle' | 'Ring' | 'Pinky';
/** Curl per finger (0 rest, 1 closed, <0 straightened) plus `spread` (fingers fan apart). */
export type HandPose = Record<Finger, number> & { spread: number };

export const POSES: Record<string, HandPose> = {
  rest: { Thumb: 0, Index: 0, Middle: 0, Ring: 0, Pinky: 0, spread: 0 },
  relaxed: { Thumb: 0.1, Index: 0.04, Middle: 0.1, Ring: 0.16, Pinky: 0.22, spread: 0.3 },
  /** The gentle touch: index out, the others folded softly. */
  point: { Thumb: 0.35, Index: -0.3, Middle: 0.5, Ring: 0.6, Pinky: 0.66, spread: 0.1 },
  /** Open and reaching: fingers long and apart (feeling the air, bracing). */
  open: { Thumb: -0.1, Index: -0.1, Middle: -0.05, Ring: 0, Pinky: 0.05, spread: 1 },
};
const SPREAD = { Thumb: 0, Index: 7, Middle: 0, Ring: -6, Pinky: -13 } as const;   // degrees at spread 1

const FINGERS: Finger[] = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const MAX = [55, 80, 50].map(THREE.MathUtils.degToRad);   // per joint, knuckle -> tip
const THUMB_MAX = [25, 40, 35].map(THREE.MathUtils.degToRad);

interface Joint { bone: THREE.Object3D; rest: THREE.Quaternion; R: THREE.Quaternion; Rinv: THREE.Quaternion; axis: THREE.Vector3; spreadAxis?: THREE.Vector3 }

const _q = new THREE.Quaternion();
const _s = new THREE.Quaternion();

export class Hands {
  private joints = new Map<string, Joint[]>(); // key `${side}${finger}`
  readonly available: boolean;

  /** `root` must be the character root at identity when constructed. */
  constructor(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const rootInvQ = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const rootInvM = root.matrixWorld.clone().invert();
    const pos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInvM);
    for (const side of ['Left', 'Right']) {
      const hand = root.getObjectByName(`${side}Hand`);
      const b = (f: Finger, i: number) => root.getObjectByName(`${side}Hand${f}${i}`);
      if (!hand || !b('Middle', 1)) continue;
      // Palm normal: the way the scan's relaxed fingers already bend.
      const m1 = pos(b('Middle', 1)!), m2 = pos(b('Middle', 2)!), m3 = pos(b('Middle', 3)!);
      const fdir = m2.clone().sub(m1).normalize();
      const bend = m3.clone().sub(m2).normalize().sub(m1.clone().sub(pos(hand)).normalize());
      let palm = bend.addScaledVector(fdir, -bend.dot(fdir));
      if (palm.lengthSq() < 1e-6) {
        const lateral = pos(b('Index', 1)!).sub(pos(b('Pinky', 1)!)).normalize();
        palm = new THREE.Vector3().crossVectors(fdir, lateral).multiplyScalar(side === 'Left' ? 1 : -1);
      }
      palm.normalize();
      for (const f of FINGERS) {
        const js: Joint[] = [];
        for (let i = 1; i <= 3; i++) {
          const bone = b(f, i);
          if (!bone) continue;
          const next = b(f, i + 1) ?? bone.children.find((c) => c.name.endsWith('IndexTip'));
          const a = pos(bone);
          const dir = next ? pos(next).sub(a).normalize() : a.clone().sub(pos(b(f, i - 1) ?? hand)).normalize();
          const axis = new THREE.Vector3().crossVectors(dir, palm).normalize();
          const R = rootInvQ.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
          const j: Joint = { bone, rest: bone.quaternion.clone(), R, Rinv: R.clone().invert(), axis };
          // Knuckles fan about the palm normal, away from the middle finger.
          if (i === 1 && f !== 'Thumb' && f !== 'Middle') {
            const away = a.clone().sub(m1); away.addScaledVector(palm, -away.dot(palm));
            if (away.lengthSq() > 1e-8) j.spreadAxis = new THREE.Vector3().crossVectors(dir, away.normalize()).normalize();
          }
          js.push(j);
        }
        if (js.length) this.joints.set(side + f, js);
      }
    }
    this.available = this.joints.size > 0;
  }

  /** Set a hand's pose (blend of two poses by `k`), absolute on top of rest. */
  apply(side: 'Left' | 'Right', a: HandPose, b: HandPose = a, k = 0) {
    for (const f of FINGERS) {
      const js = this.joints.get(side + f);
      if (!js) continue;
      const curl = THREE.MathUtils.lerp(a[f], b[f], k);
      const spread = THREE.MathUtils.lerp(a.spread, b.spread, k) * Math.abs(SPREAD[f]) * THREE.MathUtils.DEG2RAD;
      js.forEach((j, i) => {
        const ang = curl * (f === 'Thumb' ? THUMB_MAX : MAX)[i];
        _q.setFromAxisAngle(j.axis, ang);
        if (j.spreadAxis) _q.premultiply(_s.setFromAxisAngle(j.spreadAxis, spread));
        // local = rest * (R^-1 * E * R): rotation expressed in character space.
        j.bone.quaternion.copy(j.rest).multiply(j.Rinv.clone().multiply(_q).multiply(j.R));
      });
    }
  }
}
