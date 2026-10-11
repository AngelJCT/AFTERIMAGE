import * as THREE from 'three/webgpu';
import type { Game } from '../main';
import { POOL_EDGE, STILL_POOL, STILL_RADIUS, heightAt } from '../world/terrain';
import { REFLECTION_ONLY } from '../world/mirrorWorld';
import { compass } from './compass';
import { openWayToGate, setCloth } from './partII';
import { kneelAt } from './partI';

/**
 * VI. The other side (after the crossing). No narration.
 *
 * At the still pool she kneels and looks in, as she did at the mirror pool the day she woke.
 * Closing her eyes (hold E) she passes through: when they open it is night and the water is
 * still, dark glass, and in it, only in it, a way of pale glass plates lit at their edges,
 * with small ochre lights floating beside it, runs across the pool to an arch. Looking at her, she stands on bare water; looking
 * at the water, she walks the causeway. Off it, the water takes her: she sinks, and the moment
 * rewinds to the last stone she stood on. At the arch, she comes back to the dusk.
 */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (k: number) => k * k * (3 - 2 * k);
const SAFE = 0.62;    // how far from the causeway's centre line is still on it (m)
const SINK = 0.55;    // how deep she goes before it rewinds (m)
/** The main theme's shape (seconds): a breath, the climax, the hard stop (see trailer.ts). */
const THEME = { breath: 73.1, hit: 76.55, stop: 101.0 };

export async function runMirror(g: Game) {
  const { clock, ui, player, audio, input, post, cam, water } = g;
  const M = g.mirrorWorld;
  if (!M) return;
  openWayToGate(g);
  setCloth('hand', 1);
  player.leftGrip = 1;
  player.floorY = null;
  player.autopilot = null;
  const v2 = (p: THREE.Vector3) => new THREE.Vector2(p.x, p.z);
  const ground = (p: THREE.Vector3) => p.clone().setY(heightAt(p.x, p.z));
  const edge = ground(POOL_EDGE);
  const first = M.path.getPointAt(0.02);
  const faceYaw = Math.atan2(first.x - edge.x, first.z - edge.z);
  if (player.position.distanceTo(edge) > 4) {
    player.place(edge, faceYaw);
    cam.yaw = faceYaw + Math.PI;
    cam.release(0);
    void ui.fade(0, 2);
  }
  const arch = ground(M.arch);
  player.areas = [
    { a: v2(edge), b: v2(edge), r: 2.5 },
    { a: v2(STILL_POOL), b: v2(STILL_POOL), r: STILL_RADIUS + 0.6 },
    { a: v2(arch), b: v2(arch), r: 2.4 },
  ];
  compass.target = null;
  compass.listen = false;

  // ── 1. Looking in ──────────────────────────────────────────────────────────────
  player.controllable = false;
  await kneelAt(g, edge, faceYaw, 0.35, 0.55, 1.6);
  // High over her shoulder, down at the water: her reflection, the dusk sky in it.
  const f = V(Math.sin(faceYaw), 0, Math.cos(faceYaw));
  const l = V(Math.cos(faceYaw), 0, -Math.sin(faceYaw));
  const down = { position: edge.clone().addScaledVector(f, -0.9).addScaledVector(l, -0.5).add(V(0, 2.3, 0)), target: edge.clone().addScaledVector(f, 2.2).add(V(0, -0.3, 0)), lens: 30, range: 4, bokeh: 1, handheld: 0.4 };
  cam.cutTo(down, 2.2);
  audio.stopMusic(3);
  await clock.sleep(3);
  ui.showPrompt('close your eyes', 'hold E', 'hold to close your eyes', true);
  let closed = 0, heldShut = 0;
  const shutting = g.onFrame((dt) => {
    const want = input.actionHeld ? 1 : 0;
    closed += (want - closed) * (1 - Math.exp(-dt * (want ? 1.4 : 3)));
    player.eyelids = Math.min(1, closed * 1.9);
    post.uEyesClosed.value = Math.max(0, (closed - 0.4) / 0.6);
    audio.setClosed(closed);
    heldShut = closed > 0.95 ? heldShut + dt : 0;
    if (want) ui.hidePrompt(); else ui.showPrompt('close your eyes', 'hold E', 'hold to close your eyes', true);
  });
  await clock.until(() => heldShut > 1.4);
  shutting();
  ui.hidePrompt();

  // ── Through ──
  // Behind her lids, the world turns over: night, the water all glass, the causeway in it.
  audio.surge();
  g.weather.set('other', 0);
  water.uGlass.value = 1;
  water.showInReflection(cam.camera, REFLECTION_ONLY, true);
  M.group.visible = true;
  M.uWay.value = 1;
  audio.duck(0.35, 2);
  // The main theme, from its quiet start, carries her across (the grove's cue if it isn't there).
  void audio.playMusic('title', 5).then((ok) => {
    if (!ok) void audio.playMusic('grove', 4).then(() => { audio.setLayer('voice', 1, 2); audio.setIntensity(0.55, 2); });
  });
  await clock.sleep(1.2);
  ui.showPrompt('open your eyes', 'release E', 'let go', true);
  if (input.actionHeld) await clock.until(() => !input.actionHeld);
  ui.hidePrompt();
  input.release();
  await clock.tween(2.2, (k) => {
    const c = 1 - smooth(k);
    player.eyelids = Math.min(1, c * 1.9);
    post.uEyesClosed.value = Math.max(0, (c - 0.4) / 0.6);
    audio.setClosed(c);
  });
  player.eyelids = 0; post.uEyesClosed.value = 0; audio.setClosed(0);
  // She takes it in: the lights under the water leading away.
  await clock.sleep(3.2);
  g.echoes.leave(player.body.root, 3, 3.5);
  await clock.tween(1.4, (k) => { const e = smooth(k); player.pose.kneel = 1 - e; player.pose.lean = 0.35 * (1 - e); player.pose.headPitch = 0.55 * (1 - e * 0.6); });
  cam.release(2);
  player.controllable = true;
  ui.objective('the way is in the water', 6);
  void clock.sleep(6.5).then(() => ui.hintOnce('hint:mirrorLook', 'look down into the water', g.input.padActive ? 'right stick' : 'drag', 'drag to look down', 6));
  compass.target = arch.clone();
  compass.listen = true;

  // ── 2. Across the water ────────────────────────────────────────────────────────
  let sink = 0, sinking = false;
  const lastSafe = edge.clone();
  const onWater = () => heightAt(player.position.x, player.position.z) < -0.02;
  player.floorY = () => {
    const h = heightAt(player.position.x, player.position.z);
    return h > -0.02 ? h : 0.02 - sink;
  };
  const walking = g.onFrame((dt) => {
    if (sinking) return;
    const p = player.position;
    if (!onWater()) { sink = Math.max(0, sink - dt * 2); lastSafe.copy(p); return; }
    if (M.offPath(p.x, p.z) < SAFE) {
      sink = Math.max(0, sink - dt * 1.5);
      if (sink < 0.02) lastSafe.copy(p);
    } else {
      // Off the causeway the water gives, slowly at first.
      sink += dt * (0.18 + sink * 1.6);
      if (Math.random() < dt * 5) water.addRipple(p.x, p.z, 0.0012);
      if (sink > SINK) sinking = true;
    }
  });
  const atArch = () => Math.hypot(player.position.x - arch.x, player.position.z - arch.z) < 1.3;
  for (;;) {
    await clock.until(() => sinking || atArch());
    if (!sinking) break;
    // Under: the moment fractures and rewinds to the last stone.
    player.controllable = false;
    audio.surge();
    water.addRipple(player.position.x, player.position.z, 0.006);
    await clock.tween(0.6, (k) => { sink = SINK + 0.9 * k; post.uDrain.value = 0.8 * smooth(k); g.afterimage = 0.8 * k; });
    await ui.fade(1, 0.25, '#0c0e12');
    player.place(lastSafe, player.yaw);
    sink = 0;
    await clock.sleep(0.3);
    void ui.fade(0, 0.9);
    await clock.tween(1.2, (k) => { post.uDrain.value = 0.8 * (1 - smooth(k)); g.afterimage = 0.8 * (1 - k); });
    post.uDrain.value = 0; g.afterimage = 0;
    sinking = false;
    player.controllable = true;
    ui.hintOnce('hint:mirrorStones', 'keep to the light in the reflection', '', 'keep to the light in the reflection', 6);
  }
  walking();

  // ── 3. The arch ────────────────────────────────────────────────────────────────
  player.controllable = false;
  compass.target = null;
  // Low over the water: she stands in the arch's reflection.
  const back = arch.clone().sub(M.path.getPointAt(0.8)).setY(0).normalize();
  const side = V(-back.z, 0, back.x);
  const low = { position: arch.clone().addScaledVector(back, -4.2).addScaledVector(side, 1.2).add(V(0, 0.45, 0)), target: arch.clone().add(V(0, -1.2, 0)), lens: 28, range: 6, bokeh: 1, handheld: 0.5 };
  cam.cutTo(low, 1.6);
  // The way of light dims: she stands in the arch's reflection with nothing before it.
  void clock.tween(2.5, (k) => { M.uWay.value = 1 - 0.9 * smooth(k); });
  player.lookTarget = arch.clone().addScaledVector(back, -1.5).add(V(0, -0.2, 0));
  // With the theme: wherever it has got to, it moves to the breath before its climax, so the
  // climax comes as she stands in the arch; the camera rises through it toward the ring, and on
  // the song's hard stop her eyes close. (Arriving late, it just plays on from where it is.)
  let tm = audio.musicTime('title');
  const theme = tm !== null && tm < THEME.stop - 2;
  if (theme) {
    if (tm! < THEME.breath) { await audio.playMusic('title', 1.2, THEME.breath); tm = THEME.breath; }
    const from = Math.max(tm!, THEME.hit);
    const ring = g.ring.group.position;
    const through = ring.clone().sub(arch).setY(0).normalize();
    const high = {
      position: arch.clone().addScaledVector(through, -5.5).addScaledVector(side, 1.3).add(V(0, 2.4, 0)),
      target: arch.clone().addScaledVector(through, 25).add(V(0, 4.2, 0)),
    };
    const lowAt = { position: low.position.clone(), target: low.target.clone() };
    const rising = g.onFrame(() => {
      const now = audio.musicTime('title') ?? THEME.stop;
      const k = smooth(THREE.MathUtils.clamp((now - from) / (THEME.stop - 1.5 - from), 0, 1));
      low.position.lerpVectors(lowAt.position, high.position, k);
      low.target.lerpVectors(lowAt.target, high.target, k);
    });
    await clock.until(() => (audio.musicTime('title') ?? THEME.stop) >= THEME.stop - 1.6);
    rising();
  } else {
    await clock.sleep(4);
  }
  // She closes her eyes, and comes back to the dusk.
  await clock.tween(1.6, (k) => { player.eyelids = smooth(k); post.uEyesClosed.value = smooth(k); });
  // (The theme's quiet close plays on under the return and the card.)
  if (!theme) audio.stopMusic(3);
  audio.portChime(0.6);
  g.weather.set('dusk', 0);
  water.uGlass.value = 0;
  water.showInReflection(cam.camera, REFLECTION_ONLY, false);
  M.group.visible = false;
  player.floorY = null;
  audio.duck(1, 2);
  await clock.sleep(1);
  await clock.tween(1.8, (k) => { player.eyelids = 1 - smooth(k); post.uEyesClosed.value = 1 - smooth(k); });
  player.lookTarget = null;
  await clock.sleep(3);
  await ui.fade(1, 3);
  await ui.card('AFTERIMAGE', 'the other side', 4);
}
