import * as THREE from 'three/webgpu';
import type { Game } from '../main';
import { heightAt, MIRROR, POOL, EXIT, WAKE_POINT, WATER_LEVEL } from '../world/terrain';
import { uPortGlow } from '../player/placeholder';
import { chapterAt } from './chapters';
import { reboot } from './reboot';
import { progress, BEATS, type Beat } from './progress';
import { eyeShot, handShot, portShot, reflectionShot, topDown, wideOpening } from './shots';
import { runGrove } from './afterimages';
import { gateArrival, gateMemory, gateTrace } from './partII';
import { runSearch } from './search';
import { runCrossing } from './crossing';
import { runMirror } from './mirror';
import { runCredits } from './credits';
import { filmWindow, SHOT } from './filmWindow';

/**
 * AFTERIMAGE — Part I, playable.
 *
 * The first film plays through it in a window of broken crystal, its narration word for word
 * at the film's own times, while the game stages each of its shots behind it (the same moment,
 * here). Her actions stay hers: the touch, lying still, closing her eyes.
 * Each beat can start cold from a checkpoint, so each one sets up its own state.
 */

const GENTLE_SPEED = 0.16; // m/s: fingertip speed at contact that still counts as gentle
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (k: number) => k * k * (3 - 2 * k);

export async function runPartI(g: Game, from: Beat = 'coldOpen') {
  const beats: Record<Beat, (g: Game) => Promise<void>> = {
    coldOpen, lying, eyesClosed, rise, explore, reflection, ending, grove: runGrove,
    gate: gateArrival, memory: gateMemory, trace: gateTrace, search: runSearch, crossing: runCrossing, mirror: runMirror,
  };
  for (const beat of BEATS.slice(BEATS.indexOf(from))) {
    progress.save(beat);
    g.setStage(beat, beat === from);
    g.guide.waypoint = null;
    g.input.release();
    g.audio.setIntensity(1, 1);
    const ch = chapterAt(beat);
    // Each chapter's light (at once when starting there, else passing into it).
    if (ch?.reboot && beat !== from) {
      g.weather.set(ch.weather, 0);
      await reboot(g);
    } else if (ch) g.weather.set(ch.weather, beat === from ? 0 : 10);
    if (ch?.card) void g.clock.sleep(2.5).then(() => g.ui.chapter(ch.n, ch.title));
    await beats[beat](g);
  }
  progress.complete();
  await runCredits(g);
  // Back to the title screen.
  location.href = location.pathname;
}

// ── helpers ───────────────────────────────────────────────────────────────

function resetBody(g: Game) {
  const p = g.player;
  g.guide.setGoal(null);
  p.eyelids = 0;
  Object.assign(p.pose, { kneel: 0, lie: 0, lean: 0, headPitch: 0 });
  p.reachWeight = 0;
  p.supinate = 0;
  p.leftReachWeight = 0; p.leftGrip = 0; p.leftAim = null; p.leftElbowDown = 0;
  p.autopilot = null;
  g.post.uEyesClosed.value = 0;
}

function flatDist(a: THREE.Vector3, b: THREE.Vector3) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

async function pulsePort(g: Game, peak = 1.8, seconds = 1.6) {
  g.audio.portChime(Math.min(1, peak / 2));
  await g.clock.tween(seconds, (k) => (uPortGlow.value = 1 + Math.sin(k * Math.PI) * peak));
}

/**
 * Kneel where the water begins, walking at most 3 m toward `pool`.
 * `inset` < 0 stays back on the bank; > 0 kneels that far into the shallows.
 */
export function kneelSpot(from: THREE.Vector3, pool: THREE.Vector3, inset = -0.2) {
  const dir = V(pool.x - from.x, 0, pool.z - from.z).normalize();
  const p = from.clone();
  if (heightAt(p.x, p.z) > WATER_LEVEL) {
    for (let i = 0; i < 60; i++) {
      p.addScaledVector(dir, 0.05);
      if (heightAt(p.x, p.z) < WATER_LEVEL) break;
    }
    p.addScaledVector(dir, inset);
  }
  p.y = heightAt(p.x, p.z);
  return { spot: p, yaw: Math.atan2(dir.x, dir.z) };
}

export async function kneelAt(g: Game, spot: THREE.Vector3, yaw: number, lean: number, headPitch: number, seconds = 1.3) {
  const p = g.player;
  const from = p.position.clone();
  const fromYaw = p.yaw;
  const dy = Math.atan2(Math.sin(yaw - fromYaw), Math.cos(yaw - fromYaw));
  p.controllable = false;
  g.audio.bodyMove(0.7);
  await g.clock.tween(seconds, (k) => {
    const e = smooth(k);
    p.position.lerpVectors(from, spot, e);
    p.yaw = fromYaw + dy * e;
    p.pose.kneel = e;
    p.pose.lean = lean * e;
    p.pose.headPitch = headPitch * e;
  });
}

export async function standUp(g: Game, seconds = 1.6) {
  const p = g.player;
  const s = { ...p.pose }, w = p.reachWeight;
  g.audio.bodyMove(0.6);
  await g.clock.tween(seconds, (k) => {
    const e = smooth(k);
    p.reachWeight = w * (1 - e);
    p.pose.kneel = s.kneel * (1 - e);
    p.pose.lean = s.lean * (1 - e);
    p.pose.headPitch = s.headPitch * (1 - e);
  });
}

/**
 * The core verb: the player lowers her right hand until the fingertip meets the water.
 * Too fast and the water splashes and she flinches; slow enough and it's a single ring.
 * Resolves once a gentle touch has happened; the hand then rests in the water.
 */
export async function gentleTouch(g: Game, contactIn: THREE.Vector3, fwd: THREE.Vector3, start = 0.2,
  opts: { prompt?: [string, string, string] } = {}) {
  const { clock, ui, player, water, audio, input } = g;
  const contact = contactIn.clone().setY(WATER_LEVEL);
  const spot = player.position.clone();
  let hand = start;
  const tipOffset = V(0, 0.17, -0.02);
  const updateTarget = () => {
    player.reachTarget.copy(contact).add(tipOffset).add(V(0, hand, 0)).addScaledVector(fwd, -0.03);
  };
  updateTarget();
  await clock.tween(1.2, (k) => {
    player.reachWeight = smooth(k);
    updateTarget();
  });

  ui.showPrompt(...(opts.prompt ?? ['lower your hand', 'S', 'drag down to lower your hand']));
  let speed = 0;
  // Time spent at the limit of her reach (bowed fully, touch point drawn in, still short of it):
  // past a moment there, close enough counts, so no approach can leave her hovering forever.
  let atLimit = 0;
  const slack = () => Math.min(0.03, Math.max(0, atLimit - 1.5) * 0.02);
  const tip = V();
  let lastTipY = player.fingertipWorld(tip).y;
  const stop = g.onFrame((dt) => {
    hand = THREE.MathUtils.clamp(hand - input.reach, -0.004, 0.32);
    player.fingertipWorld(tip);
    const v = (lastTipY - tip.y) / Math.max(dt, 1e-3);
    lastTipY = tip.y;
    speed = THREE.MathUtils.lerp(speed, v, 0.35);
    // Close the loop on the fingertip so contact is exact whatever the rig.
    const err = contact.y + hand - tip.y;
    tipOffset.y = THREE.MathUtils.clamp(tipOffset.y + err * 0.5, -0.05, 0.3);
    if (err < -0.006) {
      // Out of reach: bow further, then bring the touch point in, then bow deeper still.
      if (player.pose.lean < 1.1) player.pose.lean = Math.min(1.1, player.pose.lean + dt * 0.9);
      else if (contact.distanceTo(spot) > 0.3) contact.addScaledVector(fwd, -dt * 0.25);
      else player.pose.lean = Math.min(1.4, player.pose.lean + dt * 0.4);
      if (player.pose.lean >= 1.4 && input.reach > 0) atLimit += dt;
    }
    updateTarget();
  });

  for (;;) {
    await clock.until(() => player.fingertipWorld(tip).y <= WATER_LEVEL + 0.004 + slack());
    const s = Math.max(0, speed);
    if (s <= GENTLE_SPEED) {
      water.addRipple(tip.x, tip.z, 0.0022);
      audio.touchWater(0);
      break;
    }
    const strength = Math.min(1, s / 0.8);
    water.addRipple(tip.x, tip.z, 0.003 + strength * 0.004);
    audio.touchWater(strength);
    player.flinch(0.4 + strength * 0.6);
    g.cam.shake(0.006 + strength * 0.012);
    await clock.tween(0.35, (k) => { hand = Math.max(hand, 0.2 * Math.sin(k * Math.PI * 0.5)); });
  }
  ui.hidePrompt();
  hand = -0.004;
  return {
    tip,
    /** Press the hand a little deeper (a guided hand), 0..1. */
    press(k: number) { hand = -0.004 - 0.012 * k; },
    /** Keep small rings coming off the resting fingertip. */
    async ripple(times: number, every = 2.6) {
      for (let i = 0; i < times; i++) {
        await clock.sleep(every);
        player.fingertipWorld(tip);
        water.addRipple(tip.x, tip.z, 0.0014);
      }
    },
    release() {
      stop();
    },
  };
}

// ── beats ─────────────────────────────────────────────────────────────────
//
// The first film plays through them in its window of broken crystal (story/filmWindow.ts),
// its narration at its own times, while the game stages each shot behind it: the same moment,
// here. What she does stays hers: the touch comes before the film shows the hand; lying still
// lets the film go on; holding her eyes closed carries it through the quiet and the hum.

/** "when I woke…" — the first things she remembers: a colour, the hand and the water. */
async function coldOpen(g: Game) {
  const { clock, ui, cam, player, audio } = g;
  const film = filmWindow(g);
  resetBody(g);
  player.controllable = false;
  audio.hum(0, 0.1);
  void audio.playMusic('open', 4);

  // Wide: standing in the shallows, glare behind her (the film's wide over it).
  const standing = V(POOL.x + 0.2, 0, POOL.z + 0.9);
  player.place(standing, 0);
  const wide = wideOpening(player.position, 0);
  cam.cutTo(wide, 0);
  const wideStart = wide.position.clone();
  void clock.tween(12, (k) => wide.position.lerpVectors(wideStart, wide.target, k * 0.12));
  await clock.sleep(0.6);
  void ui.fade(0, 3.5);
  await film.open(SHOT.wide);
  await film.until(SHOT.eye);

  // The film cuts to her eye, and so does the game: kneeling now at the pool's edge.
  const { spot, yaw } = kneelSpot(V(POOL.x, 0, POOL.z + 2.6), POOL);
  player.place(spot, yaw);
  Object.assign(player.pose, { kneel: 1, lean: 0.8, headPitch: 0.35 });
  await clock.sleep(0.05); // one pose update before framing the eye
  const eye = eyeShot(player, 0.32);
  cam.cutTo(eye, 0);
  const eyeStart = eye.position.clone();
  void clock.tween(9, (k) => eye.position.lerpVectors(eyeStart, eye.target, k * 0.15));
  await film.until(SHOT.hand);

  // "my hand reached for the water": the film waits while her hand does it, played.
  await film.close(false);
  const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
  const right = V(-fwd.z, 0, fwd.x);
  const contact = spot.clone().addScaledVector(fwd, 0.52).addScaledVector(right, 0.2);
  const shot = handShot(contact.setY(WATER_LEVEL), fwd, right);
  cam.cutTo(shot, 0);
  const touch = await gentleTouch(g, contact, fwd);

  // Then the film's hand, over hers: "it knew how to be gentle…". The game racks focus out
  // along the ring and back while it plays.
  const pushFrom = shot.position.clone();
  const handFocus = shot.focus!.clone();
  const ringFocus = handFocus.clone().addScaledVector(fwd, 0.55).setY(WATER_LEVEL);
  const rack = (async () => {
    await clock.sleep(0.4);
    await clock.tween(2.6, (k) => shot.focus!.lerpVectors(handFocus, ringFocus, smooth(k)));
    await clock.sleep(1.6);
    await clock.tween(2.8, (k) => shot.focus!.lerpVectors(ringFocus, handFocus, smooth(k)));
  })();
  void clock.tween(10, (k) => shot.position.lerpVectors(pushFrom, shot.target, k * 0.22));
  await film.open(SHOT.hand, [0.28, 0.42]);
  await Promise.all([film.until(SHOT.lying), rack, touch.ripple(3)]);
  touch.release();
  await film.close();
  // The score carries on over the fade into the aerial shot.
  await ui.fade(1, 2);
}

/** "this is where my memory begins" — lying curled on the cracked ground, waiting. */
async function lying(g: Game) {
  const { clock, ui, cam, player, input, audio } = g;
  const film = filmWindow(g);
  // Started from this checkpoint: the opening score picks up here.
  if (!audio.musicPlaying) void audio.playMusic('open', 3);
  resetBody(g);
  player.controllable = false;
  player.place(WAKE_POINT, Math.PI);
  player.pose.lie = 1;
  const shot = topDown(player.position, 5.2);
  cam.cutTo(shot, 0);
  void clock.tween(30, (k) => (shot.position.y = player.position.y + 5.2 - k * 2.6));
  void ui.fade(0, 3);

  // Waiting is the input: the film goes on while she lies still. Moving makes her stir, and
  // the memory holds, trembling, until she is still again.
  let still = 0, busyFor = 0;
  const stirring = g.onFrame((dt) => {
    if (input.busy || input.actionPressed) {
      if (still > 0.5) g.audio.bodyMove(0.35);
      still = 0;
      busyFor += dt;
      player.pose.headPitch = 0.12 * Math.sin(clock.time * 9) * Math.min(1, busyFor);
    } else {
      still += dt;
      busyFor = Math.max(0, busyFor - dt * 2);
      player.pose.headPitch *= 0.92;
    }
    film.held = still < 0.4 && busyFor > 0.2;
    if (busyFor > 2.5) ui.showPrompt('be still');
    else if (still > 0.6) ui.hidePrompt();
  });
  await film.open(SHOT.lying);
  await film.until(SHOT.profile);
  stirring();
  film.held = false;
  ui.hidePrompt();
  await film.close(false);
}

/** "I closed my eyes…" — holding to close them: the world goes quiet, the hum and the port remain. */
async function eyesClosed(g: Game) {
  const { clock, ui, cam, player, audio, input, post } = g;
  const film = filmWindow(g);
  if (player.pose.lie < 0.99) {
    // Started from this checkpoint.
    resetBody(g);
    player.place(WAKE_POINT, Math.PI);
    player.pose.lie = 1;
    void ui.fade(0, 2);
  }
  player.controllable = false;
  // Her face as she lies there (the film's profile over it).
  cam.cutTo(eyeShot(player, 0.42), 0);
  await film.open(SHOT.profile);

  // Her lids follow the held input first, then the screen's.
  let closed = 0;
  const lids = g.onFrame((dt) => {
    const want = input.actionHeld ? 1 : 0;
    closed += (want - closed) * (1 - Math.exp(-dt * (want ? 1.3 : 3.5)));
    player.eyelids = Math.min(1, closed * 1.9);
    post.uEyesClosed.value = Math.max(0, (closed - 0.45) / 0.55);
    audio.setClosed(closed);
  });
  const held = () => closed > 0.85;
  // "I closed my eyes": the film waits for her to do it.
  await film.until(SHOT.profile + 5.2);
  ui.showPrompt('close your eyes', 'hold E', 'hold to close your eyes', true);
  // From here the film goes on only while her eyes are held closed (let go and it stalls).
  const holding = g.onFrame(() => {
    film.held = !held();
    if (held()) ui.hidePrompt();
    else ui.showPrompt('close your eyes', 'hold E', 'hold to close your eyes', true);
  });
  audio.stopMusic(4);
  await clock.until(held);
  audio.duck(0.15, 2);
  // In the dark: the port close-up; only its light comes through the lids.
  await film.until(SHOT.port);
  cam.cutTo(portShot(player, 0.3), 0);
  audio.hum(1, 3);
  void pulsePort(g, 2.4, 3);
  await film.until(SHOT.port + 3.8);
  void pulsePort(g, 2.0, 2.4);
  await film.until(SHOT.standing);
  holding();
  film.held = false;
  await film.close();

  ui.showPrompt('open your eyes', 'release', 'let go to open your eyes', false);
  await clock.until(() => !input.actionHeld);
  ui.hidePrompt();
  input.release();
  // Back on her face for the opening.
  cam.cutTo(eyeShot(player, 0.42), 0);
  audio.duck(1, 3);
  await clock.until(() => closed < 0.03);
  lids();
  player.eyelids = 0;
  post.uEyesClosed.value = 0;
  audio.setClosed(0);
  await clock.sleep(0.6);
}

/** She rises, and looks at her hands. "I was beginning to feel present inside it…" */
async function rise(g: Game) {
  const { clock, ui, cam, player, audio } = g;
  const film = filmWindow(g);
  if (player.pose.lie < 0.99) {
    resetBody(g);
    player.place(WAKE_POINT, Math.PI);
    player.pose.lie = 1;
    cam.cutTo(topDown(player.position, 3.2), 0);
    void ui.fade(0, 1.5);
    audio.hum(1, 2);
  }
  player.controllable = false;
  cam.yaw = 0;
  cam.pitch = 0.2;
  cam.release(3.2);
  audio.bodyMove(1);
  g.echoes.leave(player.body.root, 3.5, 3.5);
  void film.open(SHOT.standing, [0.74, 0.42]);
  await clock.tween(1.9, (k) => {
    const e = smooth(k);
    player.pose.lie = 1 - e;
    player.pose.kneel = e;
    player.pose.headPitch = 0.3 * (1 - e);
  });
  void pulsePort(g);
  await clock.tween(1.5, (k) => (player.pose.kneel = 1 - smooth(k)));
  audio.hum(0.45, 6);
  // Her hands before her, palms up, and her eyes on them (as in the film).
  const f = V(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const hands = player.chestWorld(V()).addScaledVector(f, 0.32).add(V(0, -0.12, 0));
  player.lookTarget = hands;
  player.palmUp = 1; player.handOpen = 1;
  player.reachTarget.copy(hands);
  void clock.tween(1.2, (k) => (player.reachWeight = smooth(k) * 0.9));
  await film.until(SHOT.reflection);
  await film.close();
  await clock.tween(1, (k) => (player.reachWeight = 0.9 * (1 - smooth(k))));
  player.palmUp = 0; player.handOpen = 0; player.lookTarget = null;
}

/** Free walk through the grove to the still pool (the film's lines for it are spoken). */
async function explore(g: Game) {
  const { clock, ui, cam, player } = g;
  if (flatDist(player.position, WAKE_POINT) > 1.5 || player.pose.lie > 0) {
    resetBody(g);
    player.place(V(WAKE_POINT.x, 0, WAKE_POINT.z - 0.5), Math.PI);
    cam.release(0);
    cam.yaw = 0;
    void ui.fade(0, 1.5);
  }
  resetBody(g);
  player.controllable = true;
  // If she wanders, a faint light shows the way to the still pool.
  g.guide.setGoal(MIRROR);
  const start = player.position.clone();
  ui.showPrompt('move', 'WASD', 'drag on the left to move');
  void clock.until(() => flatDist(player.position, start) > 1.5).then(() => ui.hidePrompt());

  // Near the still pool, offer to kneel.
  for (;;) {
    await clock.until(() => flatDist(player.position, MIRROR) < 3.2);
    ui.showPrompt('look', 'E', 'look', true);
    await clock.until(() => g.input.actionPressed || flatDist(player.position, MIRROR) > 3.6);
    ui.hidePrompt();
    if (flatDist(player.position, MIRROR) <= 3.6) break;
  }
  g.guide.setGoal(null);
}

/** "in my reflection I saw someone lost / I wanted to be gentle with them too." */
async function reflection(g: Game) {
  const { clock, ui, cam, player } = g;
  const film = filmWindow(g);
  if (flatDist(player.position, MIRROR) > 4) {
    resetBody(g);
    player.place(V(MIRROR.x + 0.4, 0, MIRROR.z + 3), Math.PI);
    cam.release(0);
    void ui.fade(0, 1);
  }
  player.controllable = false;
  // Knees at the water line, leaning out so her face is over the pool.
  const { spot, yaw } = kneelSpot(player.position, MIRROR, 0.2);
  await kneelAt(g, spot, yaw, 1.0, 0.3, 1.8);

  // Look down into the pool at her own mirrored face. The bright water bounces skylight
  // up onto a face turned down to it; without this fill the reflection reads as a silhouette.
  await clock.sleep(0.05);
  const hemi = g.atmos.hemi;
  const ground0 = hemi.groundColor.clone(), hemi0 = hemi.intensity;
  const lit = new THREE.Color(0xf2ead8);
  void clock.tween(1.5, (k) => {
    hemi.groundColor.copy(ground0).lerp(lit, smooth(k));
    hemi.intensity = hemi0 + 1.1 * smooth(k);
  });
  const shot = reflectionShot(player);
  cam.cutTo(shot, 0);
  await film.open(SHOT.reflection, [0.72, 0.4]);
  // "in my reflection I saw someone lost" — then the film waits while she touches it.
  await film.until(SHOT.reflection + 3.8);
  film.pause();

  // Touch the reflection. Rough breaks it apart; gentle lets one ring pass over her face.
  const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
  // Touch beside the reflected face (her right side), so the arm doesn't cover it.
  const eye = player.eyeWorld();
  const rightDir = V(-fwd.z, 0, fwd.x);
  const contact = V(eye.x, WATER_LEVEL, eye.z).addScaledVector(fwd, 0.16).addScaledVector(rightDir, 0.1);
  const touch = await gentleTouch(g, contact, fwd, 0.18);
  film.resume();
  await Promise.all([touch.ripple(2, 2.4), film.until(SHOT.walk)]);
  touch.release();
  await film.close();
  cam.release(2.2);
  void clock.tween(2, (k) => {
    hemi.groundColor.copy(lit).lerp(ground0, smooth(k));
    hemi.intensity = hemi0 + 1.1 * (1 - smooth(k));
  });
  await standUp(g);
}

/** "I still don't know who I was / but I remember the water / and I want to know what I'll remember tomorrow." */
async function ending(g: Game) {
  const { clock, ui, cam, player, audio } = g;
  const film = filmWindow(g);
  if (flatDist(player.position, MIRROR) > 5) {
    resetBody(g);
    player.place(V(MIRROR.x - 0.6, 0, MIRROR.z - 2.2), Math.PI);
    cam.release(0);
    void ui.fade(0, 1);
  }
  resetBody(g);
  // She walks toward the light and the arches in the haze; the camera settles behind her head,
  // as in the film, while its last shot plays.
  player.controllable = false;
  cam.followBehind = true;
  player.autopilot = V(EXIT.x - player.position.x, 0, EXIT.z - player.position.z).normalize();
  const steer = g.onFrame(() => {
    player.autopilot = V(EXIT.x - player.position.x, 0, EXIT.z - player.position.z).normalize().lerp(V(-0.2, 0, -1), flatDist(player.position, EXIT) < 4 ? 0.5 : 0);
  });
  const d0 = cam.distance, p0 = cam.pitch;
  void clock.tween(6, (k) => { cam.distance = d0 + (1.6 - d0) * smooth(k); cam.pitch = p0 + (0.02 - p0) * smooth(k); });
  await film.open(SHOT.walk, [0.72, 0.42]);
  void clock.sleep(3.5).then(() => audio.motif(true));
  await film.until(SHOT.end - 1.4);
  void film.close();
  await ui.fade(1, 3.5, '#efe8d8');
  steer();
  player.autopilot = null;
  await ui.fade(1, 0.01, '#000');
  cam.followBehind = false;
  cam.distance = d0;
  cam.pitch = p0;
  await ui.card('AFTERIMAGE', 'part one', 5);
  // The grove chapter (afterimages) picks up from here with the screen still dark.
}
