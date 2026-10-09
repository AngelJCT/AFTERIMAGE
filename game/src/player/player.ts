import * as THREE from 'three/webgpu';
import { Input } from '../core/input';
import { BOUNDS, heightAt, WATER_LEVEL } from '../world/terrain';
import { createPlaceholder, Placeholder } from './placeholder';
import { WOMAN, type CharacterUniforms } from './character';
import { Rig } from './rig';
import { ProceduralAnimator, PoseState, legPhases, runAmount, stanceEnd, strideFrequency } from './animator';
import { Hands, POSES } from './hands';

const LOOK_YAW = 0.95;   // look turn limit (spine, neck and head together), radians
const LOOK_UP = 0.35, LOOK_DOWN = 0.5;
/**
 * How a look is shared down the body: most of it in the neck and upper spine, only a little in
 * the head itself, so the head never twists far against the neck (the swapped-in head mesh
 * is rigid; its seam with the neck is where a big turn would shear).
 */
const LOOK_SHARE = [['Spine1', 0.12, 0.05], ['Spine2', 0.2, 0.15], ['Neck', 0.38, 0.4], ['Head', 0.3, 0.4]] as const;
const _lq = new THREE.Quaternion();
const _lpq = new THREE.Quaternion();
const _lv = new THREE.Vector3();
const _lv2 = new THREE.Vector3();
const _cv = new THREE.Vector2(), _cv2 = new THREE.Vector2(), _cv3 = new THREE.Vector2();

const WALK = 1.35;
const RUN = 3.0;

export class Player {
  body: Placeholder;
  /** Its shader state (the woman's shared uniforms unless the body brings its own). */
  u: CharacterUniforms;
  rig: Rig;
  anim: ProceduralAnimator;
  pose: PoseState = { speed: 0, phase: 0, kneel: 0, lie: 0, lean: 0, breath: 0, headPitch: 0 };

  position = new THREE.Vector3();
  yaw = 0;              // facing, radians (0 = +Z)
  velocity = new THREE.Vector3();
  /** The wind where she stands (world XZ, ~0..2), set each frame by the game; moves her hair. */
  wind = new THREE.Vector3();
  private hair = new THREE.Vector3();
  private hairVel = new THREE.Vector3();
  controllable = false;
  /** Story control of her eyelids: 0 open .. 1 closed. Idle blinks happen on top. */
  eyelids = 0;
  private nextBlink = 2 + Math.random() * 3;
  private blinkT = -1;

  /** Scripted walking direction (world XZ) for cinematic moments; overrides input. */
  autopilot: THREE.Vector3 | null = null;
  /** Standing on something that moves (a lift): its height instead of the ground's. */
  floorY: (() => number) | null = null;
  /** Speed while on autopilot (m/s); a run is about 3. */
  autopilotSpeed = WALK * 0.75;

  /** Right-hand reach: world-space wrist target and blend weight. */
  reachTarget = new THREE.Vector3();
  reachWeight = 0;
  /** 0 = pointing touch (index leads), 1 = open palm laid flat. */
  handOpen = 0;
  /** Extra spread of the open hand (a guided hand relaxes). */
  handSpread = 0;
  /** 0 = palm down (water), 1 = palm facing out with fingers up (bark, bracing). */
  palmUp = 0;
  /** 0 = as above, 1 = palm turned up with the fingers forward (holding a weight from below). */
  supinate = 0;
  /** Left-arm reach (both hands brace together), wrist target and weight. */
  leftReachTarget = new THREE.Vector3();
  leftReachWeight = 0;
  /** Where the left fingers point while reaching (world; null: forward and up, bracing). */
  leftAim: THREE.Vector3 | null = null;
  /** Left hand closed around something (0 open .. 1 a loose fist). */
  leftGrip = 0;
  /** Left elbow tucked down at her side instead of out (holding something close). */
  leftElbowDown = 0;

  hands: Hands;
  /** Story-set gaze target (world). Overrides `interests` while set. */
  lookTarget: THREE.Vector3 | null = null;
  /** Things she notices while free: the nearest one in front of her draws her head. */
  interests: THREE.Vector3[] = [];
  /** How much the gaze is allowed (story beats that pose the head set this to 0). */
  lookWeight = 1;
  private look = { yaw: 0, pitch: 0 };
  private flinchT = -1;
  private flinchAmp = 0;
  private point = 0;
  private handBones: Partial<Record<'Left' | 'Right', { tip: THREE.Object3D; i1?: THREE.Object3D; p1?: THREE.Object3D }>> = {};

  onFootstep?: (x: number, z: number, speed: number) => void;
  /** Ground-plane capsules she can't walk through (tree trunks, the fallen giant, ruins). */
  blockers: { a: THREE.Vector2; b: THREE.Vector2; r: number }[] = [];
  /** Where she may walk: the union of these ground-plane capsules (a == b for a circle). */
  areas: { a: THREE.Vector2; b: THREE.Vector2; r: number }[] = [
    { a: new THREE.Vector2(BOUNDS.x, BOUNDS.z), b: new THREE.Vector2(BOUNDS.x, BOUNDS.z), r: BOUNDS.r },
  ];

  // Landmarks captured at bind time, in the local space of the bone that carries them.
  private eyeLocal = new THREE.Vector3();      // her LEFT eye (the fissure side), Head space
  private faceLocal = new THREE.Vector3();     // face forward, Head space
  private port: THREE.Object3D | null = null;  // LeftShoulderPort (+Y = outward)

  private lastContactPhase = { Left: 0, Right: 0.5 };
  private lastYaw = 0;

  constructor(scene: THREE.Scene, body: Placeholder = createPlaceholder()) {
    this.body = body;
    this.u = body.u ?? WOMAN;
    scene.add(this.body.root);
    this.rig = new Rig(this.body.root);
    this.anim = new ProceduralAnimator(this.rig, this.body.pivot, this.body.hipsHeight);
    this.hands = new Hands(this.body.root);

    // Root is still at the origin with identity rotation: model space == world space here.
    const head = this.rig.get('Head');
    head.updateWorldMatrix(true, false);
    const headPos = head.getWorldPosition(new THREE.Vector3());
    this.eyeLocal = head.worldToLocal(headPos.clone().add(new THREE.Vector3(0.032, 0.047, 0.095)));
    const q = head.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.faceLocal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    this.port = this.body.root.getObjectByName('LeftShoulderPort') ?? null;
  }

  eyeWorld(out = new THREE.Vector3()) {
    return this.rig.get('Head').localToWorld(out.copy(this.eyeLocal));
  }

  faceDir(out = new THREE.Vector3()) {
    return out.copy(this.faceLocal).applyQuaternion(this.rig.get('Head').getWorldQuaternion(new THREE.Quaternion()));
  }

  /** Shoulder port position and outward normal (falls back to the left upper arm). */
  portWorld(pos = new THREE.Vector3(), normal = new THREE.Vector3()) {
    const o = this.port ?? this.rig.get('LeftArm');
    o.getWorldPosition(pos);
    normal.set(0, 1, 0).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
    if (!this.port) normal.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return { pos, normal };
  }

  get root() {
    return this.body.root;
  }

  place(p: THREE.Vector3, yaw: number) {
    this.position.set(p.x, heightAt(p.x, p.z), p.z);
    this.yaw = yaw;
    this.lastYaw = yaw;
    this.velocity.set(0, 0, 0);
    this.pose.accel = 0;
    this.pose.turn = 0;
    this.pose.speed = 0;
    this.pose.run = 0;
    this.pose.step = 0;
    this.pose.still = 0;
    this.footOffset = 0;
    this.pins.Left.p = null; this.pins.Right.p = null;
    this.pins.Left.target = null; this.pins.Right.target = null;
    this.pins.Left.rest = false; this.pins.Right.rest = false;
    const phases = legPhases(this.pose.phase);
    this.lastContactPhase = { Left: phases.L, Right: phases.R };
  }

  update(dt: number, t: number, input: Input, cameraYaw: number) {
    // Scripted alignment moves (e.g. stepping up to the receiver) can reposition her
    // directly without locomotion. Do not leave idle anchors behind at the old mark.
    if (!this.controllable && !this.autopilot
      && Math.hypot(this.position.x - this.root.position.x, this.position.z - this.root.position.z) > 0.002) {
      for (const pin of Object.values(this.pins)) { pin.p = null; pin.target = null; pin.rest = false; }
    }
    if (this.autopilot) {
      const wish = this.autopilot.clone().setY(0).normalize().multiplyScalar(this.autopilotSpeed);
      this.velocity.lerp(wish, 1 - Math.exp(-dt * 3));
      const want = Math.atan2(this.velocity.x, this.velocity.z);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * 4));
    } else if (this.controllable) {
      // Camera-relative movement.
      const fx = -Math.sin(cameraYaw), fz = -Math.cos(cameraYaw);
      const rx = -fz, rz = fx;
      const mx = input.move.x, my = input.move.y;
      const mag = Math.min(1, Math.hypot(mx, my));
      const target = input.running || mag > 0.95 && input.touch ? RUN : WALK;
      const wish = new THREE.Vector3(fx * my + rx * mx, 0, fz * my + rz * mx);
      if (wish.lengthSq() > 1e-4) wish.normalize().multiplyScalar(target * mag);
      // Water slows her down a little.
      const inWater = this.groundAt(this.position.x, this.position.z) < WATER_LEVEL - 0.05;
      if (inWater) wish.multiplyScalar(0.8);
      if (wish.lengthSq() > 1e-4) {
        // Turn toward the intention before accelerating into it. Reversing used to spin
        // the pelvis almost 180° in one step after velocity passed through zero.
        const want = Math.atan2(wish.x, wish.z);
        let d = want - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const limit = THREE.MathUtils.lerp(5.2, 3.8, runAmount(this.pose.speed)) * dt;
        this.yaw += THREE.MathUtils.clamp(d * (1 - Math.exp(-dt * 10)), -limit, limit);
        const alignment = Math.cos(want - this.yaw);
        wish.multiplyScalar(THREE.MathUtils.smoothstep(alignment, -0.1, 0.8));
      }
      const braking = wish.lengthSq() < this.velocity.lengthSq();
      this.velocity.lerp(wish, 1 - Math.exp(-dt * (braking ? 9 : 6)));
    } else {
      this.velocity.multiplyScalar(Math.exp(-dt * 8));
    }

    const oldX = this.position.x, oldZ = this.position.z;
    this.position.addScaledVector(this.velocity, dt);
    this.keepInside();
    this.collide();
    this.position.y = this.groundAt(this.position.x, this.position.z);

    // Animate the distance actually travelled, including sliding against world bounds.
    // Story scripts may supply velocity themselves; only constrain normal locomotion.
    if ((this.controllable || this.autopilot) && dt > 0) {
      this.velocity.x = (this.position.x - oldX) / dt;
      this.velocity.z = (this.position.z - oldZ) / dt;
    }
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    // Acceleration and turning rate (smoothed) for leans and banking.
    const k = 1 - Math.exp(-dt * 6);
    const acc = (speed - this.pose.speed) / Math.max(dt, 1e-3);
    this.pose.accel = (this.pose.accel ?? 0) + (acc - (this.pose.accel ?? 0)) * k;
    let dy = this.yaw - this.lastYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.lastYaw = this.yaw;
    this.pose.turn = (this.pose.turn ?? 0) + (dy / Math.max(dt, 1e-3) - (this.pose.turn ?? 0)) * k;
    this.pose.speed = speed;
    this.pose.run = (this.pose.run ?? 0) + (runAmount(speed) - (this.pose.run ?? 0)) * (1 - Math.exp(-dt * 5));
    this.pose.still = speed < 0.08 && this.controllable ? (this.pose.still ?? 0) + dt : 0;
    // Turning on the spot: short steps paced by the turn.
    const turning = speed < 0.35 && this.pose.kneel < 0.1 && this.pose.lie < 0.1 ? Math.min(1, Math.abs(this.pose.turn ?? 0) / 1.6) : 0;
    this.pose.step = (this.pose.step ?? 0) + (turning - (this.pose.step ?? 0)) * (1 - Math.exp(-dt * 8));
    this.pose.phase += dt * (speed > 0.05 ? Math.PI * 2 * strideFrequency(speed, this.pose.run) : 0)
      + dt * (this.pose.step ?? 0) * 4.5;
    this.pose.breath = t;

    const root = this.body.root;
    root.position.copy(this.position);
    root.rotation.y = this.yaw;
    root.updateMatrixWorld(true);

    this.anim.apply(this.pose);
    this.applyFeet(dt);
    // Contact sound and ripples come from the foot that actually landed, after leg IK.
    const phases = legPhases(this.pose.phase);
    for (const side of ['Left', 'Right'] as const) {
      const phase = side === 'Left' ? phases.L : phases.R;
      if (speed > 0.3 && phase < this.lastContactPhase[side] && this.pose.kneel < 0.1 && this.pose.lie < 0.1) {
        const foot = this.rig.get(`${side}Foot`).getWorldPosition(_lv);
        this.onFootstep?.(foot.x, foot.z, speed);
      }
      this.lastContactPhase[side] = phase;
    }
    this.applyLook(dt);
    this.applyFlinch(dt);
    this.applyHands(dt, t);
    this.applyReach();
    this.rig.driveHelpers();
    this.updateBlink(dt);
    this.updateWet(dt);
    this.updateHair(dt);
  }

  /** Slide along blockers: push out of any capsule she has stepped into. */
  private collide() {
    const BODY = 0.22;
    const p = _cv.set(this.position.x, this.position.z);
    for (const b of this.blockers) {
      const ab = _cv2.subVectors(b.b, b.a);
      const t = ab.lengthSq() > 1e-8 ? THREE.MathUtils.clamp(_cv3.subVectors(p, b.a).dot(ab) / ab.lengthSq(), 0, 1) : 0;
      const q = _cv3.copy(b.a).addScaledVector(ab, t);
      const d = p.distanceTo(q), min = b.r + BODY;
      if (d < min && d > 1e-6) {
        p.sub(q).multiplyScalar(min / d).add(q);
        this.position.x = p.x; this.position.z = p.y;
      }
    }
  }

  /** The ground under a point: the terrain, or what she is standing on. */
  private groundAt(x: number, z: number) {
    return this.floorY ? this.floorY() : heightAt(x, z);
  }

  /** Soft world bounds: back onto the nearest walkable area if she's outside all of them. */
  private keepInside() {
    const p = new THREE.Vector2(this.position.x, this.position.z);
    let best: THREE.Vector2 | null = null, bestOut = Infinity;
    for (const { a, b, r } of this.areas) {
      const ab = b.clone().sub(a);
      const t = ab.lengthSq() > 0 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1) : 0;
      const q = a.clone().addScaledVector(ab, t);
      const d = p.distanceTo(q);
      if (d <= r) return;
      if (d - r < bestOut) { bestOut = d - r; best = q.add(p.clone().sub(q).multiplyScalar(r / d)); }
    }
    if (best) { this.position.x = best.x; this.position.z = best.y; }
  }

  private applyReach() {
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const left = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const up = new THREE.Vector3(0, 1, 0);
    if (this.reachWeight > 0.001) {
      // Pointing: fingertip down into the water. Open palm: fingers forward, palm flat on it.
      // Palm up (palmUp 1): fingers up and forward, palm facing away (bark, a wall, a weight).
      const aimDir = new THREE.Vector3(0, -1, 0).addScaledVector(fwd, 0.45)
        .lerp(new THREE.Vector3(0, -0.42, 0).add(fwd), this.handOpen)
        .lerp(fwd.clone().multiplyScalar(0.35).add(up), this.palmUp)
        .lerp(fwd.clone().addScaledVector(up, 0.12), this.supinate);
      // Turning the palm over rolls the index side from her left, through up, to her right.
      const s = this.supinate * Math.PI;
      const indexToward = left.clone().multiplyScalar(Math.cos(s)).addScaledVector(up, Math.sin(s));
      this.reachArm('Right', this.reachTarget, this.reachWeight, aimDir, indexToward, Math.max(this.handOpen, this.supinate));
    }
    if (this.leftReachWeight > 0.001) {
      const aimDir = this.leftAim ?? fwd.clone().multiplyScalar(0.35).add(up);
      this.reachArm('Left', this.leftReachTarget, this.leftReachWeight, aimDir, left.clone().negate(), this.leftAim ? 0.4 : 1);
    }
    // Lying on her right side, the upper (left) arm rests: its hand laid over the lower hand on
    // the ground, not held up in the air (unless the story is using that hand).
    const rest = this.pose.lie * (1 - Math.min(1, this.leftReachWeight * 4));
    if (rest > 0.01) {
      const lower = this.rig.get('RightHand').getWorldPosition(new THREE.Vector3());
      const chest = this.chestWorld(new THREE.Vector3());
      const target = lower.clone().lerp(chest, 0.18).addScaledVector(fwd, 0.04);
      target.y = Math.max(lower.y + 0.06, this.groundAt(target.x, target.z) + 0.05);
      // If the story has the lower hand reaching somewhere, this one stays on the ground in
      // front of her chest instead of following it.
      const own = chest.clone().addScaledVector(fwd, 0.22);
      own.y = this.groundAt(own.x, own.z) + 0.05;
      target.lerp(own, Math.min(1, this.reachWeight * 2));
      this.reachArm('Left', target, rest, fwd.clone().add(new THREE.Vector3(0, -0.35, 0)).normalize(), left.clone().negate(), 0.5);
    }
    // Kneeling, her hands rest on her thighs near the knees (each unless the story is using it).
    const kneelRest = this.pose.kneel * (1 - this.pose.lie);
    if (kneelRest > 0.01) {
      for (const side of ['Right', 'Left'] as const) {
        const used = side === 'Right' ? this.reachWeight : this.leftReachWeight;
        const w = kneelRest * (1 - Math.min(1, used * 4));
        if (w < 0.01) continue;
        const hip = this.rig.get(`${side}UpLeg`).getWorldPosition(new THREE.Vector3());
        const knee = this.rig.get(`${side}Leg`).getWorldPosition(new THREE.Vector3());
        const target = hip.clone().lerp(knee, 0.7).add(new THREE.Vector3(0, 0.07, 0));
        const aim = knee.clone().sub(hip).normalize().add(new THREE.Vector3(0, -0.6, 0)).normalize();
        this.reachArm(side, target, w, aim, side === 'Right' ? left : left.clone().negate(), 0.6);
      }
    }
  }

  /**
   * Two-bone IK for one arm to a wrist target, then aim the fingers along `aimDir` and
   * (weighted by `rollW`) roll the hand so its index side points along `indexToward`:
   * with fingers down that lays the palm flat; with fingers up it turns the palm outward.
   */
  private reachArm(side: 'Left' | 'Right', target: THREE.Vector3, weight: number, aimDir: THREE.Vector3,
    indexToward: THREE.Vector3, rollW: number) {
    const rig = this.rig;
    const arm = rig.get(`${side}Arm`), fore = rig.get(`${side}ForeArm`), hand = rig.get(`${side}Hand`);
    // Elbow points outward-back from its own side.
    const sx = side === 'Right' ? -1 : 1;
    const tuck = side === 'Left' ? this.leftElbowDown : 0;
    const pole = new THREE.Vector3(sx, -0.2, -0.6).lerp(new THREE.Vector3(sx * 0.35, -1, -0.25), tuck)
      .applyQuaternion(this.body.root.quaternion)
      .add(arm.getWorldPosition(new THREE.Vector3()));
    rig.twoBone(arm, fore, hand, target, pole, weight);
    const k = (this.handBones[side] ??= {
      tip: side === 'Right' ? this.body.fingertip : this.body.root.getObjectByName(`${side}HandMiddle3`) ?? hand,
      i1: this.body.root.getObjectByName(`${side}HandIndex1`),
      p1: this.body.root.getObjectByName(`${side}HandPinky1`),
    });
    const wrist = hand.getWorldPosition(new THREE.Vector3());
    rig.aim(hand, k.tip.getWorldPosition(new THREE.Vector3()), wrist.clone().add(aimDir), weight);
    const roll = rollW * weight;
    if (roll > 0.01 && k.i1 && k.p1) {
      hand.updateMatrixWorld(true);
      const w = hand.getWorldPosition(new THREE.Vector3());
      const d = k.tip.getWorldPosition(new THREE.Vector3()).sub(w).normalize();
      const a = k.i1.getWorldPosition(new THREE.Vector3()).sub(k.p1.getWorldPosition(new THREE.Vector3()));
      const want = indexToward.clone();
      a.addScaledVector(d, -a.dot(d)).normalize();
      want.addScaledVector(d, -want.dot(d)).normalize();
      const ang = Math.atan2(new THREE.Vector3().crossVectors(a, want).dot(d), a.dot(want));
      const q = new THREE.Quaternion().setFromAxisAngle(d, ang * roll);
      const pq = hand.parent!.getWorldQuaternion(new THREE.Quaternion());
      hand.quaternion.premultiply(pq).premultiply(q).premultiply(pq.invert());
      hand.updateMatrixWorld(true);
    }
  }


  /**
   * Feet on uneven ground: the animator poses for flat ground at her root height; here each
   * foot is lifted or lowered by the terrain under it (hips drop for the lower foot), solved
   * with leg IK, and the foot keeps its world orientation tilted a little to the slope.
   */
  private footOffset = 0;
  /** Where each stance foot landed (world), and the last stride phase seen. */
  private pins: Record<'Left' | 'Right', { p: THREE.Vector3 | null; target: THREE.Vector3 | null; last: number; yaw: number; rest: boolean }> = {
    Left: { p: null, target: null, last: 0, yaw: 0, rest: false }, Right: { p: null, target: null, last: 0, yaw: 0, rest: false },
  };

  /**
   * Feet on the ground: the animator poses for flat ground at her root height; here each
   * foot is lifted or lowered by the terrain under it and, while it carries weight (heel
   * strike to toe-off), held where it landed so it doesn't slide; the leg bends to reach it
   * (hips drop if a foot can't be reached), and the sole keeps its orientation, tilted a
   * little to the slope.
   */
  private applyFeet(dt: number) {
    const w = (1 - this.pose.lie) * (1 - this.pose.kneel);
    const ground0 = this.position.y;
    const ph = legPhases(this.pose.phase);
    const reach = this.rig.legs.thigh + this.rig.legs.shin;
    const speed = this.pose.speed, run = this.pose.run ?? runAmount(speed), end = stanceEnd(speed, run);
    const moving = THREE.MathUtils.smoothstep(speed, 0.05, 0.55) * w;
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const lateral = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const travel = speed / strideFrequency(speed, run) * end;
    const front = travel * THREE.MathUtils.lerp(0.48, 0.36, run);
    const resting = speed < 0.05 && (this.pose.step ?? 0) < 0.02;
    const feet: { side: 'Left' | 'Right'; target: THREE.Vector3; drop: number; lock: number }[] = [];
    for (const side of ['Left', 'Right'] as const) {
      const pos = this.rig.get(`${side}Foot`).getWorldPosition(new THREE.Vector3());
      const target = pos.clone();
      target.y += (this.groundAt(pos.x, pos.z) - ground0) * w;
      const pin = this.pins[side];
      const phi = side === 'Left' ? ph.L : ph.R;
      if (moving > 0) {
        let z: number, lift = 0;
        if (phi <= end) {
          // Root motion cancels this backward travel: the support foot stays on the ground.
          z = front - travel * phi / end;
          lift = THREE.MathUtils.smoothstep(phi, end - 0.12, end) * THREE.MathUtils.lerp(0.025, 0.045, run);
        } else {
          const u = (phi - end) / (1 - end);
          const smooth = u * u * (3 - 2 * u);
          // Hermite endpoints match the -speed stance velocity at lift-off and landing.
          const tangent = -speed * (1 - end) / strideFrequency(speed, run);
          z = front - travel + travel * smooth + tangent * (2 * u * u * u - 3 * u * u + u);
          lift = Math.sin(Math.PI * u) ** 1.35 * THREE.MathUtils.lerp(0.075, 0.23, run)
            + THREE.MathUtils.lerp(0.025, 0.045, run) * (1 - THREE.MathUtils.smoothstep(u, 0, 0.25));
        }
        const aim = this.position.clone().addScaledVector(forward, z)
          .addScaledVector(lateral, (side === 'Left' ? 1 : -1) * THREE.MathUtils.lerp(0.085, 0.07, run));
        aim.y = this.groundAt(aim.x, aim.z) + this.rig.legs.ankle + lift;
        target.lerp(aim, moving);
      }
      if (w < 0.99 || !resting && (phi < pin.last || phi > end)) pin.p = null;
      pin.last = phi;
      // Settle where the foot is now, not back at the preceding heel strike. Reusing a
      // nearly released contact here snapped the ankle backwards as speed crossed 0.05.
      if (resting && !pin.rest && w >= 0.99) {
        pin.p = (pin.target ?? target).clone();
        pin.yaw = this.yaw;
      }
      pin.rest = resting && w >= 0.99;
      if (w >= 0.99 && (resting || phi <= end) && !pin.p) {
        pin.p = target.clone();
        pin.p.y = this.groundAt(pin.p.x, pin.p.z) + this.rig.legs.ankle;
        pin.yaw = this.yaw;
      }
      // Contact strength is weight bearing, not movement speed. Fading it with speed let
      // the support foot skate backwards during every start and stop.
      const k = pin.p ? w * (resting ? 1 : THREE.MathUtils.smoothstep(phi, 0, 0.04)
        * (1 - THREE.MathUtils.smoothstep(phi, end - 0.08, end))) : 0;
      if (pin.p) pin.p.y = this.groundAt(pin.p.x, pin.p.z) + this.rig.legs.ankle;
      if (pin.p) target.lerp(pin.p, k);
      // Rejoining a swing after idling, or changing stride length mid-step, must not
      // teleport the ankle. Bound recovery travel; ordinary gait arcs stay untouched.
      if (pin.target && dt > 0 && w >= 0.99) {
        const distance = target.distanceTo(pin.target), maxStep = (6 + 4 * run) * dt;
        if (distance > maxStep) target.lerp(pin.target, 1 - maxStep / distance);
        target.y = Math.max(target.y, this.groundAt(target.x, target.z) + this.rig.legs.ankle);
      }
      if (w >= 0.99) { pin.target ??= target.clone(); pin.target.copy(target); }
      else pin.target = null;
      // How far the hips must come down for this foot to reach its target.
      const hip = this.rig.get(`${side}UpLeg`).getWorldPosition(new THREE.Vector3());
      const horizontal2 = (hip.x - target.x) ** 2 + (hip.z - target.z) ** 2;
      const maxHipY = target.y + Math.sqrt(Math.max(0, (reach * 0.995) ** 2 - horizontal2));
      // A swinging foot must never pull the pelvis down. During flight neither foot supports it.
      const supports = moving < 0.01 || phi <= end;
      const drop = supports ? Math.min(0, maxHipY - hip.y) * w : 0;
      feet.push({ side, target, drop, lock: k });
    }
    // Lower the hips so both feet can reach; eased so steps don't pop.
    const want = Math.min(0, feet[0].drop, feet[1].drop);
    this.footOffset += (want - this.footOffset) * (1 - Math.exp(-dt * 12));
    if (w < 0.01 && Math.abs(this.footOffset) < 1e-4) return;
    const pivot = this.body.pivot;
    pivot.position.y += this.footOffset;
    pivot.updateMatrixWorld(true);
    const fwd = _lv.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    for (const f of feet) {
      const up = this.rig.get(`${f.side}UpLeg`), leg = this.rig.get(`${f.side}Leg`), foot = this.rig.get(`${f.side}Foot`);
      const keep = foot.getWorldQuaternion(new THREE.Quaternion());
      // Keep the planted sole facing the way it landed while the pelvis turns above it.
      const pin = this.pins[f.side];
      const yawDelta = Math.atan2(Math.sin(pin.yaw - this.yaw), Math.cos(pin.yaw - this.yaw));
      keep.premultiply(new THREE.Quaternion().setFromAxisAngle(_lv2.set(0, 1, 0), yawDelta * f.lock));
      const knee = leg.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 0.5);
      this.rig.twoBone(up, leg, foot, f.target, knee, 1);
      // Tilt the sole toward the slope (half of it), then restore that as the foot's world rotation.
      const e = 0.12, x = f.target.x, z = f.target.z;
      const n = new THREE.Vector3(this.groundAt(x - e, z) - this.groundAt(x + e, z), 2 * e, this.groundAt(x, z - e) - this.groundAt(x, z + e)).normalize();
      const tilt = new THREE.Quaternion().setFromUnitVectors(_lv2.set(0, 1, 0), n);
      tilt.slerp(_lq.identity(), 0.5 + 0.5 * (1 - w));
      keep.premultiply(tilt);
      foot.parent!.getWorldQuaternion(_lpq);
      foot.quaternion.copy(_lpq.invert().multiply(keep));
      foot.updateMatrixWorld(true);
    }
  }

  /** A startle: she pulls back from something (0..1). */
  flinch(strength: number) {
    this.flinchT = 0;
    this.flinchAmp = Math.max(0.3, Math.min(1, strength));
  }

  private applyFlinch(dt: number) {
    if (this.flinchT < 0) return;
    const t = (this.flinchT += dt);
    // Fast in (80 ms), slow settle.
    const f = this.flinchAmp * (t < 0.08 ? t / 0.08 : Math.exp(-(t - 0.08) * 3.2));
    if (t > 2) { this.flinchT = -1; return; }
    const q = this.body.root.quaternion;
    this.rig.nudge('Spine2', q, -0.14 * f);           // chest pulls back
    this.rig.nudge('Neck', q, -0.06 * f, 0.12 * f);    // head turns away from her right hand
    this.rig.nudge('Head', q, -0.08 * f, 0.18 * f, 0.05 * f);
  }

  /** Fingers: relaxed curl with a slow drift; the right hand points while it reaches. */
  private applyHands(dt: number, t: number) {
    if (!this.hands.available) return;
    this.point += (Math.min(1, this.reachWeight * 1.5) - this.point) * (1 - Math.exp(-dt * 5));
    const drift = 0.5 + 0.5 * Math.sin(t * 0.37);
    const lying = this.pose.lie;
    const run = runAmount(this.pose.speed);
    const loose = { ...POSES.relaxed };
    for (const k of Object.keys(loose) as (keyof typeof loose)[]) loose[k] = loose[k] * (0.85 + 0.3 * drift) + lying * 0.25;
    // Running: hands loosely closed, fingers together.
    const runHand = { Thumb: 0.45, Index: 0.55, Middle: 0.62, Ring: 0.66, Pinky: 0.7, spread: 0 };
    for (const k of Object.keys(loose) as (keyof typeof loose)[]) loose[k] += (runHand[k] - loose[k]) * run;
    if (this.leftGrip > 0.01) {
      // Closed round something small: fingers curled in, thumb over them.
      const fist = { Thumb: 0.7, Index: 0.75, Middle: 0.85, Ring: 0.88, Pinky: 0.9, spread: 0 };
      const target = { ...POSES.open };
      for (const k of Object.keys(target) as (keyof typeof target)[]) target[k] += (fist[k] - target[k]) * this.leftGrip;
      this.hands.apply('Left', loose, target, Math.min(1, Math.max(this.leftReachWeight * 1.4, this.leftGrip)));
    } else {
      this.hands.apply('Left', loose, POSES.open, Math.min(1, this.leftReachWeight * 1.4));
    }
    if (this.handOpen > 0.01) {
      const open = { ...POSES.open, spread: POSES.open.spread * 0.6 + this.handSpread };
      const target = { ...POSES.point };
      for (const k of Object.keys(target) as (keyof typeof target)[]) target[k] = target[k] + (open[k] - target[k]) * this.handOpen;
      this.hands.apply('Right', loose, target, this.point);
    } else {
      this.hands.apply('Right', loose, POSES.point, this.point);
    }
  }

  /** Where her attention goes: the story's target, or the nearest interest ahead of her. */
  gazeTarget(): THREE.Vector3 | null {
    if (this.lookTarget) return this.lookTarget;
    if (!this.controllable && !this.autopilot) return null;
    let best: THREE.Vector3 | null = null, bestD = 7;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    for (const p of this.interests) {
      const dx = p.x - this.position.x, dz = p.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD && d > 0.6 && (dx * fx + dz * fz) / d > -0.2) { best = p; bestD = d; }
    }
    return best;
  }

  /** Turn neck and head toward the gaze target on top of the animated pose (clamped, eased). */
  private applyLook(dt: number) {
    const target = this.gazeTarget();
    let yaw = 0, pitch = 0;
    const w = this.lookWeight * (1 - this.pose.lie) * (1 - this.reachWeight);
    if (target && w > 0.01) {
      this.body.root.updateMatrixWorld(true);
      const eye = this.eyeWorld(_lv);
      const d = target.clone().sub(eye).applyQuaternion(_lq.copy(this.body.root.quaternion).invert());
      const face = this.faceDir().applyQuaternion(_lq);
      const want = Math.atan2(d.x, d.z), have = Math.atan2(face.x, face.z);
      yaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(want - have), Math.cos(want - have)), -LOOK_YAW, LOOK_YAW) * w;
      const wantP = Math.atan2(d.y, Math.hypot(d.x, d.z)), haveP = Math.asin(THREE.MathUtils.clamp(face.y, -1, 1));
      pitch = THREE.MathUtils.clamp(wantP - haveP, -LOOK_DOWN, LOOK_UP) * w;
    }
    const k = 1 - Math.exp(-dt * 2.6);
    this.look.yaw += (yaw - this.look.yaw) * k;
    this.look.pitch += (pitch - this.look.pitch) * k;
    if (Math.abs(this.look.yaw) + Math.abs(this.look.pitch) < 1e-4) return;
    // Shared down the spine (LOOK_SHARE: yaw, pitch); pitch about her own left axis (+X = down).
    const rootQ = this.body.root.quaternion;
    const up = _lv.set(0, 1, 0);
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ).applyAxisAngle(up, this.look.yaw);
    for (const [name, yawShare, pitchShare] of LOOK_SHARE) {
      const bone = this.rig.get(name);
      if (!bone) continue;
      const q = _lq.setFromAxisAngle(up, this.look.yaw * yawShare);
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(left, -this.look.pitch * pitchShare));
      bone.parent!.getWorldQuaternion(_lpq);
      bone.quaternion.premultiply(_lpq).premultiply(q).premultiply(_lpq.invert());
      bone.updateMatrixWorld(true);
    }
  }

  /**
   * Wet marks (rest-pose heights): wading wets the feet and shins to the water depth,
   * kneeling in water wets shins and knees, a fingertip in water wets the finger. Water
   * beads off slowly: the line sinks a few millimetres a second, the hand patch shrinks.
   */
  private updateWet(dt: number) {
    const depth = WATER_LEVEL - this.groundAt(this.position.x, this.position.z);
    if (depth > 0.005 && this.pose.lie < 0.5) {
      const kneelWet = this.pose.kneel > 0.5 ? 0.5 + depth : 0;
      const splash = Math.min(0.06, this.pose.speed * 0.025);
      this.u.wetLegs.value = Math.max(this.u.wetLegs.value, depth + 0.03 + splash, kneelWet);
    } else {
      this.u.wetLegs.value = Math.max(0, this.u.wetLegs.value - dt * 0.004);
    }
    const tip = this.body.fingertip.getWorldPosition(_lv);
    if (tip.y < WATER_LEVEL + 0.002) this.u.wetHand.value = Math.max(this.u.wetHand.value, 0.035 + Math.min(0.04, WATER_LEVEL - tip.y));
    else this.u.wetHand.value = Math.max(0, this.u.wetHand.value - dt * 0.0015);
  }

  /**
   * Her hair as a loose spring: blown downwind (more in gusts) and trailing as she moves, so it
   * lags when she sets off, swings past when she stops, and settles.
   */
  private updateHair(dt: number) {
    if (dt <= 0) return;
    const target = _lv.copy(this.wind).multiplyScalar(0.45).addScaledVector(this.velocity, -0.2);
    target.y = 0;
    const k = 38, c = 2 * Math.sqrt(k) * 0.32;
    const h = Math.min(dt, 1 / 30);
    this.hairVel.x += (k * (target.x - this.hair.x) - c * this.hairVel.x) * h;
    this.hairVel.z += (k * (target.z - this.hair.z) - c * this.hairVel.z) * h;
    this.hair.addScaledVector(this.hairVel, h);
    if (this.hair.length() > 1) this.hair.setLength(1);
    this.u.hair.value.copy(this.hair);
  }

  /** Natural blinks: fast close (~70 ms), slower open (~130 ms), every 2–6 s. */
  private updateBlink(dt: number) {
    let idle = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const t = this.blinkT;
      idle = t < 0.07 ? t / 0.07 : t < 0.1 ? 1 : Math.max(0, 1 - (t - 0.1) / 0.13);
      if (t > 0.23) this.blinkT = -1;
    } else if ((this.nextBlink -= dt) <= 0) {
      this.blinkT = 0;
      this.nextBlink = 2 + Math.random() * 4;
    }
    this.u.blink.value = Math.max(this.eyelids, idle);
    if (this.u.blink.value > 0) this.faceDir(this.u.face.value);
    this.body.setBlink?.(this.u.blink.value);
  }

  fingertipWorld(out = new THREE.Vector3()) {
    return this.body.fingertip.getWorldPosition(out);
  }

  /** Inside her closed left hand (between the palm and the middle finger's first joint). */
  leftGripWorld(out = new THREE.Vector3()) {
    const hand = this.rig.get('LeftHand');
    const mid = this.body.root.getObjectByName('LeftHandMiddle1');
    hand.getWorldPosition(out);
    if (mid) out.lerp(mid.getWorldPosition(new THREE.Vector3()), 0.75);
    return out;
  }

  chestWorld(out = new THREE.Vector3()) {
    return this.rig.get('Spine2').getWorldPosition(out);
  }
}
