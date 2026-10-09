import * as THREE from 'three/webgpu';
import {
  color, float, mix, smoothstep, positionLocal, mx_worley_noise_vec2, mx_fractal_noise_float, uniform,
} from 'three/tsl';
import { PALETTE } from '../core/palette';

/**
 * Stand-in body until the image-to-3D character is rigged. It uses the same bone
 * names as the real rig (see rig.ts) and faces +Z (glTF convention).
 * Anatomical LEFT = +X. The cyan port is on the LEFT shoulder (continuity lock).
 */

function ceramicMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const cells = mx_worley_noise_vec2(positionLocal.mul(16.0));
  const plate = smoothstep(0.03, 0.09, cells.y.sub(cells.x));
  const chip = smoothstep(0.55, 0.7, mx_fractal_noise_float(positionLocal.mul(30.0), 2, 2, 0.5).add(0.5));
  const ivory = mix(color(PALETTE.ceramic), color(PALETTE.bone), chip.mul(0.5));
  m.colorNode = mix(color(PALETTE.joint), ivory, plate);
  m.roughnessNode = mix(float(0.75), float(0.34), plate);
  m.metalnessNode = float(0.0);
  return m;
}

function jointMaterial() {
  return new THREE.MeshStandardNodeMaterial({ color: PALETTE.joint, roughness: 0.45, metalness: 0.5 });
}

function hairMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.55 });
  // Darker roots near the scalp, silver-white at the tips.
  const root = smoothstep(0.02, 0.09, positionLocal.length());
  m.colorNode = mix(color(0x3a3b3d), color(PALETTE.hair), root);
  return m;
}

export const uPortGlow = uniform(1.0);
/** 0 = her painted cyan (port, fibres) as it is; 1 = gone dark (the blackout, S24–S25). */
export const uPortDark = uniform(0.0);

function cyanMaterial() {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = color(PALETTE.cyan).mul(uPortGlow.mul(5.0));
  return m;
}

function bone(name: string, parent: THREE.Object3D, x: number, y: number, z: number) {
  const b = new THREE.Object3D();
  b.name = name;
  b.position.set(x, y, z);
  parent.add(b);
  return b;
}

/** Capsule from a bone toward its child offset. */
function limb(parent: THREE.Object3D, to: THREE.Vector3, r0: number, mat: THREE.Material, rScale = 1) {
  const len = to.length();
  const geo = new THREE.CapsuleGeometry(r0, Math.max(0.001, len - r0 * 0.6), 4, 10);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().normalize());
  mesh.scale.set(rScale, 1, 1);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function blob(parent: THREE.Object3D, pos: [number, number, number], scale: [number, number, number], mat: THREE.Material) {
  const geo = new THREE.SphereGeometry(1, 20, 14);
  geo.scale(...scale);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...pos);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

export interface Placeholder {
  root: THREE.Group;      // world placement + yaw
  pivot: THREE.Group;     // hips pivot, used for lying / crouching
  fingertip: THREE.Object3D; // right index tip, for touch contact
  hipsHeight: number;
  /** Optional: drive eyelid geometry (morph targets) with the blink value, 0..1. */
  setBlink?: (v: number) => void;
  /** Its own shader state (blink, wet marks); the woman's are the shared globals. */
  u?: import('./character').CharacterUniforms;
}

export function createPlaceholder(): Placeholder {
  const ceramic = ceramicMaterial();
  const joint = jointMaterial();
  const hair = hairMaterial();
  const cyan = cyanMaterial();

  const root = new THREE.Group();
  root.name = 'player';
  const pivot = new THREE.Group();
  root.add(pivot);
  const hipsHeight = 0.96;
  pivot.position.y = hipsHeight;

  const hips = bone('Hips', pivot, 0, 0, 0);
  blob(hips, [0, 0.02, 0], [0.15, 0.1, 0.1], ceramic);
  const spine = bone('Spine', hips, 0, 0.1, 0);
  limb(spine, new THREE.Vector3(0, 0.12, 0), 0.085, joint, 1.25);
  const spine1 = bone('Spine1', spine, 0, 0.12, 0);
  blob(spine1, [0, 0.03, 0], [0.13, 0.1, 0.09], ceramic);
  const spine2 = bone('Spine2', spine1, 0, 0.12, 0);
  blob(spine2, [0, 0.07, 0.005], [0.155, 0.13, 0.1], ceramic);
  const neck = bone('Neck', spine2, 0, 0.17, 0);
  limb(neck, new THREE.Vector3(0, 0.08, 0), 0.04, joint);
  // Cyan neck fibers.
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.07, 4), cyan);
    f.position.set(0.036 * s, 0.04, -0.005);
    f.rotation.z = 0.25 * s;
    neck.add(f);
  }
  const head = bone('Head', neck, 0, 0.08, 0);
  blob(head, [0, 0.085, 0.01], [0.085, 0.105, 0.095], ceramic);
  // Tousled hair: overlapping elongated blobs, darker at the roots.
  const hairGroup = new THREE.Group();
  hairGroup.position.set(0, 0.11, -0.005);
  head.add(hairGroup);
  const tufts: [number, number, number, number][] = [
    [0, 0.05, 0, 0], [0.05, 0.03, 0.03, 0.5], [-0.05, 0.03, 0.03, -0.5], [0.07, -0.01, -0.02, 0.9],
    [-0.07, -0.01, -0.02, -0.9], [0, 0.02, -0.07, 0], [0.04, -0.03, -0.07, 0.6], [-0.04, -0.03, -0.07, -0.6],
    [0.02, 0.02, 0.08, 0.2], [-0.03, 0.01, 0.085, -0.3], [0.075, -0.05, 0.03, 1.1], [-0.075, -0.05, 0.03, -1.1],
  ];
  for (const [x, y, z, rz] of tufts) {
    const t = blob(hairGroup, [x, y, z], [0.045, 0.075, 0.045], hair);
    t.rotation.set(z * 5, 0, -rz);
  }

  // Arms (rest pose: hanging, slightly out).
  const arms: Record<string, THREE.Object3D> = {};
  for (const [side, sx] of [['Left', 1], ['Right', -1]] as const) {
    const sh = bone(`${side}Shoulder`, spine2, 0.05 * sx, 0.13, 0);
    const arm = bone(`${side}Arm`, sh, 0.12 * sx, 0, 0);
    blob(arm, [0.005 * sx, -0.005, 0], [0.058, 0.055, 0.055], ceramic);
    limb(arm, new THREE.Vector3(0, -0.27, 0), 0.043, ceramic);
    const fore = bone(`${side}ForeArm`, arm, 0, -0.27, 0);
    blob(fore, [0, 0, 0], [0.036, 0.036, 0.036], joint);
    limb(fore, new THREE.Vector3(0, -0.24, 0), 0.036, ceramic);
    const hand = bone(`${side}Hand`, fore, 0, -0.24, 0);
    limb(hand, new THREE.Vector3(0, -0.085, 0.004), 0.028, ceramic, 1.25);
    // Fingers: index extended, the rest gently curled.
    const fingers: [number, number, number][] = [[0.022, 0.1, 0], [0.007, 0.09, 0.25], [-0.008, 0.085, 0.4], [-0.021, 0.07, 0.55]];
    fingers.forEach(([fx, fl, curl], i) => {
      const fb = new THREE.Object3D();
      fb.position.set(fx * -sx, -0.085, 0.005);
      fb.rotation.x = -curl;
      hand.add(fb);
      limb(fb, new THREE.Vector3(0, -fl, 0), 0.0105, i === 0 ? ceramic : joint);
      if (i === 0 && side === 'Right') {
        const tip = new THREE.Object3D();
        tip.name = 'RightIndexTip';
        tip.position.set(0, -fl - 0.01, 0);
        fb.add(tip);
      }
    });
    const thumb = new THREE.Object3D();
    thumb.position.set(-0.028 * sx, -0.03, 0.02);
    thumb.rotation.set(-0.5, 0, 0.5 * sx);
    hand.add(thumb);
    limb(thumb, new THREE.Vector3(0, -0.06, 0), 0.011, joint);
    arms[side] = arm;
  }

  // Shoulder port on the anatomical LEFT upper arm, facing outward (+X).
  const port = new THREE.Group();
  port.name = 'LeftShoulderPort';
  port.position.set(0.058, -0.02, 0);
  port.rotation.z = -Math.PI / 2;
  arms.Left.add(port);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0055, 8, 32), cyan);
  ring.rotation.x = Math.PI / 2;
  port.add(ring);
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 20), joint);
  port.add(socket);

  // Legs.
  for (const [side, sx] of [['Left', 1], ['Right', -1]] as const) {
    const up = bone(`${side}UpLeg`, hips, 0.085 * sx, -0.05, 0);
    limb(up, new THREE.Vector3(0, -0.43, 0), 0.068, ceramic);
    const leg = bone(`${side}Leg`, up, 0, -0.43, 0);
    blob(leg, [0, 0, 0.01], [0.05, 0.05, 0.05], joint);
    limb(leg, new THREE.Vector3(0, -0.41, 0), 0.05, ceramic);
    const foot = bone(`${side}Foot`, leg, 0, -0.41, 0);
    limb(foot, new THREE.Vector3(0, -0.05, 0.12), 0.034, ceramic);
    bone(`${side}ToeBase`, foot, 0, -0.05, 0.12);
  }

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
  });

  const fingertip = root.getObjectByName('RightIndexTip')!;
  return { root, pivot, fingertip, hipsHeight };
}
