import type { Game } from '../main';
import * as THREE from 'three/webgpu';
import { uPortDark, uPortGlow } from '../player/placeholder';
import { MemoryFrame } from './memoryFrame';

/**
 * AFTERIMAGE II, the past (S05–S25): the film's own footage, seen through fractures.
 *
 * The present holds still, close on her eye; the memory opens beside it in a window of
 * broken crystal and plays the film's shots (`public/video/part2_past.mp4`, film 14.6–85.4 s,
 * rebuilt frame for frame from the clean source clips in `clips/`, so no burned-in subtitles
 * and the full 16:9 frame). Narration, verbatim and in the film's order, comes
 * from the game's subtitles at the film's times: "she had taught them to be gentle" … "I only
 * needed her to keep going".
 *
 * What stays the player's: from the moment she catches the gate (S11) the memory only goes on
 * while E is held — holding the gate, then staying while it costs her; let go and it stalls,
 * trembling. At the end (S18) it waits on the child going through until she lets go. Then
 * the six one-second cuts, the blackout, and the aftermath, which breaks apart into the
 * present.
 */

const CLIP = 'video/part2_past.mp4';
// Clip time = film time − 14.6 (docs/part-ii-narration.md).
const LINES: [number, string, number][] = [
  [1.4, 'she had taught them to be gentle', 3.4],
  [9.4, 'then the world began to fall apart', 3.4],
  [17.7, 'only one way out and it was closing', 3.6],
  [29.7, 'I gave the gate my power', 3.4],
  [37.2, 'it began taking my memories', 3.6],
  [45.4, 'she wanted me to follow', 2.2],
  [48.2, 'I only needed her to keep going', 3.6],
];
const HOLD_FROM = 24.4;     // S11: she catches the gate
const STAY_FROM = 36.4;     // S14: the cost
const LET_GO_AT = 58.2;     // S18's end: the child going through
const SURGE_AT = 60.4;      // S21
const BLACKOUT_AT = 64.3;   // S24's end
const END = 70.6;           // S25's end

let frame: MemoryFrame | null = null;

/** Back to the present: the window closed, the plug on the floor. */
export function leavePast(g: Game) {
  if (frame) { frame.video.pause(); frame.openness = 0; frame.shatter = 0; frame.tension = 0; }
  g.gate?.restPlug();
}

export async function gateMemory(g: Game) {
  const { clock, ui, player, audio, cam, post, input } = g;
  frame ??= new MemoryFrame();
  const mf = frame;
  if (import.meta.env.DEV) (window as any).__memory = mf;
  const v = mf.video;
  mf.openness = 0; mf.shatter = 0; mf.tension = 0;
  // Whether the film should be running; if the browser holds it back (a background tab, an
  // autoplay rule), keep asking.
  let want = false;
  const play = () => { want = true; void v.play().catch(() => {}); };
  const pause = () => { want = false; v.pause(); };
  let retry = 0;
  const drawTick = g.onFrame((dt) => {
    mf.draw(dt);
    if (want && v.paused && !v.ended && (retry -= dt) <= 0) { retry = 0.5; void v.play().catch(() => {}); }
  });
  void audio.playMusic('past', 2);
  await mf.load(`${import.meta.env.BASE_URL}${CLIP}`);
  pause();
  v.currentTime = 0;

  // The present holds still, close on her left eye (the fissure side); the memory opens
  // beside it, to screen-right.
  player.controllable = false;
  player.lookTarget = null;
  const eye = player.eyeWorld(new THREE.Vector3());
  const f = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const l = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  cam.cutTo({
    position: eye.clone().addScaledVector(f, 0.34).add(new THREE.Vector3(0, 0.01, 0)),
    target: eye.clone().addScaledVector(l, 0.1).add(new THREE.Vector3(0, -0.01, 0)),
    focus: eye.clone(), lens: 50, range: 0.1, bokeh: 12, handheld: 0.5,
  }, 0);
  const vig0 = post.uVignette.value;
  void clock.tween(2, (k) => (post.uVignette.value = vig0 + 0.25 * k));
  audio.memoryPad(true, 2);

  void ui.fade(0, 1.2);
  // It cracks open, and the film plays inside it.
  play();
  await clock.tween(1.8, (k) => (mf.openness = k));
  let li = 0;
  const lines = g.onFrame(() => {
    while (li < LINES.length && v.currentTime >= LINES[li][0]) { void ui.say(LINES[li][1], LINES[li][2]); li++; }
  });

  // From the catch (S11), holding E is holding the gate, then staying. Let go and it stalls.
  await clock.until(() => v.currentTime >= HOLD_FROM - 0.3);
  const holding = g.onFrame((dt) => {
    const t = v.currentTime;
    if (t >= LET_GO_AT) return;
    const what = t < STAY_FROM ? 'hold it' : 'stay';
    if (input.actionHeld) {
      if (v.paused) play();
      mf.tension = Math.max(0, mf.tension - dt * 2);
      audio.setIntensity(1, 0.4);
      ui.hidePrompt();
    } else {
      if (want) pause();
      // The score falls back, as if heard through the stalled memory.
      audio.setIntensity(0.3, 1.2);
      mf.tension = Math.min(1, mf.tension + dt * 1.5);
      ui.showPrompt(what, 'hold E', `hold to ${what}`, true);
    }
  });
  await clock.until(() => v.currentTime >= LET_GO_AT);
  holding();
  audio.setIntensity(1, 0.5);
  pause();

  // S18: the child going through. It waits here until she lets go.
  if (input.actionHeld) {
    ui.showPrompt('let go', 'release E', 'let go', true);
    await clock.until(() => !input.actionHeld);
  }
  ui.hidePrompt();
  mf.tension = 0;
  play();

  // S19–S24, then the blackout: the window gone with everything else.
  await clock.until(() => v.currentTime >= SURGE_AT);
  audio.surge();
  await clock.until(() => v.currentTime >= BLACKOUT_AT);
  lines();
  audio.stopMusic(0.05);
  audio.blackout(2.2, 2.5);
  audio.memoryPad(false, 0.5);
  mf.openness = 0;
  uPortGlow.value = 0;
  uPortDark.value = 1;
  player.eyelids = 1;
  post.uEyesClosed.value = 1;       // the present behind goes dark too
  await clock.sleep(1.8);

  // S25: the aftermath, dim and quiet; then it breaks apart.
  pause();
  v.currentTime = BLACKOUT_AT + 0.15;
  play();
  mf.tension = 0.25;
  await clock.tween(1.2, (k) => (mf.openness = k));
  await clock.until(() => v.currentTime >= END - 1.3 || v.ended);
  audio.clang(0.25);
  await clock.tween(1.3, (k) => (mf.shatter = k));
  pause();
  await ui.fade(1, 0.8);
  drawTick();
  mf.openness = 0; mf.shatter = 0; mf.tension = 0;
  mf.draw(0);
  post.uEyesClosed.value = 0;
  post.uVignette.value = vig0;
  leavePast(g);
}

/**
 * Play a stretch of the past footage (clip seconds) in the fractured window over whatever
 * the present is showing, then let it shatter. Used when a memory is found again later.
 */
export async function memoryClip(g: Game, from: number, to: number, centre?: [number, number]) {
  const { clock } = g;
  frame ??= new MemoryFrame();
  const mf = frame;
  if (import.meta.env.DEV) (window as any).__memory = mf;
  const v = mf.video;
  if (centre) mf.centre = centre;
  mf.openness = 0; mf.shatter = 0; mf.tension = 0;
  await mf.load(`${import.meta.env.BASE_URL}${CLIP}`);
  v.pause();
  v.currentTime = from;
  let want = true, retry = 0;
  const tick = g.onFrame((dt) => {
    mf.draw(dt);
    if (want && v.paused && !v.ended && (retry -= dt) <= 0) { retry = 0.5; void v.play().catch(() => {}); }
  });
  void v.play().catch(() => {});
  await clock.tween(1.4, (k) => (mf.openness = k));
  await clock.until(() => v.currentTime >= to - 1.2 || v.ended);
  g.audio.clang(0.2);
  await clock.tween(1.2, (k) => (mf.shatter = k));
  want = false;
  v.pause();
  tick();
  mf.openness = 0; mf.shatter = 0;
  mf.draw(0);
  mf.centre = [0.665, 0.47];
}
