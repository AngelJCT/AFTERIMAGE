import * as THREE from 'three/webgpu';
import type { Game } from '../main';
import { EXIT } from '../world/terrain';
import { Gate } from '../world/gate';
import { OchreCloth } from '../world/cloth';
import { uPortDark, uPortGlow } from '../player/placeholder';
import { kneelAt, standUp } from './partI';
import { liftMist } from './afterimages';
import { leavePast } from './partIIPast';
import { compass, installCompass } from './compass';

/**
 * AFTERIMAGE II, playable: the present day at the refuge gate (docs/part-ii-narration.md).
 *
 * The narration is the film's, word for word and in its order; nothing is added. The present
 * frames the film: the reflex and the trigger at the start (S01–S04), the proof and the
 * direction at the end (S26–S27). The past between them (S05–S25) needs the child's model.
 *
 * Canon: the ochre strip is on the LEFT jamb bolt from the first present-day shot; the child is
 * never in the present; her shoulder port has no cable in the present; the escape runs right
 * to left.
 */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (k: number) => k * k * (3 - 2 * k);

// Gate-local layout (x along the wall, +x the RIGHT pillar seen from the refuge; y up;
// +z toward the refuge, where she stands).
const STAND = V(0.15, 0, 0.9);          // where she kneels at the gate
const JAM_GAP = 0.95, JAM_TILT = 0.025; // derelict: jammed a little open, hanging crooked
const CATCH_GAP = 0.52;                 // where her hand stops it
const EASED_GAP = 0.14;                 // how low she lets it down before taking her hand out
const WRIST_X = 0.42, WRIST_Z = 0.3;    // under the bottom beam, to her right, fingers in under it
const BRACE = V(0.4, 0.4, 0.19);        // afterwards: her hand on the shut slab, heel on the beam
const ROUTE = V(-11.5, 0, -2.5);        // round the ruined end of the left wall: the way on

let cloth: OchreCloth | null = null;
/** Where the strip is: on the bolt (present), in her hand (after S26), or not yet torn (past). */
type ClothMode = 'bolt' | 'hand' | 'hidden';
let clothMode: ClothMode = 'bolt';
export function setCloth(mode: ClothMode, flutter?: number) {
  clothMode = mode;
  if (cloth) {
    cloth.mesh.visible = mode !== 'hidden';
    if (flutter !== undefined) cloth.uFlutter.value = flutter;
  }
}

/** Everything the gate chapter needs in place (also for a cold start from a checkpoint). */
export function openWayToGate(g: Game) {
  const gate = g.gate;
  if (!gate) return;
  gate.root.visible = true;
  liftMist(g, 1);
  const front = gate.world(STAND);
  const path = { a: new THREE.Vector2(EXIT.x, EXIT.z), b: new THREE.Vector2(front.x, front.z), r: 6 };
  const c = gate.root.position;
  const yard = { a: new THREE.Vector2(c.x, c.z), b: new THREE.Vector2(c.x, c.z), r: 16 };
  if (!g.player.areas.some((a) => a.r === path.r && a.b.equals(path.b))) g.player.areas.push(path, yard);
  if (!cloth) {
    cloth = new OchreCloth(g.scene);
    const faceYaw = gate.root.rotation.y;
    g.onFrame(() => {
      if (!cloth || clothMode === 'hidden') return;
      if (clothMode === 'hand') {
        const speed = Math.hypot(g.player.velocity.x, g.player.velocity.z);
        if (compass.pull > 0.01) {
          // The compass: it streams toward where she went.
          cloth.stream(g.player.leftGripWorld(), compass.dir, Math.max(compass.pull, Math.min(0.3, speed * 0.12)));
        } else {
          cloth.hangFrom(g.player.leftGripWorld(), g.player.yaw);
          cloth.uFlutter.value += (1 + speed * 1.2 - cloth.uFlutter.value) * 0.05;
        }
      } else {
        cloth.hangFrom(gate.point('bolt_tip'), faceYaw);
      }
    });
  }
  installCompass(g, () => clothMode === 'hand');
  cloth.mesh.visible = clothMode !== 'hidden';
}

/** Where to go once the grove is complete: the front of the gate. */
export function gateGoal(g: Game) {
  return g.gate ? g.gate.world(STAND) : null;
}

function faceGateYaw(gate: Gate) {
  const f = V(0, 0, -1).applyQuaternion(gate.root.quaternion);
  return Math.atan2(f.x, f.z);
}

function eyes(g: Game, k: number) {
  g.player.eyelids = k;
  g.post.uEyesClosed.value = k;
  g.audio.setClosed(k);
}

/** Where her right wrist goes to hold the slab's bottom beam from below, palm up. */
function wristUnder(gate: Gate) {
  return gate.world(V(WRIST_X, gate.gap - 0.03, WRIST_Z));
}

/** A gate-local offset turned into a world direction. */
function dirOf(gate: Gate, x: number, y: number, z: number) {
  return V(x, y, z).applyQuaternion(gate.root.quaternion);
}

// ── S01–S04: the reflex, recognition, the place, the trigger ───────────────

export async function gateArrival(g: Game) {
  const { clock, ui, player, audio, cam, post, water, input } = g;
  const gate = g.gate;
  if (!gate) return;
  openWayToGate(g);
  gate.gap = JAM_GAP;
  gate.jam = JAM_TILT;
  setCloth('bolt');
  const stand = gate.world(STAND);
  const yaw = faceGateYaw(gate);
  // Cold start: a few steps out, walking in.
  if (Math.hypot(player.position.x - stand.x, player.position.z - stand.z) > 9) {
    player.place(gate.world(V(0.4, 0, 7.5)), yaw);
    cam.yaw = yaw + Math.PI;
    void ui.fade(0, 2.5);
  }
  Object.assign(player.pose, { kneel: 0, lie: 0, lean: 0, headPitch: 0 });
  player.reachWeight = 0; player.leftReachWeight = 0; player.leftGrip = 0; player.leftAim = null; player.leftElbowDown = 0;
  player.palmUp = 0; player.supinate = 0; player.handOpen = 0; player.handSpread = 0;
  player.eyelids = 0; player.lookTarget = null;
  uPortDark.value = 0;
  cam.release(0);
  player.controllable = true;
  g.guide.setGoal(stand);
  const opening = gate.world(V(0, 0.5, 0.2));
  player.interests = [...player.interests, opening];

  // She walks up to the jammed gate; close in, it starts to groan and she steps in to it.
  await clock.until(() => Math.hypot(player.position.x - stand.x, player.position.z - stand.z) < 4.2);
  g.guide.setGoal(null);
  player.controllable = false;
  player.lookTarget = opening;
  audio.stopMusic(2.5);
  audio.groan(0.35, 1.5);
  const toStand = () => V(stand.x - player.position.x, 0, stand.z - player.position.z);
  player.autopilot = toStand();
  const t0 = clock.time;
  await clock.until(() => { player.autopilot = toStand(); return toStand().length() < 0.4 || clock.time - t0 > 8; });
  player.autopilot = null;

  // It slips. Her hand is under it before she knows.
  audio.groan(0.8, 0.25);
  const follow = g.onFrame(() => player.reachTarget.copy(wristUnder(gate)));
  player.supinate = 1; player.handOpen = 1; player.handSpread = 0.15;
  void kneelAt(g, stand, yaw, 0.45, 0, 0.45);
  void clock.tween(0.4, (k) => (player.reachWeight = smooth(k)));
  // Her other hand comes to rest on her knee once she's down (kneeling upright she can't reach
  // the stone), instead of hanging behind her.
  {
    const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
    player.leftAim = fwd.clone().add(V(0, -0.7, 0)).normalize();
    void clock.sleep(0.45).then(() => {
      const knee = player.rig.get('LeftLeg').getWorldPosition(V());
      player.leftReachTarget.copy(knee).addScaledVector(fwd, 0.04).add(V(0, 0.07, 0));
      // Resting, not bracing: the fingers curl a little.
      return clock.tween(0.6, (k) => { player.leftReachWeight = smooth(k); player.leftGrip = 0.3 * smooth(k); });
    });
  }
  await clock.tween(0.5, (k) => { gate.gap = JAM_GAP + (CATCH_GAP - JAM_GAP) * k * k; gate.jam = JAM_TILT * (1 - k); });

  // S01, cut on impact: her hand under the wet beam, just above the water.
  const hand = wristUnder(gate);
  const ecu = {
    position: hand.clone().add(dirOf(gate, -0.75, 0.04, 0.38)),
    target: hand.clone().add(dirOf(gate, -0.05, 0.02, -0.08)),
    lens: 85, range: 0.22, bokeh: 9, handheld: 0.5,
  };
  cam.cutTo(ecu, 0);
  cam.shake(0.5);
  audio.clang(1);
  audio.groan(0, 0.8);
  audio.portChime(0.8);
  void clock.tween(0.9, (k) => (uPortGlow.value = 1 + Math.sin(k * Math.PI) * 1.6));
  void audio.playMusic('gate', 3);
  // Drops shaken off the beam land in the water under it.
  for (let i = 0; i < 5; i++) {
    const p = gate.world(V(-1.3 + i * 0.65 + (Math.random() - 0.5) * 0.3, 0, 0.18));
    water.addRipple(p.x, p.z, 0.0016);
  }
  // The weight settles a few centimetres into her hand; the camera tilts with it.
  const t1 = ecu.target.y;
  void clock.tween(0.7, (k) => { gate.gap = CATCH_GAP - 0.03 * smooth(k); ecu.target.y = t1 - 0.03 * smooth(k); });
  await clock.sleep(0.35);
  void ui.say('my hands remembered before I did', 3.2);
  await clock.sleep(2.6);

  // S02: recognition before knowledge. Her attention goes to the gate; the port settles.
  const eye = player.eyeWorld(V());
  const eyeLocal = gate.root.worldToLocal(eye.clone());
  const camLocal = eyeLocal.clone().add(V(-0.55, -0.06, -0.4));
  camLocal.z = Math.max(camLocal.z, 0.3);
  const face = { position: gate.world(camLocal), target: eye.clone().add(V(0, -0.04, 0)), lens: 50, range: 0.6, bokeh: 6, handheld: 0.6 };
  cam.cutTo(face, 0);
  cam.cutTo({ ...face, position: gate.world(camLocal.clone().add(V(-0.35, 0, 0.05))) }, 3);
  audio.bodyMove(0.3);
  player.lookTarget = hand.clone();
  void clock.tween(1.6, (k) => (uPortGlow.value = 1 + Math.sin(k * Math.PI) * 0.8));
  await clock.sleep(0.6);
  // The eyes arrive first, then the chin: up the face of the gate.
  player.lookTarget = gate.world(V(0.2, 1.3, 0.1));
  await clock.sleep(2.4);

  // S03: the place. Low and wide, rising: the gate, her at the right, the strip on the left bolt.
  const wideLow = { position: gate.world(V(-2.3, 0.35, 5.8)), target: gate.world(V(-0.1, 1.1, 0)), lens: 32, range: 6, bokeh: 1.5, handheld: 0.4 };
  cam.cutTo(wideLow, 0);
  cam.cutTo({ ...wideLow, position: gate.world(V(-2.3, 1.6, 5.6)), target: gate.world(V(-0.1, 1.0, 0)) }, 5);
  player.lookTarget = gate.world(V(0.3, 0.3, 0.2));
  // She lets it down herself, slowly: hold to ease the weight toward the sill.
  ui.showPrompt('ease it down', 'hold E', 'hold to ease it down', true);
  let gap = gate.gap;
  const ease = g.onFrame((dt) => {
    if (input.actionHeld) gap = Math.max(EASED_GAP, gap - dt * 0.1);
    gate.gap = gap;
  });
  await clock.until(() => gap <= EASED_GAP);
  ease();
  input.release();
  ui.hidePrompt();
  // Her hand slides out; it drops the last of the way and seals.
  follow();
  const under = player.reachTarget.clone();
  const out = gate.world(V(WRIST_X, 0.2, 0.55));
  await clock.tween(0.45, (k) => player.reachTarget.lerpVectors(under, out, smooth(k)));
  await clock.tween(0.22, (k) => (gate.gap = EASED_GAP * (1 - k * k)));
  audio.thud(0.7);
  audio.clang(0.4);
  cam.shake(0.25);
  for (let i = 0; i < 6; i++) {
    const p = gate.world(V(-1.5 + i * 0.6, 0, 0.2));
    water.addRipple(p.x, p.z, 0.002);
  }
  await clock.sleep(0.6);

  // S04: the trigger. Her hand on the shut gate, heel on the wet beam; the fingers open.
  const brace = gate.world(BRACE);
  // From her right, so the hand isn't hidden behind her; a slow slide toward the fingertips.
  const insert = {
    position: brace.clone().add(dirOf(gate, 0.55, 0.28, 0.5)),
    target: brace.clone().add(dirOf(gate, 0, 0.07, 0)),
    lens: 85, range: 0.2, bokeh: 10, handheld: 0.5,
  };
  cam.cutTo(insert, 0);
  cam.cutTo({ ...insert, position: brace.clone().add(dirOf(gate, 0.45, 0.28, 0.55)) }, 4);
  const from = player.reachTarget.clone();
  void ui.say("I came here looking for what I'd lost", 3.6);
  await clock.tween(1.3, (k) => {
    const e = smooth(k);
    player.reachTarget.lerpVectors(from, brace, e);
    player.supinate = 1 - e;
    player.palmUp = e;
    player.handOpen = 1;
    player.handSpread = 0.15 + 0.15 * e;
  });
  // The fingers ease apart on the iron, the palm lifting a breath off it: a question. (Kept
  // open and flat, as in the boards; half-closing it read as a claw against the metal.)
  await clock.tween(1.8, (k) => {
    const e = smooth(k);
    player.handSpread = 0.3 + 0.18 * e;
    player.handOpen = 1 - 0.12 * e;
    player.reachTarget.copy(brace).add(dirOf(gate, 0, 0.01 * e, 0.025 * e));
  });

  // Stay. A child's small breath arrives before anything is seen.
  let still = 0;
  const stop = g.onFrame((dt) => { still = input.busy ? 0 : still + dt; });
  await clock.until(() => still > 2);
  stop();
  audio.breaths(player.position.clone().add(dirOf(gate, -0.6, 0.9, 0)), 4);
  audio.memoryPad(true, 3);
  post.uVignette.value += 0.05;
  await clock.sleep(1.6);
}

// ── S05–S25: the past lives in partIIPast.ts ─────────────────────────────────

export { gateMemory } from './partIIPast';

// ── S26–S27: proof, and a direction ───────────────────────────────────────

export async function gateTrace(g: Game) {
  const { clock, ui, player, audio, cam, input } = g;
  const gate = g.gate;
  if (!gate) return;
  openWayToGate(g);
  leavePast(g);
  gate.lift = 0;
  gate.jam = 0;
  setCloth('bolt', 1);
  const yaw = faceGateYaw(gate);
  const left = V(-1, 0, 0).applyQuaternion(gate.root.quaternion);

  // Back at the ruin: still kneeling where the memory took her, eyes closed.
  player.controllable = false;
  const stand = gate.world(STAND);
  player.place(stand, yaw);
  Object.assign(player.pose, { kneel: 1, lie: 0, lean: 0.4, headPitch: 0.35 });
  player.reachWeight = 0; player.palmUp = 0; player.handOpen = 0; player.handSpread = 0;
  player.leftReachWeight = 0; player.leftAim = null; player.leftGrip = 0;
  player.leftReachWeight = 0; player.leftGrip = 0; player.leftAim = null; player.leftElbowDown = 0;
  player.lookTarget = null;
  eyes(g, 1);
  audio.memoryPad(false, 1);
  const wake = {
    position: gate.world(V(-1.05, 0.8, 0.5)),
    target: stand.clone().add(V(0, 0.8, 0)),
    lens: 50, range: 2, bokeh: 3, handheld: 0.5,
  };
  cam.cutTo(wake, 0);
  await ui.fade(0, 3);
  // The core comes back: the port lights, the eyes open.
  audio.portChime(0.6);
  const dark0 = uPortDark.value;
  await clock.tween(1.4, (k) => { uPortGlow.value = 0.2 + 0.8 * smooth(k); uPortDark.value = dark0 * (1 - smooth(k)); });
  await clock.tween(1.6, (k) => eyes(g, 1 - smooth(k)));
  player.lookTarget = gate.point('bolt_tip');
  await clock.sleep(1.4);
  await standUp(g, 1.8);
  cam.release(2.4);

  // The strip on the bolt: she goes to it.
  const bolt = gate.point('bolt_tip');
  const spot = gate.world(gate.localDir(bolt.clone().sub(gate.root.position)).add(V(0.42, 0, 0.5)).setY(0));
  spot.y = 0;
  player.controllable = true;
  player.lookTarget = null;
  player.interests = [...player.interests, bolt];
  g.guide.setGoal(spot);
  await clock.until(() => Math.hypot(player.position.x - spot.x, player.position.z - spot.z) < 1.3 && (() => {
    ui.showPrompt('take it', 'E', 'take it', true);
    return input.actionPressed;
  })());
  ui.hidePrompt();
  g.guide.setGoal(null);
  player.controllable = false;
  const toBolt = V(bolt.x - player.position.x, 0, bolt.z - player.position.z);
  const boltYaw = Math.atan2(toBolt.x, toBolt.z);
  const p0 = player.position.clone(), y0 = player.yaw;
  const dy = Math.atan2(Math.sin(boltYaw - y0), Math.cos(boltYaw - y0));
  const at = V(bolt.x, 0, bolt.z).addScaledVector(toBolt.clone().normalize(), -0.52);
  at.y = p0.y;
  await clock.tween(0.9, (k) => { const e = smooth(k); player.position.lerpVectors(p0, at, e); player.yaw = y0 + dy * e; });

  // S26: over her shoulder, the strip left, her port right; her hand reaches for it.
  const shoulder = player.portWorld().pos;
  const boltDir = toBolt.normalize();
  const side = V(boltDir.z, 0, -boltDir.x);       // her left
  cam.cutTo({
    position: shoulder.clone().addScaledVector(boltDir, -0.45).addScaledVector(side, 0.28).add(V(0, 0.12, 0)),
    target: bolt.clone().addScaledVector(side, 0.08),
    focus: bolt.clone(),
    lens: 50, range: 0.5, bokeh: 7, handheld: 0.5,
  }, 0);
  player.lookTarget = bolt.clone();
  player.leftAim = boltDir.clone().add(V(0, -0.15, 0));
  const reachFrom = player.chestWorld(V()).addScaledVector(side, 0.25).add(V(0, -0.3, 0));
  const reachTo = bolt.clone().addScaledVector(boltDir, -0.07).add(V(0, -0.02, 0));
  await clock.tween(1.5, (k) => {
    const e = smooth(k);
    player.leftReachWeight = e;
    player.leftReachTarget.lerpVectors(reachFrom, reachTo, e);
  });
  await clock.tween(0.6, (k) => (player.leftGrip = smooth(k)));
  // It comes free: the fibres lift, then hang from her hand.
  setCloth('hand', 3);
  audio.bodyMove(0.2);
  void ui.say('I remember why I stayed', 3.4);
  void audio.playMusic('trace', 3);
  // Near her chest, a little to her left, the fist turned in: follows her as she turns.
  const chest = () => player.chestWorld(V()).addScaledVector(V(Math.sin(player.yaw), 0, Math.cos(player.yaw)), 0.22)
    .addScaledVector(V(Math.cos(player.yaw), 0, -Math.sin(player.yaw)), 0.06).add(V(0, -0.02, 0));
  const inward = () => V(Math.cos(player.yaw), 0.35, -Math.sin(player.yaw)).negate().normalize();
  const pulled = player.leftReachTarget.clone();
  await clock.tween(1.6, (k) => {
    const e = smooth(k);
    player.leftReachTarget.lerpVectors(pulled, chest(), e);
    player.leftAim = boltDir.clone().lerp(inward(), e).normalize();
    player.leftElbowDown = e;
  });
  const keepHeld = g.onFrame(() => { player.leftReachTarget.copy(chest()); player.leftAim = inward(); });
  player.lookTarget = null;
  player.lookWeight = 0.4;
  player.pose.headPitch = 0.35;
  await clock.sleep(1.8);

  // S27: a direction. The strip held near her chest; she looks up, toward the way on.
  const route = gate.world(ROUTE);
  const eye = player.eyeWorld(V());
  const toRoute = V(route.x - eye.x, 0, route.z - eye.z).normalize();
  cam.cutTo({
    position: eye.clone().addScaledVector(toRoute, 0.95).addScaledVector(V(toRoute.z, 0, -toRoute.x), 0.35).add(V(0, -0.1, 0)),
    target: eye.clone().add(V(0, -0.16, 0)),
    lens: 50, range: 0.5, bokeh: 7, handheld: 0.6,
  }, 0);
  const turnFrom = player.yaw;
  const turnTo = Math.atan2(toRoute.x, toRoute.z);
  const turnD = Math.atan2(Math.sin(turnTo - turnFrom), Math.cos(turnTo - turnFrom));
  await clock.sleep(1.2);
  player.lookWeight = 1;
  player.lookTarget = route.clone().setY(1.4);
  await clock.tween(1.4, (k) => (player.pose.headPitch = 0.35 * (1 - smooth(k))));
  void ui.say('now I have someone to find', 3.6);
  await clock.tween(2.2, (k) => { player.yaw = turnFrom + turnD * smooth(k); });
  await clock.sleep(1.6);

  // The hand drops to her side, still closed round it; the way on is hers to walk.
  await clock.tween(1.2, (k) => { player.leftReachWeight = 1 - smooth(k); player.leftElbowDown = 1 - smooth(k); });
  keepHeld();
  player.leftAim = null;
  player.lookTarget = null;
  player.lookWeight = 1;
  cam.release(2.4);
  player.controllable = true;
  g.guide.setGoal(route);
  await clock.until(() => Math.hypot(player.position.x - route.x, player.position.z - route.z) < 3);
  g.guide.setGoal(null);
  await ui.fade(1, 3);
  player.controllable = false;
  await ui.card('AFTERIMAGE', 'part two', 5);
  // The search picks up from here with the screen still dark.
}

