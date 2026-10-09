import * as THREE from 'three/webgpu';
import type { Game } from '../main';
import { gateLocal, heightAt, LIFT } from '../world/terrain';
import { MemoryShards } from '../world/memoryShards';
import { compass } from './compass';
import { Lift } from '../world/lift';
import { uPortGlow } from '../player/placeholder';
import { progress } from './progress';
import { openWayToGate, setCloth } from './partII';
import { memoryClip } from './partIIPast';
import { warmth, NAMES, ORDER } from './afterimages';
import { RouteCollapse } from '../world/routeCollapse';

/**
 * The search (after Part II): "now I have someone to find". No narration — the films' lines
 * are all spoken; this is hers to walk.
 *
 * 1. Memory shards: beyond the gate, the moment the child went on hangs in the air as broken
 *    crystal. From one place, looking one way, the pieces line up (the perception puzzle);
 *    then it plays, and small steps show the way she went.
 * 2. Power at a cost: the way on is up a dead lift to the elevated route. It only rises while
 *    she gives it power with her hand on its receiver, and what it takes is a memory: colour
 *    drains, the view fractures, and at the top one of the grove's afterimages is gone for
 *    good (its album frame drained and cracked, its warmth out of the light).
 * 3. Afterimage trails through both: the memory's arrival and the price leave ghosts.
 */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (k: number) => k * k * (3 - 2 * k);

// Gate-local layout (the far side of the gate is −z; the arcade runs along x at z ≈ −17).
const START = [-11.5, -2.5] as const;      // round the ruined end of the left wall (Part II's end)
const STAND = [-7.6, -5.6] as const;       // where the pieces line up (the follow camera behind her)
const PIECES = [-3.2, 2.5, -11.2] as const; // the middle of the broken picture (clear of the water)
const ESCAPE = { from: 54.6, to: 58.2 };   // the child going on (past clip seconds, S18)

let shards: MemoryShards | null = null;
let lift: Lift | null = null;

function deckTop(g: Game) {
  const arches = g.scene.getObjectByName('arches');
  return (arches ? arches.position.y : heightAt(LIFT.x, LIFT.z)) + 10.26;
}

export async function runSearch(g: Game) {
  const { clock, ui, player, audio, input, post, cam } = g;
  const gate = g.gate;
  if (!gate) return;
  openWayToGate(g);
  setCloth('hand', 1);
  player.leftGrip = 1;
  const at = (x: number, z: number) => { const p = gateLocal(x, z); p.y = heightAt(p.x, p.z); return p; };
  const start = at(...START), stand = at(...STAND);
  const piecesAt = gateLocal(PIECES[0], PIECES[2]).setY(heightAt(stand.x, stand.z) + PIECES[1]);
  const lookDir = V(piecesAt.x - stand.x, 0, piecesAt.z - stand.z).normalize();
  const view = stand.clone().addScaledVector(lookDir, -3.06).setY(stand.y + 1.9);

  // Where she may walk now: from the wall's end to the lift, past the pieces.
  const v2 = (p: THREE.Vector3) => new THREE.Vector2(p.x, p.z);
  const liftAt = LIFT.clone();
  player.areas = [
    ...player.areas.filter((a) => a.r >= 16),                       // the gate's yard
    { a: v2(start), b: v2(stand), r: 5.5 },
    { a: v2(stand), b: v2(liftAt), r: 5 },
    { a: v2(liftAt), b: v2(liftAt), r: 4 },
  ];
  // Cold start: at the wall's end, the strip in her hand.
  if (player.position.distanceTo(start) > 6) {
    player.place(start, Math.atan2(stand.x - start.x, stand.z - start.z));
    cam.yaw = player.yaw + Math.PI;
  }
  void ui.fade(0, 2.5);
  Object.assign(player.pose, { kneel: 0, lie: 0, lean: 0, headPitch: 0 });
  player.reachWeight = 0; player.leftReachWeight = 0; player.eyelids = 0; player.lookTarget = null;
  cam.release(0);
  player.controllable = true;
  post.uWarm.value = warmth();
  void audio.playMusic('grove', 4);

  // Dev: `?beat=search&at=route` starts on the elevated route.
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('at') === 'route') {
    lift ??= new Lift(g.scene, liftAt, gate.root.rotation.y, deckTop(g));
    lift.height = lift.travel;
    const d = gateLocal(-6.2, -17.16);
    const onto = V(d.x, deckTop(g), d.z);
    player.place(onto, 0);
    player.floorY = () => onto.y;
    void ui.fade(0, 1);
    return runRoute(g, onto, true);
  }

  // ── 1. The memory in pieces ─────────────────────────────────────────────────────
  shards ??= new MemoryShards(g.scene, `${import.meta.env.BASE_URL}video/stills/escape.jpg`, view, piecesAt, { fov: 24, seed: 5 });
  const sh = shards;
  sh.visible = true;
  // The strip in her fist leans toward the place (stand still to see it pull; close her eyes
  // to feel it).
  compass.target = stand;
  compass.listen = true;
  let held = 0, hinted = false, locked = false, t0 = clock.time, still = 0;
  // The goal, once, after the chapter's title; then the strip, taught the first time she stops.
  void clock.sleep(7.5).then(() => { if (!locked) ui.objective('follow the strip in her hand', 6); });
  // Where the pieces line up: once she reaches the place the strip leads her to, she steps in
  // and faces them, and the view settles to that one point (the pieces gather as it arrives).
  const viewShot = { position: view.clone(), target: piecesAt.clone(), lens: 35, range: 8, bokeh: 0.6, handheld: 0.3 };
  const lock = async () => {
    locked = true;
    player.controllable = false;
    compass.target = null;
    ui.hidePrompt();
    const from = player.position.clone(), y0 = player.yaw, yaw = Math.atan2(lookDir.x, lookDir.z);
    const dy = Math.atan2(Math.sin(yaw - y0), Math.cos(yaw - y0));
    cam.cutTo(viewShot, 2.4);
    await clock.tween(0.9, (k) => { player.position.lerpVectors(from, stand, smooth(k)); player.yaw = y0 + dy * smooth(k); });
  };
  const looking = g.onFrame((dt) => {
    const a = sh.update(dt, cam.camera, 1);
    g.afterimage = sh.gathered * 0.45;
    uPortGlow.value = 1 + a * 0.8 * (0.5 + 0.5 * Math.sin(clock.time * 5));
    held = a > 0.72 ? held + dt : Math.max(0, held - dt * 2);
    if (!locked && player.controllable && Math.hypot(player.position.x - stand.x, player.position.z - stand.z) < 1.6) void lock();
    // Teach the strip: the first time she stops a moment, say what to watch; and if she hasn't
    // found the place after a while, one quiet nudge to stop and let it show the way.
    still = Math.hypot(player.velocity.x, player.velocity.z) < 0.15 && player.controllable ? still + dt : 0;
    if (!locked && still > 1.2 && clock.time - t0 > 9) ui.hintOnce('hint:strip', 'it leans the way · stand still and watch', '', 'stand still and watch the strip', 6);
    if (!locked && !hinted && clock.time - t0 > 20) { hinted = true; ui.showPrompt('stand still', '', 'stand still', false); }
    if (hinted && compass.pull > 0.6) { ui.hidePrompt(); }
  });
  await clock.until(() => held > 0.7);
  looking();
  ui.hidePrompt();
  compass.target = null;
  // It holds: the picture whole for a moment, then it plays.
  player.controllable = false;
  sh.hold();
  audio.portChime(0.8);
  audio.motifNote(0);
  g.afterimage = 0.6;
  audio.stopMusic(2);
  await clock.sleep(1.6);
  void audio.playMusic('past', 1.5);
  await memoryClip(g, ESCAPE.from, ESCAPE.to, [0.5, 0.45]);
  // The pieces fall apart after it.
  await clock.tween(1.5, (k) => { sh.opacity = 1 - k; });
  sh.visible = false;
  g.afterimage = 0;
  audio.stopMusic(3);

  // The way she went: the strip leans toward the arcade. The wind is getting up.
  g.weather.between('late', 'storm', 0.3, 20);
  compass.target = liftAt;
  cam.release(1.8);
  player.controllable = true;
  void audio.playMusic('grove', 4);

  // ── 2. The lift, and what it costs ─────────────────────────────────────────────
  lift ??= new Lift(g.scene, liftAt, gate.root.rotation.y, deckTop(g));
  const lf = lift;
  lf.height = 0;
  const onPlatform = () => Math.hypot(player.position.x - liftAt.x, player.position.z - liftAt.z) < 0.75;
  await clock.until(() => onPlatform());
  compass.target = null;
  player.controllable = false;
  // Face the receiver; her right hand on the plate.
  const face = V(0, 0, -1).applyQuaternion(lf.root.quaternion);
  const spot = lf.local(0.05, 0.05);
  const from = player.position.clone(), y0 = player.yaw, yaw = Math.atan2(face.x, face.z);
  const dy = Math.atan2(Math.sin(yaw - y0), Math.cos(yaw - y0));
  await clock.tween(0.7, (k) => { player.position.lerpVectors(from, spot, smooth(k)); player.yaw = y0 + dy * smooth(k); });
  player.floorY = () => lf.floor();
  player.palmUp = 1; player.handOpen = 1; player.handSpread = 0.2;
  const handOn = g.onFrame(() => player.reachTarget.copy(lf.plate()).add(face.clone().multiplyScalar(0.02)));
  void clock.tween(0.8, (k) => (player.reachWeight = smooth(k)));
  player.lookTarget = lf.plate();
  // A wide, low from the gate side: the arcade above, the lift beginning to climb.
  const ride = { position: gateLocal(-1.2, -7.5).setY(1.6), target: V(), lens: 32, range: 6, bokeh: 1.5, handheld: 0.5 };
  const frameRide = () => { ride.target.copy(liftAt).setY(lf.floor() + 1.4); ride.position.y = Math.max(1.6, lf.floor() * 0.55 + 1.2); };
  frameRide();
  cam.cutTo(ride, 1.2);
  audio.stopMusic(3);
  ui.showPrompt('give it power', 'hold E', 'hold to give it power', true);
  let spentIt = false;
  const powering = g.onFrame((dt) => {
    const k = lf.height / lf.travel;
    if (input.actionHeld) {
      ui.hidePrompt();
      lf.height = lf.height + dt * 0.9;
      lf.power.value += (1 - lf.power.value) * (1 - Math.exp(-dt * 4));
      // What it takes: colour, then the view itself, a little more the higher she goes.
      post.uDrain.value += (0.25 + 0.65 * k - post.uDrain.value) * (1 - Math.exp(-dt * 2));
      audio.setIntensity(0.45 + 0.55 * k, 0.5);
      g.afterimage = 0.35 + 0.35 * k;
      uPortGlow.value = 1.6 + 0.8 * Math.sin(clock.time * 17) * Math.sin(clock.time * 5.3);
      cam.shake(0.01 + 0.03 * k);
      if (Math.random() < dt * 1.2) audio.hum(0.9, 0.4);
    } else {
      lf.power.value *= Math.exp(-dt * 3);
      post.uDrain.value *= Math.exp(-dt * 0.8);
      g.afterimage = 0.1;
      uPortGlow.value += (0.8 - uPortGlow.value) * (1 - Math.exp(-dt * 2));
      if (!spentIt) ui.showPrompt('give it power', 'hold E', 'hold to give it power', true);
    }
    frameRide();
  });
  audio.charge(lf.plate(), 12);
  await clock.until(() => lf.height >= lf.travel - 0.01);
  spentIt = true;
  powering();
  input.release();
  audio.setIntensity(1, 2);
  ui.hidePrompt();

  // The price: one memory, gone.
  const lost = progress.spendOne();
  audio.surge();
  // Its pane by the tower cracks and comes apart, and for a moment everything is her colour.
  if (lost) g.panes.spend(lost);
  void g.flood(0x4fd8ff, 1.4);
  g.echoes.leave(player.body.root, 0.4, 2.4);
  g.flakes.burst(player.position.clone().setY(player.position.y + 1.1), 0.35, 70, 0.04, 0.7);
  cam.shake(0.4);
  await clock.tween(1.2, (k) => { post.uDrain.value = 0.9 + 0.1 * Math.sin(k * Math.PI); g.afterimage = 0.8; uPortGlow.value = 1.6 * (1 - k) + 0.25; });
  lf.power.value = 0;
  handOn();
  void clock.tween(0.8, (k) => (player.reachWeight = 1 - smooth(k)));
  player.eyelids = 0.7;
  await clock.sleep(0.8);
  if (lost) audio.motifNote(Math.max(0, progress.found.indexOf(lost)));
  // What it cost, named: the row of what she holds, one gone dark.
  if (lost) ui.showFound(progress.found.length - progress.spent.length, ORDER.length, `spent · ${NAMES[lost] ?? ''}`, 6);
  const warm0 = post.uWarm.value, warm1 = warmth();
  await clock.tween(3.2, (k) => {
    const e = smooth(k);
    post.uDrain.value = 0.9 * (1 - e);
    post.uWarm.value = warm0 + (warm1 - warm0) * e;
    g.afterimage = 0.8 * (1 - e);
    uPortGlow.value = 0.25 + 0.75 * e;
  });
  player.eyelids = 0;
  post.uDrain.value = 0;
  g.afterimage = 0;

  // Onto the elevated route. The way on runs to screen-left.
  const deck = gateLocal(-6.2, -17.16);
  const top = lf.floor();
  const off = player.position.clone();
  const onto = V(deck.x, top, deck.z);
  await clock.tween(1.4, (k) => { player.position.lerpVectors(off, onto, smooth(k)); });
  await runRoute(g, onto, true);
}

// ── 4. The route gives way ─────────────────────────────────────────────────────────
// Past the lift the deck behind her starts to go, span after span, and it chases her along
// the arcade (right to left) to the solid far end. Hold a direction and she runs. If it takes
// the deck from under her, the moment fractures and rewinds to where the run began: no death,
// no fail screen, only the cost of doing it again.
const ROUTE_Z = -17.16;
const RUN_FROM = -9.8;      // where the rumble starts (clear of the lift, for the side shot)
const SAFE_AT = -25.6;      // on the whole far end (deck_00 ends at −24.8)
const HOLDS_FROM = -24.6;   // pieces ending left of this stay

let collapse: RouteCollapse | null = null;

async function runRoute(g: Game, onto: THREE.Vector3, intro: boolean) {
  const { clock, ui, player, audio, input, post, cam } = g;
  const arches = g.scene.getObjectByName('arches');
  const top = deckTop(g);
  const v2 = (p: THREE.Vector3) => new THREE.Vector2(p.x, p.z);
  const along = gateLocal(-22, ROUTE_Z), end = gateLocal(-31, ROUTE_Z);
  const ax = gateLocal(1, ROUTE_Z).sub(gateLocal(0, ROUTE_Z));      // along the arcade (+x)
  const az = gateLocal(0, ROUTE_Z + 1).sub(gateLocal(0, ROUTE_Z));  // toward the gate side
  player.floorY = () => top;
  player.areas = [{ a: v2(onto), b: v2(end), r: 1.0 }];
  const blockers = player.blockers;
  player.blockers = [];
  compass.listen = true;

  if (intro) {
    player.lookTarget = V(along.x, top + 1.5, along.z);
    player.yaw = Math.atan2(along.x - onto.x, along.z - onto.z);
    // Behind her on the route, clear of the lift: the way on runs away to screen-left.
    const back = ax.clone().multiplyScalar(3.2);
    const vista = { position: V(onto.x, top + 1.7, onto.z).add(back).addScaledVector(az, -0.74), target: V(along.x, top + 1.1, along.z), lens: 28, range: 8, bokeh: 1, handheld: 0.4 };
    cam.cutTo(vista, 0);
    void audio.playMusic('trace', 3);
    await clock.sleep(5);
    player.lookTarget = null;
    cam.release(2.4);
    player.controllable = true;
    // Along the route, the strip keeps leaning the way she went.
    compass.target = along.clone().setY(top);
  }
  if (!arches) {
    await clock.until(() => Math.hypot(player.position.x - onto.x, player.position.z - onto.z) > 6);
    return routeEnd(g, blockers);
  }
  collapse ??= new RouteCollapse(arches, g.scene);
  const rc = collapse;
  rc.reset();
  rc.groundY = heightAt(gateLocal(-15, ROUTE_Z).x, gateLocal(-15, ROUTE_Z).z);
  const x = () => rc.along(player.position);
  await clock.until(() => x() < RUN_FROM);

  // The first give: a groan through the stone, grit off the parapet, a look back.
  compass.target = null;
  player.controllable = false;
  audio.groan(0.7, 1.6);
  cam.shake(0.12);
  player.lookTarget = player.position.clone().addScaledVector(ax, 6).setY(top + 0.6);
  await clock.sleep(0.9);
  player.lookTarget = null;
  const startAt = player.position.clone();
  const startYaw = Math.atan2(-ax.x, -ax.z);
  void audio.playMusic('gate', 0.6);
  audio.setIntensity(1, 0.3);
  // The collapse throws up dust on the wind.
  g.weather.set('storm', 4);
  audio.setLayer('pulse', 1, 0.5);

  // Side on, from the gate's side of the arcade: she runs right to left across the frame.
  const shot = { position: V(), target: V(), lens: 30, range: 10, bokeh: 0.6, handheld: 0.9 };
  let lead = 0;
  const frame = (dt: number) => {
    const spd = Math.hypot(player.velocity.x, player.velocity.z);
    lead += (Math.min(1, spd / 3) - lead) * (1 - Math.exp(-dt * 1.5));
    shot.position.copy(player.position).addScaledVector(az, 9.5).addScaledVector(ax, 1.0 + lead * 0.3).setY(top + 1.1);
    shot.target.copy(player.position).addScaledVector(ax, 0.5 - lead * 0.2).setY(top + 0.6);
  };
  frame(0);
  cam.cutTo(shot, 1.1);

  let front = 0, caught = false, safe = false;
  const restart = () => {
    rc.reset();
    front = x() + 7;
    rc.origin = front + 0.5;
    caught = false;
  };
  restart();
  rc.onBreak = (w) => { const d = w.distanceTo(player.position); audio.thud(0.5 / (1 + d * 0.15)); cam.shake(0.1 / (1 + d * 0.2)); g.flakes.burst(w, 0.9, 16, 0.07, 0.45); };
  rc.onLand = (w) => { const d = w.distanceTo(player.position); audio.thud(Math.min(1, 1.4 / (1 + d * 0.08))); cam.shake(0.14 / (1 + d * 0.1)); g.flakes.burst(w, 1.4, 26, 0.08, 0.6); };
  ui.showPrompt('run', 'hold ← / A', 'hold to run', false);
  let prompted = true;
  player.autopilotSpeed = 3.0;
  const chase = g.onFrame((dt) => {
    frame(dt);
    const hx = x();
    // The front: steady at first, closing in if she gets away, so it is always just behind.
    const gap = front - hx;
    front -= dt * (safe ? 2.8 : Math.min(4.5, 2.35 + Math.max(0, gap - 3.1) * 0.9));
    rc.update(dt, front, HOLDS_FROM);
    if (caught) return;
    if (!safe && hx < SAFE_AT) { safe = true; player.autopilotSpeed = 1.2; ui.hidePrompt(); return; }
    if (safe) return;
    // Hold any direction and she runs the way the route goes, drawn back to its middle.
    const run = Math.hypot(input.move.x, input.move.y) > 0.3 || input.running;
    if (run) {
      if (prompted) { ui.hidePrompt(); prompted = false; }
      const side = player.position.clone().sub(startAt).dot(az);
      player.autopilot = ax.clone().negate().addScaledVector(az, -side * 0.8);
    } else player.autopilot = null;
    // A distant rumble under it all, and the route trembling nearer the front.
    if (Math.random() < dt * 3) cam.shake(0.03 + 0.05 * Math.max(0, 1 - gap / 8));
    player.floorY = () => top - rc.sagAt(x());
    if (!rc.solidAt(hx)) caught = true;
  });

  while (!safe) {
    await clock.until(() => caught || safe);
    if (safe) break;
    // It takes the deck from under her: the moment fractures and rewinds.
    player.autopilot = null;
    const fallFrom = player.position.y;
    let y = fallFrom;
    player.floorY = () => y;
    audio.surge();
    cam.shake(0.35);
    await clock.tween(0.7, (k) => {
      y = fallFrom - 0.5 * 9.8 * (0.7 * k) ** 2;
      post.uDrain.value = 0.9 * smooth(k);
      g.afterimage = 0.9 * k;
    });
    await ui.fade(1, 0.25, '#e8e2d8');
    rc.reset();
    player.place(startAt, startYaw);
    player.floorY = () => top;
    player.velocity.set(0, 0, 0);
    frame(0);
    await clock.sleep(0.3);
    void ui.fade(0, 0.9, '#e8e2d8');
    await clock.tween(1.4, (k) => { post.uDrain.value = 0.9 * (1 - smooth(k)); g.afterimage = 0.9 * (1 - k); });
    post.uDrain.value = 0; g.afterimage = 0;
    restart();
    ui.showPrompt('run', 'hold ← / A', 'hold to run', false);
    prompted = true;
  }

  // The far end holds. She slows, and turns to see the way she came fall away.
  player.autopilot = ax.clone().negate();
  await clock.sleep(1.4);
  player.autopilot = null;
  player.controllable = false;
  // She turns to see the way she came, gone: over her shoulder, along what is left of the route.
  const behind = player.position.clone().addScaledVector(ax, 9).setY(top - 1.5);
  const y0 = player.yaw, turn = Math.atan2(Math.sin(Math.atan2(ax.x, ax.z) - y0), Math.cos(Math.atan2(ax.x, ax.z) - y0));
  void clock.tween(1.3, (k) => (player.yaw = y0 + turn * smooth(k)));
  player.lookTarget = behind;
  const look = { position: player.position.clone().addScaledVector(ax, -3.5).addScaledVector(az, 0.6).setY(top + 2.0), target: player.position.clone().addScaledVector(ax, 10).setY(top - 2), lens: 30, range: 12, bokeh: 0.6, handheld: 0.5 };
  cam.cutTo(look, 0);
  audio.stopMusic(5);
  // The dust settles into dusk.
  g.weather.set('dusk', 9);
  await clock.sleep(4.5);
  chase();
  rc.onBreak = undefined; rc.onLand = undefined;
  player.lookTarget = null;
  return routeEnd(g, blockers);
}

async function routeEnd(g: Game, blockers: Game['player']['blockers']) {
  const { ui, player } = g;
  await ui.fade(1, 3);
  compass.target = null;
  // She stays up on the route (floorY) until the next chapter places her.
  player.blockers = blockers;
  player.autopilotSpeed = 1.35 * 0.75;
}
