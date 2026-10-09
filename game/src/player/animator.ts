import * as THREE from 'three/webgpu';
import { Rig } from './rig';

/**
 * Procedural poses, authored in character space so they drive any rig that follows the
 * bone-name contract (placeholder or the real character). Clip-based animation can
 * replace or layer on top of this later; the IK layer (reach) and the state stay the same.
 */
export interface PoseState {
  speed: number;   // m/s over ground
  phase: number;   // gait phase, radians
  kneel: number;   // 0..1
  lie: number;     // 0..1 curled on her side
  lean: number;    // extra forward torso lean, radians
  breath: number;  // time
  headPitch: number; // look down (+) / up (-)
  accel?: number;    // forward acceleration, m/s² (smoothed)
  turn?: number;     // turning rate, rad/s (+ = toward her left)
  step?: number;     // 0..1 small steps while turning on the spot
  still?: number;    // seconds standing still with the player in control (idle gestures)
  run?: number;      // eased walk/run blend, shared with foot contact and cadence
}

/** Smooth, non-repeating wobble from a few incommensurate sines (-1..1). */
/** A soft bump (0..1..0) lasting `len` seconds once every `period`, starting at `phase`. */
function every(t: number, period: number, len: number, phase: number) {
  const x = (((t - phase) % period) + period) % period;
  if (x > len) return 0;
  const k = x / len;
  // Ease in, hold, ease out.
  return THREE.MathUtils.smoothstep(k, 0, 0.3) * (1 - THREE.MathUtils.smoothstep(k, 0.7, 1));
}

function drift(t: number, seed: number) {
  return (Math.sin(t * 0.31 + seed) * 0.5 + Math.sin(t * 0.73 + seed * 2.1) * 0.3 + Math.sin(t * 1.37 + seed * 3.7) * 0.2);
}

function rot(rig: Rig, name: Parameters<Rig['get']>[0], x: number, y = 0, z = 0) {
  rig.rotate(name, x, y, z);
}

const lerp = THREE.MathUtils.lerp;
const D = THREE.MathUtils.DEG2RAD;

/**
 * Walking gait curves (degrees over one stride, heel strike at 0, toe-off near 0.6), after
 * clinical gait data: hip flexion, knee flexion (a small dip as weight lands, a big bend in
 * swing) and ankle dorsiflexion (foot slaps flat, rolls over, pushes off, clears the ground).
 */
const HIP: [number, number][] = [[0, 25], [0.1, 22], [0.2, 14], [0.3, 5], [0.4, -4], [0.5, -10], [0.56, -10], [0.62, -4], [0.7, 8], [0.8, 20], [0.9, 26]];
const KNEE: [number, number][] = [[0, 3], [0.08, 12], [0.15, 18], [0.25, 11], [0.4, 4], [0.5, 9], [0.6, 36], [0.7, 58], [0.75, 60], [0.82, 48], [0.92, 16]];
const ANKLE: [number, number][] = [[0, 0], [0.07, -6], [0.2, 4], [0.45, 10], [0.55, -3], [0.62, -16], [0.7, -9], [0.8, 3], [0.9, 2]];

/**
 * Running (after clinical running data): contact only ~38% of the stride, then flight; the
 * knee takes the landing (~40°) and folds deep in swing (~100°), the hip reaches further
 * forward, the ankle pushes off hard.
 */
const RHIP: [number, number][] = [[0, 28], [0.1, 20], [0.2, 8], [0.3, -4], [0.38, -12], [0.45, -5], [0.55, 15], [0.65, 33], [0.75, 45], [0.85, 42], [0.93, 34]];
const RKNEE: [number, number][] = [[0, 20], [0.1, 38], [0.18, 40], [0.3, 28], [0.38, 22], [0.5, 60], [0.62, 95], [0.7, 100], [0.8, 75], [0.9, 35], [0.96, 22]];
const RANKLE: [number, number][] = [[0, 5], [0.1, 18], [0.18, 20], [0.3, 5], [0.38, -20], [0.5, -10], [0.65, 0], [0.85, 5]];

/** How much of the run gait is in use at this speed (0 walking .. 1 running). */
export function runAmount(speed: number) {
  return THREE.MathUtils.smoothstep(speed / 1.4, 1.25, 1.9);
}

/** Where a foot stops carrying weight in the stride (walk 0.6, run 0.38). */
export function stanceEnd(speed: number, run = runAmount(speed)) {
  return THREE.MathUtils.lerp(0.6, 0.38, run);
}

/** Full strides per second, shared by the pose and the foot-placement solver. */
export function strideFrequency(speed: number, run = runAmount(speed)) {
  return lerp(0.78 + Math.min(speed, 1.75) * 0.22, 1.3 + speed * 0.1, run);
}

/** Cyclic Catmull-Rom through (phase, value) keys. */
function curve(keys: [number, number][], x: number) {
  x = ((x % 1) + 1) % 1;
  const n = keys.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) if (keys[k][0] <= x) i = k;
  const at = (k: number) => keys[((k % n) + n) % n];
  const x1 = at(i)[0], x2 = i + 1 < n ? at(i + 1)[0] : 1 + at(0)[0];
  const t = (x - x1) / (x2 - x1);
  const p0 = at(i - 1)[1], p1 = at(i)[1], p2 = at(i + 1)[1], p3 = at(i + 2)[1];
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/** The phase within each leg's stride (left heel strikes at 0, right half a stride later). */
export function legPhases(phase: number) {
  const c = phase / (Math.PI * 2);
  return { L: ((c % 1) + 1) % 1, R: (((c + 0.5) % 1) + 1) % 1 };
}

export class ProceduralAnimator {
  constructor(private rig: Rig, private pivot: THREE.Object3D, private hipsHeight: number) {}

  apply(s: PoseState) {
    const rig = this.rig;
    rig.resetPose();

    const w = Math.min(s.speed / 1.4, 2.2);
    // Turning on the spot borrows the gait at a short stride.
    const stepW = (s.step ?? 0) * 0.5;
    const walk = Math.max(Math.min(w, 1), stepW) * (1 - s.kneel) * (1 - s.lie);
    const sw = Math.sin(s.phase);
    // Stride: longer steps as she speeds up; turning on the spot takes short ones.
    const shortStep = stepW > Math.min(w, 1) ? 0.45 : 1;
    // Scaled so a planted foot sweeps about as far as the body travels over it.
    const hipK = THREE.MathUtils.clamp(0.75 + 0.6 * Math.min(w, 1.4), 0.6, 1.6) * shortStep * walk;
    const kneeK = walk;
    const run = (s.run ?? runAmount(s.speed)) * (1 - s.kneel) * (1 - s.lie);
    const runHipK = THREE.MathUtils.clamp(0.85 + 0.25 * (w - 1.4), 0.85, 1.2) * walk;
    const ph = legPhases(s.phase);
    const gait = (walkKeys: [number, number][], runKeys: [number, number][], p: number, kw: number, kr: number) =>
      lerp(curve(walkKeys, p) * kw, curve(runKeys, p) * kr, run) * D;

    // Standing / walking / running legs, from the gait curves (thigh: negative = forward).
    let lThigh = -gait(HIP, RHIP, ph.L, hipK, runHipK);
    let rThigh = -gait(HIP, RHIP, ph.R, hipK, runHipK);
    let lKnee = gait(KNEE, RKNEE, ph.L, kneeK, walk) + 0.05;
    let rKnee = gait(KNEE, RKNEE, ph.R, kneeK, walk) + 0.05;
    const lAnkle = gait(ANKLE, RANKLE, ph.L, walk * shortStep, walk);
    const rAnkle = gait(ANKLE, RANKLE, ph.R, walk * shortStep, walk);

    // Low kneel: left foot planted and deeply bent, right shin resting on the ground.
    lThigh = lerp(lThigh, -1.3, s.kneel);
    lKnee = lerp(lKnee, 2.4, s.kneel);
    rThigh = lerp(rThigh, -0.9, s.kneel);
    rKnee = lerp(rKnee, 2.4, s.kneel);

    // Lie: loose fetal curl.
    lThigh = lerp(lThigh, -1.5, s.lie);
    rThigh = lerp(rThigh, -1.25, s.lie);
    lKnee = lerp(lKnee, 1.9, s.lie);
    rKnee = lerp(rKnee, 2.1, s.lie);

    // Standing still: weight drifts from leg to leg every several seconds; the unloaded knee
    // softens and the hips roll over the loaded side while the shoulders stay level.
    const t = s.breath;
    const idle = (1 - Math.min(1, w * 1.5)) * (1 - s.kneel) * (1 - s.lie);
    const shift = (Math.sin(t * 0.8) * 0.8 + Math.sin(t * 0.37 + 1) * 0.5) / 1.3 * idle;   // + = weight on her left leg
    lKnee += Math.max(0, -shift) * 0.14;
    rKnee += Math.max(0, shift) * 0.14;

    // Torso lean: most of it bends at the hip joint (pelvis tilt), the rest through the spine.
    // Speeding up tips her forward, slowing down rocks her back.
    const breath = Math.sin(t * 1.6);
    const breathe = breath * 0.012;
    const moving = (1 - s.kneel) * (1 - s.lie);
    const accelLean = THREE.MathUtils.clamp((s.accel ?? 0) * 0.05, -0.1, 0.14) * moving;
    const lean = s.lean + 0.06 * walk * Math.min(w, 1.3) + 0.14 * run + 0.3 * s.kneel + 0.35 * s.lie + accelLean;
    const pelvis = lean * 0.5;
    // Bank into turns (more at speed).
    const bank = THREE.MathUtils.clamp(-(s.turn ?? 0) * Math.min(s.speed, 3) * 0.045, -0.12, 0.12) * moving;
    // Walking pelvis: turns with the stride and drops on the swing side; the spine counters it.
    const cw = Math.cos(s.phase);
    // Contrapposto: the loaded side's hip rides higher.
    const hipRoll = cw * 0.035 * walk + shift * 0.045 + bank;
    rot(rig, 'Hips', pelvis, sw * 0.09 * walk, hipRoll);

    // Thighs are children of the hips: subtract the tilt to keep their world angle.
    rot(rig, 'LeftUpLeg', lThigh - pelvis, 0, 0.03 - shift * 0.045 - bank * 0.8);
    rot(rig, 'RightUpLeg', rThigh - pelvis, 0, -0.03 - shift * 0.045 - bank * 0.8);
    rot(rig, 'LeftLeg', lKnee);
    rot(rig, 'RightLeg', rKnee);
    // Feet: kept level with the ground, then rolled by the ankle curve (heel to toe).
    rot(rig, 'LeftFoot', -(lThigh + lKnee) * (1 - s.lie) * 0.9 - lAnkle);
    rot(rig, 'RightFoot', -(rThigh + rKnee) * (1 - s.lie) * (1 - s.kneel * 0.6) * 0.9 - rAnkle);
    // Toes bend as the heel lifts, before toe-off.
    const toeStart = lerp(0.42, 0.22, run), toeLen = lerp(0.22, 0.2, run);
    const toe = (p: number) => Math.max(0, Math.sin(THREE.MathUtils.clamp((p - toeStart) / toeLen, 0, 1) * Math.PI));
    rot(rig, 'LeftToeBase', -toe(ph.L) * 0.55 * walk);
    rot(rig, 'RightToeBase', -toe(ph.R) * 0.55 * walk);

    // Spine: counters the pelvis so the shoulders stay level; the chest lifts on each breath.
    const level = -(hipRoll - bank);
    rot(rig, 'Spine', lean * 0.2 + breathe, -sw * 0.1 * walk, -cw * 0.03 * walk + level * 0.6);
    rot(rig, 'Spine1', lean * 0.15, -sw * 0.04 * walk, level * 0.3);
    rot(rig, 'Spine2', lean * 0.15 - breathe * 1.3, -sw * 0.04 * walk, 0);
    // Shoulders rise a little on the in-breath.
    const lift = Math.max(0, breath) * 0.018 * (1 - s.lie);
    rot(rig, 'LeftShoulder', 0, 0, lift);
    rot(rig, 'RightShoulder', 0, 0, -lift);
    // Head: steadied against the stride (eyes stay level), leads into turns, and drifts a
    // little when idle, as a person's attention does.
    const lead = THREE.MathUtils.clamp((s.turn ?? 0) * 0.12, -0.25, 0.25) * moving;
    // Left a while (the player still too), she does more: now and then looks off to one side
    // (alternating), or down at the ground before her.
    const linger = idle * THREE.MathUtils.smoothstep(s.still ?? 0, 4, 9);
    const side = Math.floor((t - 2) / 13) % 2 === 0 ? 1 : -1;
    const lookAway = every(t, 13, 4.5, 2) * side * 0.5 * linger;
    const lookDown = every(t, 17, 3.6, 9) * 0.3 * linger;
    const hx = drift(t, 1.3) * 0.035 * idle + lookDown, hy = drift(t, 4.1) * 0.06 * idle + lookAway;
    rot(rig, 'Neck', s.headPitch * 0.4 + 0.15 * s.lie + hx * 0.4, sw * 0.05 * walk + lead * 0.4 + hy * 0.4, -level * 0.3);
    rot(rig, 'Head', s.headPitch * 0.6 + 0.2 * s.lie + hx * 0.6 - Math.abs(cw) * 0.02 * walk, sw * 0.04 * walk + lead * 0.6 + hy * 0.6);

    // Arms: swing from the shoulder with the elbow bending more on the back swing; at rest
    // they hang soft and follow the breath and the weight shift.
    // Each arm swings back as its own leg swings forward (a little behind it in time).
    const amp = lerp(0.3 + 0.14 * Math.max(0, Math.min(w, 1.3) - 1), 0.62, run) * walk * shortStep;
    const hn = (p: number) => lerp((curve(HIP, p - 0.04) - 7.5) / 17.5, (curve(RHIP, p - 0.04) - 16.5) / 28.5, run);
    const la = hn(ph.L) * amp, ra = hn(ph.R) * amp;
    const hang = drift(t, 7.7) * 0.03 * idle;
    rot(rig, 'LeftArm', la + lerp(0, -1.0, s.lie) + hang + breathe * 0.5, 0, 0.02 * breathe - shift * 0.03 + Math.max(0, la) * 0.06);
    rot(rig, 'RightArm', ra + lerp(0, -1.1, s.lie) - hang + breathe * 0.5, 0, -shift * 0.03 - Math.max(0, ra) * 0.06);
    // Elbows bend more on the forward swing.
    // Running holds the elbows near a right angle.
    const elbow = -0.22 - 1.05 * run;
    rot(rig, 'LeftForeArm', elbow - Math.max(0, -la) * lerp(1.1, 0.5, run) - Math.max(0, la) * 0.3 + lerp(0, -1.3, s.lie) + drift(t, 2.2) * 0.04 * idle);
    rot(rig, 'RightForeArm', elbow - Math.max(0, -ra) * lerp(1.1, 0.5, run) - Math.max(0, ra) * 0.3 + lerp(0, -1.2, s.lie) + drift(t, 5.4) * 0.04 * idle);

    // Kneeling still derives its height from the folded legs. Locomotion is supported by
    // planted feet in Player: choosing the longest animated leg each frame made the pelvis
    // fall with the swing leg (up to 15 cm during a walk).
    const { thigh, shin, ankle, hipOffset } = rig.legs;
    const legH = (t: number, k: number) => thigh * Math.cos(t) + shin * Math.cos(t + k);
    const standH = Math.max(legH(lThigh, lKnee), legH(rThigh, rKnee)) + ankle + hipOffset;
    // Low at double support, high as the body passes over the planted foot.
    const walkY = this.hipsHeight - (0.022 + 0.012 * Math.cos(s.phase * 2)) * walk;
    // Running compresses after landing and rises during the flight between contacts.
    const runY = this.hipsHeight - 0.065 - 0.035 * Math.cos(s.phase * 2 - Math.PI * 0.64);
    const hipsY = lerp(lerp(walkY, runY, run), Math.min(this.hipsHeight, standH), s.kneel);

    this.pivot.position.y = lerp(hipsY, 0.17, s.lie);
    // Weight shifts over the standing foot.
    this.pivot.position.x = lerp(sw * 0.018 * walk + shift * 0.022, 0.1, s.lie);
    this.pivot.rotation.z = (s.lie * Math.PI) / 2;
    this.pivot.updateMatrixWorld(true);
  }
}
