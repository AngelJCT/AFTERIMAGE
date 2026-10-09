import * as THREE from 'three/webgpu';
import type { Game } from '../main';
import { CROSS_WAKE, POOL_EDGE, heightAt } from '../world/terrain';
import { compass } from './compass';
import { openWayToGate, setCloth } from './partII';

/**
 * V. The crossing (after the search, at dusk). No narration.
 *
 * She comes to on the ground beyond the arcade. The strip leans west, over a flooded channel.
 *
 * 1. The balance walk: a single fallen conduit bundle spans the channel. Hold forward (W / the
 *    stick) and she edges along it, arms out; lean against the sway with A / D. It sways more
 *    as she moves and when the wind pushes. Lean too far and she goes into the water: the
 *    moment fractures and rewinds to the start of the conduit.
 * 2. Past the two leaning slabs, the strip leans toward a still pool: the next chapter.
 *    (The squeeze between the slabs was cut, October 2026: it didn't add to the playthrough.
 *    The slabs stay as scenery; she walks past them.)
 */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (k: number) => k * k * (3 - 2 * k);
const WALK = 1.35;
const FALL = 0.55;          // lean (rad) past which she goes over

export async function runCrossing(g: Game) {
  const { clock, ui, player, audio, input, post, cam } = g;
  const X = g.crossing;
  if (!X) return;
  openWayToGate(g);
  setCloth('hand', 1);
  compass.listen = true;
  const v2 = (p: THREE.Vector3) => new THREE.Vector2(p.x, p.z);
  const ground = (p: THREE.Vector3) => p.clone().setY(heightAt(p.x, p.z));
  const dir = X.beamDir;
  const right = (yaw: number) => V(-Math.cos(yaw), 0, Math.sin(yaw));
  const beam0 = X.beamAt(0), beam1 = X.beamAt(1);
  const before = ground(beam0.clone().addScaledVector(dir, -0.9));
  const after = ground(beam1.clone().addScaledVector(dir, 0.9));
  const pool = ground(POOL_EDGE);

  // She comes to where the reboot left her: kneeling on the bank, the strip in her fist.
  player.floorY = null;
  player.autopilot = null;
  player.autopilotSpeed = WALK * 0.75;
  player.leftGrip = 1;
  player.reachWeight = 0; player.leftReachWeight = 0; player.lookTarget = null;
  const wake = ground(CROSS_WAKE);
  player.place(wake, Math.atan2(before.x - wake.x, before.z - wake.z));
  cam.yaw = player.yaw + Math.PI;
  cam.release(0);
  player.areas = [
    { a: v2(wake), b: v2(before), r: 2.6 },
    { a: v2(after), b: v2(pool), r: 2.4 },
    { a: v2(pool), b: v2(pool), r: 4.5 },
  ];
  Object.assign(player.pose, { kneel: 1, lie: 0, lean: 0.2, headPitch: 0.3 });
  void ui.fade(0, 2.5);
  await clock.sleep(1.6);
  audio.bodyMove(0.6);
  g.echoes.leave(player.body.root, 3, 3.5);
  await clock.tween(2.2, (k) => { const e = smooth(k); player.pose.kneel = 1 - e; player.pose.lean = 0.2 * (1 - e); player.pose.headPitch = 0.3 * (1 - e); });
  player.controllable = true;
  compass.target = before.clone();
  // The grove's theme, held far back (it comes forward at the still pool).
  audio.setIntensity(0.4, 0.1);
  void audio.playMusic('grove', 8);

  // ── 1. The conduit over the channel ────────────────────────────────────────────
  await clock.until(() => Math.hypot(player.position.x - before.x, player.position.z - before.z) < 1.1);
  compass.target = null;
  player.controllable = false;
  const yaw = Math.atan2(dir.x, dir.z);
  {
    const from = player.position.clone(), y0 = player.yaw;
    const dy = Math.atan2(Math.sin(yaw - y0), Math.cos(yaw - y0));
    audio.bodyMove(0.5);
    await clock.tween(0.9, (k) => {
      const e = smooth(k);
      player.position.lerpVectors(from, beam0, e);
      player.yaw = y0 + dy * e;
    });
  }
  let s = 0, th = 0, om = 0, gust = 0, gustT = 3, fell = false, walking = 0;
  // On the conduit only while she's on it (the walkable areas would pull her back to the bank).
  const onBeam = { a: v2(beam0), b: v2(beam1), r: 0.2 };
  player.areas.push(onBeam);
  player.floorY = () => X.beamAt(s).y;
  // Behind her, low, looking along the conduit; the horizon tips a little with her.
  const shot = { position: V(), target: V(), lens: 32, range: 5, bokeh: 1.2, handheld: 0.6, up: V(0, 1, 0) };
  const frameShot = () => {
    const p = player.position;
    shot.position.copy(p).addScaledVector(dir, -2.5).addScaledVector(right(yaw), 0.35).add(V(0, 1.45, 0));
    shot.target.copy(p).addScaledVector(dir, 3).add(V(0, 0.75, 0));
    shot.up.set(0, 1, 0).applyAxisAngle(dir, th * 0.22);
  };
  frameShot();
  cam.cutTo(shot, 1.2);
  ui.showPrompt('lean against the sway', 'W  ·  A / D', 'forward, and lean', false);
  void clock.sleep(1.5).then(() => ui.objective('cross the channel', 5));
  let prompted = true;
  const v = V();
  const balancing = g.onFrame((dt) => {
    if (fell) return;
    const fwd = input.move.y > 0.3 || (Math.hypot(input.move.x, input.move.y) > 0.3 && input.touch && input.move.y > -0.2);
    walking += ((fwd ? 1 : 0) - walking) * (1 - Math.exp(-dt * 4));
    const speed = 0.5 * walking * Math.max(0, 1 - Math.abs(th) / 0.42);
    if (prompted && walking > 0.5) { ui.hidePrompt(); prompted = false; }
    // The wind pushes now and then (harder when it's up).
    if ((gustT -= dt) <= 0) { gust = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.6) * Math.min(1.6, audio.windLevel); gustT = 2.4 + Math.random() * 3; }
    gust *= Math.exp(-dt * 1.4);
    // An inverted pendulum she holds up by leaning (A / D), less steady while she moves.
    const lean = THREE.MathUtils.clamp(input.move.x, -1, 1);
    const acc = (2.4 + walking * 2.2) * th + gust - lean * 3.6 - 2.3 * om + (Math.random() - 0.5) * 0.8;
    om += acc * dt;
    th += om * dt;
    s = Math.min(1, s + (speed * dt) / X.beamLength);
    // On the line exactly (the body's own step adds its velocity back on).
    X.beamAt(s, v);
    player.velocity.copy(dir).multiplyScalar(speed);
    player.position.copy(v).addScaledVector(player.velocity, -dt * Math.exp(-8 * dt));
    player.yaw = yaw;
    player.root.rotation.z = th * 0.45;
    // Arms out for balance, the higher one on the side she's falling from.
    const chest = player.chestWorld(V());
    const r = right(yaw);
    player.reachTarget.copy(chest).addScaledVector(r, 0.62).add(V(0, 0.02 + th * 0.35, 0));
    player.leftReachTarget.copy(chest).addScaledVector(r, -0.62).add(V(0, 0.02 - th * 0.35, 0));
    player.reachWeight = 0.9; player.leftReachWeight = 0.9;
    player.handOpen = 1; player.palmUp = 0;
    player.leftAim = r.clone().negate();
    frameShot();
    if (Math.abs(th) > 0.3 && Math.random() < dt * 2) audio.creak(player.position);
    if (Math.abs(th) > FALL) fell = true;
  });
  while (s < 1) {
    await clock.until(() => fell || s >= 1);
    if (!fell) break;
    // Over she goes: into the dark water, and the moment fractures and rewinds.
    ui.hidePrompt();
    const side = Math.sign(th) || 1;
    const drop = player.position.clone();
    let y = drop.y;
    player.floorY = () => y;
    audio.surge();
    await clock.tween(0.6, (k) => {
      y = drop.y - 0.5 * 9.8 * (0.6 * k) ** 2;
      player.position.copy(drop).addScaledVector(right(yaw), side * 0.6 * k);
      player.root.rotation.z = side * (FALL + 0.9 * k);
      post.uDrain.value = 0.85 * smooth(k);
      g.afterimage = 0.9 * k;
    });
    g.water.addRipple(drop.x, drop.z, 0.02);
    audio.thud(0.35);
    await ui.fade(1, 0.25, '#e8e2d8');
    s = 0; th = 0; om = 0; gust = 0; walking = 0;
    player.root.rotation.z = 0;
    player.floorY = () => X.beamAt(s).y;
    player.position.copy(beam0);
    player.velocity.set(0, 0, 0);
    frameShot();
    await clock.sleep(0.3);
    void ui.fade(0, 0.9, '#e8e2d8');
    await clock.tween(1.3, (k) => { post.uDrain.value = 0.85 * (1 - smooth(k)); g.afterimage = 0.9 * (1 - k); });
    post.uDrain.value = 0; g.afterimage = 0;
    fell = false;
    ui.showPrompt('lean against the sway', 'W  ·  A / D', 'forward, and lean', false);
    prompted = true;
  }
  balancing();
  ui.hidePrompt();
  player.areas = player.areas.filter((a) => a !== onBeam);
  // Down off the far end.
  player.root.rotation.z = 0;
  player.reachWeight = 0; player.leftReachWeight = 0; player.leftAim = null;
  {
    const from = player.position.clone();
    player.floorY = null;
    audio.bodyMove(0.5);
    await clock.tween(0.8, (k) => player.position.lerpVectors(from, after, smooth(k)));
  }
  cam.release(1.4);
  player.controllable = true;

  // ── 2. Toward the still pool, past the slabs ──────────────────────────────────
  compass.target = pool.clone();
  audio.setIntensity(0.75, 6);
  await clock.until(() => Math.hypot(player.position.x - pool.x, player.position.z - pool.z) < 1.6);
  compass.target = null;
}
