import * as THREE from 'three/webgpu';
import type { Game } from '../main';
import { ARCHES, EXIT, MIRROR, POOL, SALT_FLAT, THICKET, WATER_LEVEL, heightAt } from '../world/terrain';
import { giantTrunkAt, ruinsArchAt } from '../world/landmarks';
import { ConduitGlow } from '../world/conduitGlow';
import { DustGlow } from '../world/dustGlow';
import { WarmGlow } from '../world/warmGlow';
import { LightBar } from '../world/lightBar';
import { uPortGlow } from '../player/placeholder';
import { LightHand } from '../world/lightHand';
import { progress } from './progress';
import { gentleTouch, kneelAt, kneelSpot, standUp } from './partI';
import { reflectionShot } from './shots';
import { gateGoal, openWayToGate } from './partII';
import { MemoryTrail } from '../world/memoryTrail';
import { handShot, topDown } from './shots';
import { SiteGhost } from './siteGhost';
import { ATMOSPHERE_BASE } from '../world/atmosphere';

/**
 * The grove chapter, after the film's prologue: afterimages.
 *
 * Places where something happened to her before the memory loss wait in the grove. She
 * senses them (the shoulder port pulses faster when one is near; with her eyes closed she
 * hears it from where it is and sees its warmth through her lids), then wakes each one with
 * a gentle act. What comes back is wordless: light, sound, gesture. Each one returns a note
 * of the three-note motif, a little warmth to the light, and a frame for the album.
 *
 * Canon: no new narration. Part II is hinted through sensation only (a small hand of light,
 * warmth); never the child herself, and no ochre cloth (the strip on the bolt is Part II's).
 */

export interface Site {
  id: string;
  /** Where it waits (the echo comes from here). */
  at: THREE.Vector3;
  /** How close she must be to act. */
  reach: number;
  label: [string, string, string];
  /** press: E acts at the site. still: stand still there with her eyes closed. */
  trigger: 'press' | 'still';
  /** Only wakes (and is only sensed) once these are found. */
  after?: string[];
  wake(g: Game): Promise<void>;
}

/** Afterimages planned for the grove (see the design page); the pool is built. */
export const PLANNED = 6;

const GIANT_U = 0.36;   // where along the fallen giant she lays her hand (chest height)
const RUINS_U = 0.13;   // where along the ruined arch she touches the conduit (about 1 m up)

export const SITES: Site[] = [
  { id: 'pool', at: new THREE.Vector3(POOL.x, WATER_LEVEL + 0.1, POOL.z), reach: 3.4, label: ['kneel', 'E', 'kneel'], trigger: 'press', wake: poolAfterimage },
  { id: 'marsh', at: new THREE.Vector3(SALT_FLAT.x, WATER_LEVEL + 0.3, SALT_FLAT.z), reach: 5, label: ['close your eyes and stay', 'hold E', 'hold and stay still'], trigger: 'still', wake: marshAfterimage },
  { id: 'giant', at: giantTrunkAt(GIANT_U).center, reach: 2.6, label: ['lay your hand on it', 'E', 'lay your hand on it'], trigger: 'press', wake: giantAfterimage },
  { id: 'ruins', at: ruinsArchAt(RUINS_U), reach: 2.6, label: ['touch it', 'E', 'touch it'], trigger: 'press', wake: ruinsAfterimage },
  { id: 'mirror', at: new THREE.Vector3(MIRROR.x, WATER_LEVEL + 0.1, MIRROR.z), reach: 3.6, label: ['look', 'E', 'look'], trigger: 'press', after: ['pool', 'marsh', 'giant', 'ruins', 'thicket'], wake: mirrorAfterimage },
  { id: 'thicket', at: new THREE.Vector3(THICKET.x, heightAt(THICKET.x, THICKET.z) + 0.3, THICKET.z), reach: 3.2, label: ['lie down', 'E', 'lie down'], trigger: 'press', wake: thicketAfterimage },
];

/**
 * What each afterimage gives back, named when it's found (the design's own words; shown with
 * the found row, not spoken).
 */
export const NAMES: Record<string, string> = {
  giant: 'a weight held',
  thicket: 'someone small, breathing beside her',
  pool: 'a small hand teaching hers',
  marsh: 'two walking, right to left',
  ruins: 'what it costs',
  mirror: 'her own face',
};

const smooth = (k: number) => k * k * (3 - 2 * k);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/**
 * The grove is one path, not a field to search: from the way out, round the grove and back,
 * one afterimage after another in this order, each woken before the way goes on (the linear,
 * authored progression of the films). The order builds toward what Part II remembers: a weight
 * held, someone small breathing beside her, a small hand teaching hers, two walking right to
 * left, the cost, and at last her own face, with the mist lifting toward the gate.
 */
export const ORDER = ['giant', 'thicket', 'pool', 'marsh', 'ruins', 'mirror'] as const;
const siteOf = (id: string) => SITES.find((s) => s.id === id)!;
const CORRIDOR = 7;      // half-width of the walkable path (m)

/** Index of the next afterimage in ORDER (-1 once all are woken). */
function nextIndex() {
  return ORDER.findIndex((id) => !progress.found.includes(id));
}

/** Where she may walk: the path from the way out up to the next afterimage. */
function corridor(g: Game) {
  const pts = [EXIT, ...ORDER.map((id) => siteOf(id).at)];
  const upto = nextIndex() < 0 ? pts.length - 1 : nextIndex() + 1;
  const v2 = (p: THREE.Vector3) => new THREE.Vector2(p.x, p.z);
  const areas: { a: THREE.Vector2; b: THREE.Vector2; r: number }[] = [];
  for (let i = 0; i < upto; i++) areas.push({ a: v2(pts[i]), b: v2(pts[i + 1]), r: CORRIDOR });
  for (let i = 0; i <= upto; i++) areas.push({ a: v2(pts[i]), b: v2(pts[i]), r: CORRIDOR + 1.5 });
  g.player.areas = areas;
  if (progress.found.includes('mirror')) openWayToGate(g);
}

let trail: MemoryTrail | null = null;

export async function runGrove(g: Game) {
  const { clock, ui, player, audio, input, post, cam } = g;
  // Cold start (checkpoint or ?beat=grove): at the way out looking back in, or where she
  // woke the last afterimage, facing on.
  const woken = ORDER.filter((id) => progress.found.includes(id));
  if (woken.length) {
    const last = siteOf(woken[woken.length - 1]).at;
    if (Math.hypot(player.position.x - last.x, player.position.z - last.z) > 8) {
      const i = nextIndex();
      const on = i >= 0 ? siteOf(ORDER[i]).at : EXIT;
      const dir = V(on.x - last.x, 0, on.z - last.z).normalize();
      player.place(last.clone().addScaledVector(dir, 2.2).setY(0), Math.atan2(dir.x, dir.z));
      cam.yaw = Math.atan2(dir.x, dir.z) + Math.PI;
    }
  } else if (Math.hypot(player.position.x - EXIT.x, player.position.z - EXIT.z) > 6) {
    player.place(V(EXIT.x + 1, 0, EXIT.z + 2), 0.35);
    cam.yaw = 0.35 + Math.PI;
  }
  Object.assign(player.pose, { kneel: 0, lie: 0, lean: 0, headPitch: 0 });
  player.reachWeight = 0; player.autopilot = null; player.eyelids = 0;
  cam.release(0);
  cam.followBehind = false;
  player.controllable = true;
  audio.hum(0.3, 4);
  post.uWarm.value = warmth();
  corridor(g);
  // Once the mirror pool has been found, the mist toward the refuge stays lifted.
  if (progress.found.includes('mirror')) liftMist(g, 1);
  void ui.fade(0, 3);
  void audio.playMusic('grove', 6);
  g.guide.setGoal(null);

  // What the chapter asks, once, as it begins: the row of afterimages still to find.
  void (async () => {
    await clock.sleep(woken.length ? 2.5 : 8.5);
    const n = progress.found.length;
    ui.showFound(n, ORDER.length, n ? `${n} / ${ORDER.length}` : 'find what her body remembers', 7);
  })();
  // At the next site, the pose to take, shown as a glass afterimage of her (story/siteGhost.ts).
  const ghost = new SiteGhost(g);
  trail ??= new MemoryTrail(g.post.memoryScene);
  const tr = trail;
  let closed = 0;
  // Behind her lids, the small steps can be heard too.
  tr.onStep = (p) => { if (closed > 0.55) audio.memoryStep(p, 0.32); };
  let target: THREE.Vector3 | null = null;
  const aim = () => {
    const i = nextIndex();
    target = i >= 0 ? siteOf(ORDER[i]).at : gateGoal(g);
    tr.setPath(target ? [target] : []);
    g.guide.waypoint = target ?? null;
  };
  aim();
  // The voice returns with what she has remembered (if the score comes as stems).
  // The voice returns with what she has remembered (if the score comes as stems), and the day
  // wears on toward late afternoon.
  const voice = (seconds = 4) => {
    const k = Math.min(1, progress.found.length / ORDER.length);
    audio.setLayer('voice', 0.15 + 0.85 * k, seconds);
    g.weather.between('day', 'late', k, seconds * 4);
  };
  voice(0);

  let busy = false;
  let listened = false;
  let hinted = false;
  let echoTimer = 0;
  let humTimer = 0;
  let trigger: Site | null = null;
  let still = 0;
  let gustAsked = false;
  let inGrove = 0;
  let best = Infinity, stale = 0;
  let toGate = false;
  const v = new THREE.Vector3();
  // The path's edges aren't walls: the mist closes in as she strays toward them.
  let mistBase = g.atmos.uMist.value, fogBase = g.atmos.uFogDensity.value, edge = 0;
  const outside = () => {
    const p = new THREE.Vector2(player.position.x, player.position.z);
    let m = Infinity;
    for (const { a, b, r } of player.areas) {
      const ab = b.clone().sub(a);
      const t = ab.lengthSq() > 0 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1) : 0;
      m = Math.min(m, p.distanceTo(a.clone().addScaledVector(ab, t)) - r);
    }
    return m;
  };

  let stepsTold = false;
  const stopFrame = g.onFrame((dt, t) => {
    {
      const gi = nextIndex();
      const gs = gi >= 0 ? siteOf(ORDER[gi]) : null;
      const gd = gs ? Math.hypot(player.position.x - gs.at.x, player.position.z - gs.at.z) : Infinity;
      ghost.update(dt, gs?.id ?? null, gs?.at ?? null, gd, busy || trigger !== null);
    }
    if (busy) { tr.intensity = 0; tr.update(dt, player.position); return; }
    inGrove += dt;
    const e = THREE.MathUtils.smoothstep(outside(), -2.5, -0.2);
    edge += (e - edge) * (1 - Math.exp(-dt * 1.5));
    g.atmos.uMist.value = mistBase + 0.35 * edge;
    g.atmos.uFogDensity.value = fogBase + 0.02 * edge;
    const i = nextIndex();
    const site = i >= 0 ? siteOf(ORDER[i]) : null;
    const goal = target;
    const d = goal ? Math.hypot(player.position.x - goal.x, player.position.z - goal.z) : Infinity;
    const atSite = !!site && d < site.reach;
    if (!site && goal && d < 7) toGate = true;
    if (d < best - 0.75) { best = d; stale = 0; } else stale += dt;

    // Port resonance: pulses faster and brighter as the memory gets close.
    const r = site ? THREE.MathUtils.clamp(1 - d / 20, 0, 1) : 0;
    const rate = 1.2 + r * r * 6;
    uPortGlow.value = 1 + r * 0.9 * (0.5 + 0.5 * Math.sin(t * rate * Math.PI));
    if ((humTimer -= dt) <= 0) { audio.hum(0.3 + r * 0.45, 0.8); humTimer = 0.8; }

    // Eyes closed (hold, anywhere but at a press site, where the press acts): the grove dulls,
    // the echo sounds from where the memory is, and the way shows as small steps ahead.
    const pressSite = atSite && site!.trigger === 'press';
    const want = input.actionHeld && !pressSite ? 1 : 0;
    closed += (want - closed) * (1 - Math.exp(-dt * (want ? 1.6 : 3.5)));
    player.eyelids = Math.min(1, closed * 1.9);
    post.uEyesClosed.value = Math.max(0, (closed - 0.45) / 0.55);
    audio.setClosed(closed);
    // The score leans in as the memory nears and draws back behind her lids.
    audio.setIntensity(0.62 + 0.38 * r - 0.35 * closed, 0.8);
    if (closed > 0.6) listened = true;
    // The first time the steps show, say what they are (once, ever).
    if (closed > 0.7 && !stepsTold && progress.promptCount('follow the steps') === 0) {
      stepsTold = true;
      ui.showPrompt('follow the steps', '', 'follow the steps', false);
      void clock.sleep(4.5).then(() => { if (document.getElementById('prompt')!.textContent?.includes('follow the steps')) ui.hidePrompt(); });
    }
    const mode = g.guide.mode;
    const open = mode === 'always' ? 0.5 : mode === 'subtle' && stale > 14 ? 0.35 : 0;
    const shown = atSite ? 0 : Math.max(THREE.MathUtils.smoothstep(closed, 0.35, 0.8), open);
    tr.intensity += (shown - tr.intensity) * (1 - Math.exp(-dt * 2.5));
    tr.update(dt, player.position);
    if (goal) {
      // Where it is, on screen (clamped to the edge when it's behind her).
      v.copy(goal).project(cam.camera);
      let x = v.x, y = v.y;
      if (v.z > 1) { x = -x; y = -y; }
      const m = Math.max(Math.abs(x), Math.abs(y));
      if (v.z > 1 || m > 0.92) { x = (x / m) * 0.92; y = (y / m) * 0.92; }
      post.uEcho.value.set(x * 0.5 + 0.5, 0.5 - y * 0.5, site ? THREE.MathUtils.clamp(1.2 - d / 30, 0.25, 1) : 0);
      if (site && closed > 0.6 && (echoTimer -= dt) <= 0) {
        audio.echo(site.at, THREE.MathUtils.clamp(1.3 - d / 35, 0.25, 1.2));
        echoTimer = 2.2 + Math.random() * 0.6;
      }
    } else {
      post.uEcho.value.z = 0;
    }

    // One quiet hint, only if she hasn't found listening on her own.
    if (!listened && !hinted && inGrove > (progress.found.length ? 20 : 11) && site) {
      hinted = true;
      ui.showPrompt('close your eyes', 'hold E', 'hold to close your eyes', true);
    }
    if (hinted && listened) { ui.hidePrompt(); hinted = false; }

    still = input.busy ? 0 : still + dt;
    if (atSite && site.trigger === 'press' && closed < 0.1) {
      ui.showPrompt(...site.label, true);
      if (input.actionPressed) trigger = site;
    } else if (atSite && site.trigger === 'still') {
      // Stand still in the open with her eyes closed; the wind comes to her.
      if (closed < 0.3) ui.showPrompt(...site.label, true); else ui.hidePrompt();
      if (closed > 0.6 && !gustAsked) { audio.gustNow(); gustAsked = true; }
      if (closed > 0.85 && still > 2.2) trigger = site;
    } else if (!hinted) {
      ui.hidePrompt();
    }
    if (!atSite) gustAsked = false;
  });

  for (;;) {
    await clock.until(() => trigger !== null || toGate);
    if (toGate && !trigger) break;
    const site = trigger!;
    trigger = null;
    busy = true;
    g.atmos.uMist.value = mistBase; g.atmos.uFogDensity.value = fogBase;
    ui.hidePrompt();
    uPortGlow.value = 1;
    audio.stopMusic(3);
    await site.wake(g);
    progress.addFound(site.id);
    g.echoes.leave(player.body.root, 4, 4);
    // What came back, named, with the row of those found so far.
    ui.showFound(progress.found.length, ORDER.length, `${progress.found.length} / ${ORDER.length} · ${NAMES[site.id] ?? ''}`, 6);
    // The last of them: for a moment the whole world is warm.
    if (ORDER.every((id) => progress.found.includes(id))) void g.flood(0xe0a050, 2.6, 1.4);
    g.input.release();
    voice();
    mistBase = g.atmos.uMist.value; fogBase = g.atmos.uFogDensity.value; edge = 0;
    closed = 0;
    best = Infinity; stale = 0;
    corridor(g);
    aim();
    busy = false;
    player.controllable = true;
    // After the mirror the whole theme is playing (motif); let it carry her to the gate.
    if (site.id !== 'mirror') void audio.playMusic('grove', 6);
  }
  stopFrame();
  ghost.clear();
  g.atmos.uMist.value = mistBase; g.atmos.uFogDensity.value = fogBase;
  audio.stopMusic(4);
  tr.intensity = 0;
  ui.hidePrompt();
  uPortGlow.value = 1;
  post.uEcho.value.z = 0;
  post.uEyesClosed.value = 0;
  player.eyelids = 0;
  audio.setClosed(0);
}

/** Warmth in the light from what she has found (0..~0.8 when all are found). */
export function warmth() {
  // What she has spent as power no longer warms anything.
  return ((progress.found.length - progress.spent.length) / PLANNED) * 0.8;
}

let lightHand: LightHand | null = null;

/**
 * The first afterimage, at the first pool: she lays her open hand on the water, gently, and
 * stays. A small hand of light appears beside hers; rings form under its fingertips; it
 * comes to rest over her hand and presses it, gently, once. Who taught it that.
 */
async function poolAfterimage(g: Game) {
  const { clock, ui, player, audio, input, post, cam, water } = g;
  player.controllable = false;
  const { spot, yaw } = kneelSpot(player.position, POOL, 0.1);
  await kneelAt(g, spot, yaw, 0.95, 0.4, 1.6);
  const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
  const right = V(-fwd.z, 0, fwd.x);
  // A flat palm needs the wrist at the water: closer to her knees than a fingertip touch.
  const contact = spot.clone().addScaledVector(fwd, 0.36).addScaledVector(right, 0.15).setY(WATER_LEVEL);

  // Close over the water, as in the film's hand shot.
  const shot = handShot(contact, fwd, right);
  cam.cutTo(shot, 1.4);
  await clock.tween(0.8, (k) => (player.handOpen = smooth(k)));
  const touch = await gentleTouch(g, contact, fwd, 0.2, {
    prompt: ['lay your hand on the water', 'S', 'drag down to lay your hand on the water'],
  });

  // Stay. The memory only comes if she doesn't move.
  let still = 0;
  const stop = g.onFrame((dt) => { still = input.busy || Math.abs(input.reach) > 0.0005 ? 0 : still + dt; });
  await clock.until(() => still > 1.8);
  stop();

  // ── the afterimage ──
  audio.duck(0.3, 2.5);
  audio.memoryPad(true, 3);
  audio.hum(0.15, 3);
  const vig0 = post.uVignette.value;
  void clock.tween(2.5, (k) => (post.uVignette.value = vig0 + 0.15 * smooth(k)));
  // Pull back and look down on both hands: there has to be room for another.
  const hands = {
    position: contact.clone().addScaledVector(right, 0.55).addScaledVector(fwd, 0.4).add(V(0, 0.8, 0)),
    target: contact.clone().addScaledVector(right, -0.1).addScaledVector(fwd, 0.02),
    focus: contact.clone().addScaledVector(right, -0.08),
    lens: 50, range: 0.35, bokeh: 9, handheld: 0.8,
  };
  cam.cutTo(hands, 2.2);
  lightHand ??= new LightHand(g.scene);
  const lh = lightHand;
  // Beside hers, a little ahead, on her left: where someone kneeling next to her would reach.
  const her = () => player.fingertipWorld(V()).addScaledVector(fwd, -0.07).setY(WATER_LEVEL);
  const from = her().addScaledVector(right, -0.2).addScaledVector(fwd, 0.05);
  lh.place(from, yaw - 0.15);
  await clock.tween(2.2, (k) => (lh.opacity = smooth(k)));

  // Rings under its fingertips, one by one, the way hers made them.
  for (let i = 0; i < 4; i++) {
    const tip = lh.fingertips()[i];
    water.addRipple(tip.x, tip.z, 0.0024);
    audio.echo(tip, 0.55);
    await clock.sleep(0.85);
  }

  // It comes to rest over her hand.
  const start = lh.mesh.position.clone();
  await clock.tween(3.2, (k) => {
    const e = smooth(k);
    const to = her();
    // Settles onto the back of her hand.
    lh.place(start.clone().lerp(to, e), yaw - 0.15 * (1 - e), 0.02 * e);
  });
  hands.focus = her();
  // A gentle press: both hands dip once, one ring.
  audio.motifNote(progress.found.length);
  audio.portChime(0.5);
  void clock.tween(1.2, (k) => { touch.press(Math.sin(k * Math.PI)); player.handSpread = 0.45 * smooth(k); });
  await clock.sleep(0.5);
  const tip = player.fingertipWorld(V());
  water.addRipple(tip.x, tip.z, 0.0038);
  void clock.tween(1.6, (k) => (uPortGlow.value = 1 + Math.sin(k * Math.PI) * 1.4));
  await clock.sleep(0.4);
  void g.captureFrame().then((url) => url && progress.saveFrame('pool', url));
  await clock.sleep(2.4);

  // It fades; the ring keeps going.
  await clock.tween(3.2, (k) => (lh.opacity = 1 - smooth(k)));
  audio.memoryPad(false, 4);
  audio.duck(1, 3);
  const w0 = post.uWarm.value, w1 = ((progress.found.length + 1) / PLANNED) * 0.8;
  void clock.tween(4, (k) => (post.uWarm.value = w0 + (w1 - w0) * smooth(k)));
  void clock.tween(3, (k) => (post.uVignette.value = vig0 + 0.15 * (1 - smooth(k))));
  await clock.sleep(1.5);

  touch.release();
  void clock.tween(1.2, (k) => { player.handOpen = 1 - smooth(k); player.handSpread = 0.45 * (1 - smooth(k)); });
  cam.release(2.4);
  await standUp(g, 1.8);
  audio.hum(0.3, 4);
  void ui;
}

/** The mist over the grove thins (0 = as it was, 1 = lifted toward the refuge). */
const MIST0 = ATMOSPHERE_BASE;
export function liftMist(g: Game, k: number) {
  if (g.gate && k > 0) g.gate.root.visible = true;
  g.atmos.uMist.value = MIST0.mist + (0.18 - MIST0.mist) * k;
  g.atmos.uFogDensity.value = MIST0.fog + (0.014 - MIST0.fog) * k;
}

/** What stays after each afterimage: the next motif note and a little more warmth. */
function keep(g: Game, note = true) {
  if (note) g.audio.motifNote(progress.found.length);
  const w0 = g.post.uWarm.value, w1 = ((progress.found.length + 1) / PLANNED) * 0.8;
  void g.clock.tween(4, (k) => (g.post.uWarm.value = w0 + (w1 - w0) * smooth(k)));
}

function eyes(g: Game, k: number) {
  g.player.eyelids = k;
  g.post.uEyesClosed.value = k;
  g.audio.setClosed(k);
}

/**
 * The salt marsh: standing still in the open, eyes closed, as the wind comes. First only
 * sound: rain on a coat beside her, then two people wading across in front of her, one
 * heavier, one small and quick, right to left. When she opens her eyes, the still water
 * shows it again: rings arriving in two lines, the same way, with no one there.
 */
async function marshAfterimage(g: Game) {
  const { clock, player, audio, post, cam, water } = g;
  player.controllable = false;
  eyes(g, 1);
  post.uEcho.value.z = 0;
  const pos = player.position.clone();
  // Face out across the open water.
  const toC = V(SALT_FLAT.x - pos.x, 0, SALT_FLAT.z - pos.z);
  const yaw = toC.length() > 1.2 ? Math.atan2(toC.x, toC.z) : player.yaw;
  player.yaw = yaw;
  const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
  const right = V(-fwd.z, 0, fwd.x);
  audio.duck(0.25, 2);
  audio.memoryPad(true, 5);
  audio.hum(0.12, 3);
  audio.rain(pos.clone().addScaledVector(right, -0.55).add(V(0, 1.1, 0)), 11);
  await clock.sleep(1.8);

  // Two walkers, right to left across her view (the escape axis runs to screen-left).
  type Step = { t: number; p: THREE.Vector3; w: number };
  const steps: Step[] = [];
  // They cross the marsh's open heart (no crusts there) when she stands back from it,
  // otherwise just ahead of her.
  const heart = V(SALT_FLAT.x, WATER_LEVEL, SALT_FLAT.z);
  const across = toC.length() > 2.2 ? heart : pos.clone().addScaledVector(fwd, 2.6);
  const lane = (off: number, stride: number, period: number, w: number, lead: number) => {
    const span = 7;
    const n = Math.floor(span / stride);
    for (let i = 0; i <= n; i++) {
      const side = i % 2 ? 0.08 : -0.08;
      const p = across.clone().addScaledVector(fwd, off + side).addScaledVector(right, span / 2 - i * stride);
      p.y = WATER_LEVEL + 0.05;
      steps.push({ t: lead + i * period, p, w });
    }
  };
  lane(0.3, 0.7, 0.52, 1, 0);
  lane(-0.25, 0.45, 0.34, 0.55, 0.15);
  steps.sort((a, b) => a.t - b.t);
  const play = (fn: (s: Step) => void) => {
    let t = 0, i = 0;
    const stop = g.onFrame((dt) => {
      t += dt;
      while (i < steps.length && steps[i].t <= t) fn(steps[i++]);
      if (i >= steps.length) stop();
    });
  };
  play((s) => audio.memoryStep(s.p, s.w));
  await clock.sleep(7.4);

  // Open her eyes onto the marsh: the rings arrive the same way, in two lines.
  const wide = {
    // High behind her left shoulder: her back at the edge of frame, the open water ahead.
    position: pos.clone().addScaledVector(fwd, -1.3).addScaledVector(right, -1.4).add(V(0, 2.2, 0)),
    target: across.clone().addScaledVector(right, 0.4),
    lens: 26, range: 7, bokeh: 2, handheld: 0.8,
  };
  cam.cutTo(wide, 0);
  void clock.tween(1.8, (k) => eyes(g, 1 - smooth(k)));
  audio.setClosed(0);
  await clock.sleep(0.8);
  play((s) => water.addRipple(s.p.x, s.p.z, s.w > 0.8 ? 0.012 : 0.009));
  await clock.sleep(3.4);
  void g.captureFrame().then((url) => url && progress.saveFrame('marsh', url));
  keep(g);
  await clock.sleep(4.6);

  audio.memoryPad(false, 4);
  audio.duck(1, 3);
  audio.hum(0.3, 4);
  eyes(g, 0);
  cam.release(2.6);
  await clock.sleep(1.5);
}

let lightBar: LightBar | null = null;

/**
 * The fallen giant: she lays her palm on the bark and holds. Her arms remember holding
 * something up that was coming down: both rise overhead, a bar of light arrives across her
 * forearms, the weight lands, she braces and trembles, and holds, until it passes.
 */
async function giantAfterimage(g: Game) {
  const { clock, player, audio, post, cam, ui, input } = g;
  player.controllable = false;
  const trunk = giantTrunkAt(GIANT_U);
  // Stand beside the trunk on her side of it, facing it.
  const toHer = player.position.clone().sub(trunk.center).setY(0);
  toHer.addScaledVector(trunk.along, -toHer.dot(trunk.along));
  const n = toHer.lengthSq() > 1e-4 ? toHer.normalize() : V(-trunk.along.z, 0, trunk.along.x);
  const spot = trunk.center.clone().addScaledVector(n, trunk.radius + 0.45);
  spot.y = heightAt(spot.x, spot.z);
  const yaw = Math.atan2(-n.x, -n.z);
  const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
  const right = V(-fwd.z, 0, fwd.x);
  const from = player.position.clone(), yaw0 = player.yaw;
  const dy = Math.atan2(Math.sin(yaw - yaw0), Math.cos(yaw - yaw0));
  await clock.tween(1.2, (k) => {
    const e = smooth(k);
    player.position.lerpVectors(from, spot, e);
    player.yaw = yaw0 + dy * e;
  });

  // Her palm on the bark, at chest height where the trunk is.
  const cy = trunk.center.y;
  const y = THREE.MathUtils.clamp(spot.y + 1.2, cy - 0.3, cy + 0.3);
  const reach = Math.sqrt(Math.max(0.01, trunk.radius ** 2 - (y - cy) ** 2));
  const palm = trunk.center.clone().addScaledVector(n, reach + 0.02).setY(y);
  const wristAt = (p: THREE.Vector3) => p.clone().addScaledVector(fwd, -0.03).add(V(0, -0.07, 0)).addScaledVector(right, 0.02);
  player.reachTarget.copy(wristAt(palm));
  const side = {
    position: spot.clone().addScaledVector(trunk.along, 1.7).addScaledVector(n, 0.6).add(V(0, 1.35, 0)),
    target: spot.clone().lerp(palm, 0.6).add(V(0, 1.1 - (palm.y - spot.y) * 0.4, 0)),
    lens: 40, range: 1.2, bokeh: 6, handheld: 1,
  };
  cam.cutTo(side, 1.4);
  await clock.tween(1.3, (k) => {
    const e = smooth(k);
    player.reachWeight = e; player.handOpen = e; player.palmUp = e;
  });

  // Hold.
  ui.showPrompt('hold', 'hold E', 'hold', true);
  let held = 0;
  const holding = g.onFrame((dt) => {
    held = input.actionHeld ? held + dt : 0;
    uPortGlow.value = 1 + Math.min(1, held / 2.4) * 0.6;
  });
  await clock.until(() => held > 2.4);
  holding();
  input.release();
  ui.hidePrompt();

  // ── the afterimage ──
  audio.duck(0.3, 1.5);
  audio.memoryPad(true, 3);
  audio.groan(0.5, 1.8);
  const vig0 = post.uVignette.value;
  void clock.tween(2, (k) => (post.uVignette.value = vig0 + 0.18 * smooth(k)));
  // Braced, low, close: the camera takes the weight too.
  const braced = {
    // Behind and a little below her: the bar lies across the frame over her forearms.
    position: spot.clone().addScaledVector(n, 2.2).addScaledVector(trunk.along, 0.25).add(V(0, 1.05, 0)),
    target: spot.clone().add(V(0, 1.72, 0)),
    lens: 32, range: 2, bokeh: 4, handheld: 1.8,
  };
  cam.cutTo(braced, 0.9);

  // Both arms rise overhead to hold something up.
  const high = (s: number, drop = 0) => spot.clone().addScaledVector(fwd, 0.22).addScaledVector(right, 0.24 * s).add(V(0, 1.84 - drop, 0));
  const r0 = player.reachTarget.clone();
  await clock.tween(1.1, (k) => {
    const e = smooth(k);
    player.reachTarget.lerpVectors(r0, high(1), e);
    player.leftReachTarget.copy(high(-1));
    player.leftReachWeight = e;
    player.pose.headPitch = -0.2 * e;
  });
  lightBar ??= new LightBar(g.scene, 1.5);
  const bar = lightBar;
  const barAt = (drop: number) => bar.span(high(-1, drop).addScaledVector(right, -0.45).add(V(0, 0.07, 0)), high(1, drop).addScaledVector(right, 0.45).add(V(0, 0.07, 0)));
  barAt(-0.25);
  await clock.tween(0.9, (k) => { bar.opacity = smooth(k); barAt(-0.25 * (1 - smooth(k))); });

  // The weight arrives.
  audio.thud(1);
  audio.groan(1, 0.3);
  audio.portChime(0.6);
  cam.shake(0.03);
  let drop = 0, strain = 0;
  const tremble = g.onFrame((dt, t) => {
    const j = strain * (Math.sin(t * 9.3) * 0.006 + Math.sin(t * 14.1) * 0.004);
    player.reachTarget.copy(high(1, drop)).add(V(0, j, 0));
    player.leftReachTarget.copy(high(-1, drop)).add(V(0, -j, 0));
    barAt(drop - j * 0.5);
    uPortGlow.value = 1 + strain * (0.6 + 0.4 * Math.sin(t * 17));
  });
  await clock.tween(0.35, (k) => {
    drop = 0.14 * smooth(k); strain = smooth(k);
    player.pose.kneel = 0.22 * smooth(k);
    player.pose.headPitch = -0.2 + 0.35 * smooth(k);
  });
  await clock.sleep(1.1);
  void g.captureFrame().then((url) => url && progress.saveFrame('giant', url));
  keep(g);
  await clock.sleep(2.3);

  // It passes: the weight lifts, the light comes apart, her arms come down.
  audio.groan(0, 2.5);
  void clock.tween(2.2, (k) => (bar.opacity = 1 - smooth(k)));
  await clock.tween(1.4, (k) => { drop = 0.14 * (1 - smooth(k)); strain = 1 - smooth(k); player.pose.kneel = 0.22 * (1 - smooth(k)); });
  tremble();
  uPortGlow.value = 1;
  audio.memoryPad(false, 4);
  audio.duck(1, 3);
  void clock.tween(2.5, (k) => (post.uVignette.value = vig0 + 0.18 * (1 - smooth(k))));
  const rh = player.reachTarget.clone();
  await clock.tween(1.8, (k) => {
    const e = smooth(k);
    player.leftReachWeight = 1 - e;
    player.reachTarget.lerpVectors(rh, wristAt(palm), e);
    player.pose.headPitch = 0.15 * (1 - e);
  });
  cam.release(2.6);
  await clock.tween(1.2, (k) => {
    const e = 1 - smooth(k);
    player.reachWeight = e; player.handOpen = e; player.palmUp = e;
  });
  player.pose.headPitch = 0;
}

/** Walk her to `spot` and turn her to `yaw` (a short, eased settle). */
async function settle(g: Game, spot: THREE.Vector3, yaw: number, seconds = 1.2) {
  const p = g.player;
  const from = p.position.clone(), yaw0 = p.yaw;
  const dy = Math.atan2(Math.sin(yaw - yaw0), Math.cos(yaw - yaw0));
  await g.clock.tween(seconds, (k) => {
    const e = smooth(k);
    p.position.lerpVectors(from, spot, e);
    p.yaw = yaw0 + dy * e;
  });
}

let conduitGlow: ConduitGlow | null = null;

/**
 * The conduit ruins: she touches the buried conduit. Light wakes inside it at her hand,
 * runs up and over the arch and back down to her, and her shoulder port answers. Then the
 * surge: a flash, she's thrown off it, and everything stops: no light, no sound, her port
 * dark. Then the hum comes back, stuttering, the way she came back. What her core can carry,
 * and what it costs.
 */
async function ruinsAfterimage(g: Game) {
  const { clock, player, audio, post, cam, input } = g;
  player.controllable = false;
  const touch = ruinsArchAt(RUINS_U);
  const tanH = ruinsArchAt(RUINS_U + 0.02).sub(ruinsArchAt(RUINS_U - 0.02)).setY(0).normalize();
  const toHer = player.position.clone().sub(touch).setY(0);
  toHer.addScaledVector(tanH, -toHer.dot(tanH));
  const n = toHer.lengthSq() > 1e-4 ? toHer.normalize() : V(-tanH.z, 0, tanH.x);
  const spot = touch.clone().addScaledVector(n, 0.62);
  spot.y = heightAt(spot.x, spot.z);
  const yaw = Math.atan2(-n.x, -n.z);
  await settle(g, spot, yaw);
  const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
  const left = V(Math.cos(yaw), 0, -Math.sin(yaw));
  const palm = touch.clone().addScaledVector(n, 0.14);
  player.reachTarget.copy(palm).addScaledVector(fwd, -0.03).add(V(0, -0.07, 0)).addScaledVector(left, 0.03);
  // From her left side: her shoulder port toward us, her hand on the conduit, the arch
  // rising beyond (higher and further back if the arch rises toward the camera).
  const toward = Math.max(0, left.dot(tanH));
  const shot = {
    position: spot.clone().addScaledVector(left, 1.7 + toward).addScaledVector(fwd, -0.9).add(V(0, 1.45 + toward * 0.8, 0)),
    target: spot.clone().lerp(touch, 0.55).add(V(0, 0.55, 0)),
    focus: spot.clone().add(V(0, 1.35, 0)),
    lens: 32, range: 1.4, bokeh: 5, handheld: 1,
  };
  cam.cutTo(shot, 1.4);
  await clock.tween(1.2, (k) => { const e = smooth(k); player.reachWeight = e; player.handOpen = e; player.palmUp = e; });
  let still = 0;
  const stop = g.onFrame((dt) => { still = input.busy ? 0 : still + dt; });
  await clock.until(() => still > 0.8);
  stop();

  // ── the afterimage ──
  if (!conduitGlow) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) pts.push(ruinsArchAt(i / 48));
    conduitGlow = new ConduitGlow(g.scene, pts, 0.21);
  }
  const glow = conduitGlow;
  glow.uHead.value = RUINS_U; glow.uLevel.value = 0; glow.uFlash.value = 0; glow.on = true;
  audio.duck(0.4, 1.5);
  audio.hum(0.6, 1.5);
  audio.charge(touch, 4.2);
  await clock.tween(1.2, (k) => { glow.uLevel.value = 0.7 * smooth(k); uPortGlow.value = 1 + 0.8 * smooth(k); });
  // The light runs up and over the arch, down the far leg, and back to her hand.
  await clock.tween(2.4, (k) => { glow.uHead.value = RUINS_U + (1 - RUINS_U) * smooth(k); uPortGlow.value = 1.8 + 0.4 * Math.sin(k * 20); });
  await clock.tween(1.2, (k) => { glow.uHead.value = 1 - (1 - RUINS_U) * k * k; uPortGlow.value = 2.2 + 1.2 * k; });

  // The surge.
  audio.surge();
  cam.shake(0.035);
  player.flinch(1);
  glow.uFlash.value = 1;
  uPortGlow.value = 4.2;
  void g.captureFrame().then((url) => url && progress.saveFrame('ruins', url));
  void clock.tween(0.25, (k) => { player.reachWeight = 1 - smooth(k); });
  await clock.sleep(0.18);

  // Then nothing: no light, no sound. Her eyes flutter.
  audio.blackout(2.2, 2.8);
  glow.uFlash.value = 0; glow.uLevel.value = 0; glow.uHead.value = -1;
  uPortGlow.value = 0.05;
  const vig0 = post.uVignette.value;
  post.uVignette.value = vig0 + 0.3;
  await clock.tween(0.9, (k) => eyes(g, Math.max(0, Math.sin(k * Math.PI * 3)) * 0.7));
  eyes(g, 0);
  audio.setClosed(0);
  await clock.sleep(1.4);
  glow.on = false;

  // The hum comes back, stuttering, and the port with it.
  audio.hum(0.3, 3);
  audio.duck(1, 3);
  for (const [t, v] of [[0.35, 0.6], [0.2, 0.1], [0.4, 0.8], [0.2, 0.3]] as const) {
    uPortGlow.value = v;
    await clock.sleep(t);
  }
  void clock.tween(1.6, (k) => { uPortGlow.value = 0.3 + 0.7 * smooth(k); post.uVignette.value = vig0 + 0.3 * (1 - smooth(k)); });
  keep(g);
  await clock.sleep(1.2);
  cam.release(2.4);
  player.handOpen = 0; player.palmUp = 0;
  await clock.sleep(1.2);
  uPortGlow.value = 1;
}

let dustGlow: DustGlow | null = null;

/**
 * The thicket: she lies down, as she did when she woke, and is still. In the dark, small
 * breaths beside her. When her eyes open, a warm glow lies in the dust at her side, the
 * size of someone small curled up close; when she turns to it, it's gone.
 */
async function thicketAfterimage(g: Game) {
  const { clock, player, audio, post, cam, input, ui } = g;
  player.controllable = false;
  const pos = player.position.clone();
  const yaw = player.yaw;
  const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
  const right = V(-fwd.z, 0, fwd.x);
  audio.bodyMove(0.7);
  await clock.tween(1.1, (k) => { player.pose.kneel = smooth(k); });
  await clock.tween(1.8, (k) => { const e = smooth(k); player.pose.lie = e; player.pose.kneel = 1 - e; });
  // The film's overhead, lower and closer.
  cam.cutTo(topDown(player.position, 3.0), 2.2);
  await clock.sleep(1.2);

  // Still, the way she waited when she woke.
  let still = 0;
  const stop = g.onFrame((dt) => { still = input.busy ? 0 : still + dt; });
  ui.showPrompt('be still');
  await clock.until(() => still > 3);
  ui.hidePrompt();
  stop();

  // ── the afterimage ──
  audio.duck(0.2, 2.5);
  audio.memoryPad(true, 5);
  audio.hum(0.12, 3);
  await clock.tween(1.8, (k) => eyes(g, smooth(k)));
  // Curled on her side facing forward: whoever lay here lay in front of her chest.
  const beside = pos.clone().addScaledVector(fwd, 0.5).addScaledVector(right, 0.15);
  audio.breaths(beside.clone().add(V(0, 0.2, 0)), 9);
  await clock.sleep(8.6);

  dustGlow ??= new DustGlow(g.scene);
  const glow = dustGlow;
  glow.place(beside, yaw);
  const moteTick = g.onFrame((_dt, t) => glow.update(t));
  // Low, on the far side of the glow, looking back at her face over it: when her eyes open,
  // it's there between them.
  const eye = player.eyeWorld();
  const toward = beside.clone().sub(eye).setY(0).normalize();
  const look = {
    position: beside.clone().addScaledVector(toward, 0.95).add(V(0, 0.32, 0)),
    target: eye.clone().lerp(beside, 0.4).add(V(0, 0.02, 0)),
    focus: beside.clone(),
    lens: 40, range: 0.45, bokeh: 8, handheld: 0.9,
  };
  cam.cutTo(look, 0);
  void clock.tween(1.6, (k) => eyes(g, 1 - smooth(k)));
  await clock.tween(1.4, (k) => (glow.opacity = smooth(k)));
  await clock.sleep(1.6);
  void g.captureFrame().then((url) => url && progress.saveFrame('thicket', url));
  await clock.sleep(0.8);

  // She looks at it; as she does, it's gone. Focus finds her face instead.
  const f0 = look.focus.clone();
  player.pose.headPitch = 0;
  void clock.tween(2.2, (k) => { look.focus.lerpVectors(f0, eye, smooth(k)); });
  await clock.tween(2.0, (k) => (glow.opacity = 1 - smooth(Math.min(1, k * 1.2))));
  moteTick();
  keep(g);
  audio.memoryPad(false, 4);
  audio.duck(1, 3);
  audio.hum(0.3, 4);
  await clock.sleep(1.4);

  // Up again.
  cam.release(2.8);
  audio.bodyMove(0.8);
  await clock.tween(1.8, (k) => { const e = smooth(k); player.pose.lie = 1 - e; player.pose.kneel = e; });
  await clock.tween(1.4, (k) => (player.pose.kneel = 1 - smooth(k)));
  eyes(g, 0);
}

let warmGlow: WarmGlow | null = null;

/**
 * The mirror pool, last (after the other five): she kneels at the still pool and looks
 * again. Her reflection, and this time, behind her shoulder in the water, a faint warmth, as
 * if someone stood there. The whole motif plays. Then the view turns toward the refuge and
 * the mist lifts along the way: the place Part II begins.
 */
async function mirrorAfterimage(g: Game) {
  const { clock, player, audio, cam } = g;
  player.controllable = false;
  // As in the film's reflection: knees at the water line, leaning out over the pool.
  const { spot, yaw } = kneelSpot(player.position, MIRROR, 0.2);
  await kneelAt(g, spot, yaw, 1.0, 0.3, 1.8);
  await clock.sleep(0.05);
  const hemi = g.atmos.hemi;
  const ground0 = hemi.groundColor.clone(), hemi0 = hemi.intensity;
  const lit = new THREE.Color(0xf2ead8);
  void clock.tween(1.5, (k) => { hemi.groundColor.copy(ground0).lerp(lit, smooth(k)); hemi.intensity = hemi0 + 1.1 * smooth(k); });
  cam.cutTo(reflectionShot(player), 0);
  audio.duck(0.3, 2.5);
  audio.memoryPad(true, 4);
  audio.hum(0.2, 3);
  await clock.sleep(2.4);

  // Just past her left shoulder (the port side), over the water: in the reflection it sits
  // beside her face, where someone kneeling close behind her would be.
  const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
  const left = V(Math.cos(yaw), 0, -Math.sin(yaw));
  warmGlow ??= new WarmGlow(g.scene, 1.1);
  const glow = warmGlow;
  glow.sprite.position.copy(player.portWorld().pos).addScaledVector(left, 0.28).addScaledVector(fwd, -0.05).add(V(0, 0.28, 0));
  await clock.tween(3, (k) => (glow.opacity = smooth(k)));
  void g.captureFrame().then((url) => url && progress.saveFrame('mirror', url));
  // The whole motif, at last.
  void audio.motif(true);
  keep(g, false);
  await clock.sleep(4.5);
  await clock.tween(2.8, (k) => (glow.opacity = 1 - smooth(k)));
  audio.memoryPad(false, 5);

  // Toward the refuge: the mist lifts along the way.
  const toArches = V(ARCHES.x - spot.x, 0, ARCHES.z - spot.z).normalize();
  const wide = {
    position: spot.clone().addScaledVector(toArches, -2.2).add(V(0, 1.9, 0)),
    target: V(ARCHES.x, heightAt(ARCHES.x, ARCHES.z) + 7, ARCHES.z),
    lens: 30, range: 12, bokeh: 1.5, handheld: 0.6,
  };
  cam.cutTo(wide, 3.2);
  void clock.tween(2, (k) => { hemi.groundColor.copy(lit).lerp(ground0, smooth(k)); hemi.intensity = hemi0 + 1.1 * (1 - smooth(k)); });
  await clock.tween(7, (k) => liftMist(g, smooth(k)));
  audio.duck(1, 3);
  audio.hum(0.3, 4);
  await clock.sleep(2.5);
  cam.release(3.4);
  await standUp(g, 2);
}
