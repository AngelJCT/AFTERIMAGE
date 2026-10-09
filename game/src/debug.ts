import * as THREE from 'three/webgpu';
import type { Game } from './main';
export { installInspection } from './dev/inspection';
import { progress, BEATS } from './story/progress';
import { ORDER } from './story/afterimages';
import { compass } from './story/compass';

/**
 * Dev-only console helpers (not in production builds). The browser pane throttles rAF when
 * hidden, so tests freeze the loop and step frames by hand:
 *   __freeze()          stop the animation loop
 *   __step(n)           advance n frames of 1/60 s
 *   __snap(n)           freeze + step (the frozen canvas keeps the frame for screenshots)
 *   __resume()          restart the loop
 *   await __drive(s, until?)  run s seconds of game time by hand (hidden tabs pause rAF),
 *                       yielding so story beats advance; stops early if until() is true
 *   await __save(name, w)  render one frame and write it to game/.shots/<name>.jpg
 *   await __begin()     press Begin, skip the title and the fade-in (for scripted checks)
 *   __shot(pos, target, lens)  hold a still camera shot (arrays or vectors)
 *   __skip()            skip the current cutscene (also N, or the skip button top-right)
 *   await __autoplay(s) play on by itself for s seconds of game time (a smoke test): walk to
 *                       the guide's goal (or the compass target), hold the action whenever a
 *                       prompt shows, lower the hand when asked. Returns the beats it passed,
 *                       where it stopped, and any errors; screenshots each new beat.
 */
export function installDebug(game: Game) {
  const w = window as any;
  if (!new URLSearchParams(location.search).has('inspect')) installSkip(w);
  const g = game as any;
  w.__freeze = () => game.renderer.setAnimationLoop(null);
  // What three's animation loop does before each frame: without it, frame-updated passes
  // (the scene pass) think this frame was already rendered and the image freezes.
  const r = game.renderer as any;
  w.__step = (n = 1, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) {
      if (r.info.autoReset) r.info.reset();
      r._nodes.nodeFrame.update();
      if (w.__inspection) r._nodes.nodeFrame.time = game.clock.time;
      r.info.frame = r._nodes.nodeFrame.frameId;
      g.frame(dt);
    }
  };
  /** Freeze and render n frames; the canvas keeps the last one for screenshots. */
  w.__snap = (n = 1) => {
    w.__freeze();
    w.__step(n);
    return 'ok';
  };
  w.__resume = () => game.renderer.setAnimationLoop(() => g.frame());
  /** Draw the current pose without advancing the simulation (captures never consume a frame). */
  w.__render = () => {
    if (r.info.autoReset) r.info.reset();
    r._nodes.nodeFrame.update();
    if (w.__inspection) r._nodes.nodeFrame.time = game.clock.time;
    r.info.frame = r._nodes.nodeFrame.frameId;
    game.atmos.follow(game.player.position);
    game.atmos.sun.shadow.needsUpdate = game.atmos.sun.castShadow;
    g.filmLight();
    game.post.render();
    for (const fn of g.afterRender.splice(0)) fn();
  };
  w.__drive = async (seconds: number, until?: () => boolean) => {
    w.__freeze();
    const frames = Math.round(seconds * 60);
    for (let i = 0; i < frames; i++) {
      w.__step(1);
      if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
      if (until?.()) return i / 60;
    }
    return seconds;
  };
  w.__save = async (name = 'shot', width = 800) => {
    const p = game.captureFrame(width);
    w.__render();
    const url = await p;
    if (url) await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: url });
    return url ? 'saved' : 'failed';
  };
  w.__begin = async () => {
    const btn = document.getElementById('begin-btn') as HTMLButtonElement | null;
    for (let i = 0; i < 150 && !btn?.offsetParent; i++) await new Promise((r) => setTimeout(r, 200));
    btn?.click();
    if (document.visibilityState === 'hidden') await w.__drive(2.5);
    else await new Promise((r) => setTimeout(r, 2500));
    for (const id of ['start', 'fade']) {
      const el = document.getElementById(id);
      if (el) { el.style.transition = 'none'; el.style.opacity = '0'; if (id === 'start') el.style.display = 'none'; }
    }
    return 'ready';
  };
  // Errors seen while autoplaying.
  const errors: string[] = [];
  addEventListener('error', (e) => errors.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  w.__autoplay = async (seconds: number) => {
    const g = game as any;
    const input = g.input, player = game.player;
    const prompt = document.getElementById('prompt')!;
    let held = false, t = 0, pressT = 0, holdUntil = 0, runUntil = 0, balancing = false, lastTh = 0, squeezeUntil = 0;
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'actionHeld')!;
    Object.defineProperty(input, 'actionHeld', { configurable: true, get: () => held || desc.get!.call(input) });
    const beats: string[] = [];
    let beat = progress.checkpoint;
    // The guide always shows the way while it plays (restored after).
    const guideMode = g.guide.mode;
    g.guide.mode = 'always';
    const off = game.onFrame((dt) => {
      t += dt;
      const label = prompt.classList.contains('show') ? prompt.textContent ?? '' : '';
      // Keep holding after a "hold" prompt (it hides once held) until told to let go.
      if (/release|let go|open your eyes/.test(label)) holdUntil = 0;
      else if (/hold/.test(label)) holdUntil = t + 20;
      held = (!!label && !/release|let go|open your eyes/.test(label)) || t < holdUntil;
      // The beam (chapter V): forward, and lean against the sway (her roll is θ × 0.45).
      if (/balance|sway/.test(label)) balancing = true;
      if (balancing) {
        const th = player.root.rotation.z / 0.45, om = (th - lastTh) / Math.max(dt, 1e-3);
        lastTh = th;
        const u = th + 0.35 * om;
        input.keys.add('KeyW');
        if (u > 0.02) { input.keys.add('KeyD'); input.keys.delete('KeyA'); }
        else if (u < -0.02) { input.keys.add('KeyA'); input.keys.delete('KeyD'); }
        else { input.keys.delete('KeyA'); input.keys.delete('KeyD'); }
        if (player.controllable) { balancing = false; for (const k of ['KeyW', 'KeyA', 'KeyD']) input.keys.delete(k); }
        return;
      }
      // The squeeze (chapter V): hold a direction until it's through.
      // (The prompt hides once she moves; its text stays, so read that.)
      if (/hold a direction/.test(label) || (!player.controllable && /squeeze through/.test(prompt.textContent ?? ''))) squeezeUntil = 1;
      if (squeezeUntil && !player.controllable) input.keys.add('KeyW');
      else if (squeezeUntil) { input.keys.delete('KeyW'); squeezeUntil = 0; }
      // The chase: hold ← (and keep holding a while after the prompt goes).
      if (/←/.test(label)) runUntil = t + 15;
      if (t < runUntil) input.keys.add('ArrowLeft'); else input.keys.delete('ArrowLeft');
      // Lowering the hand: hold S (the keys' slow, steady rate is gentle enough).
      if (/lower your hand|lay your hand/.test(label)) input.keys.add('KeyS'); else input.keys.delete('KeyS');
      if (/close your eyes|stay|still/.test(label)) { input.move.x = input.move.y = 0; return; }
      let goal: THREE.Vector3 | null = g.guide.goal ?? compass.target ?? g.guide.waypoint ?? null;
      // Chapter VI: keep to the causeway (only in the water): a little ahead of the nearest point.
      const M = g.mirrorWorld;
      if (M?.group.visible && M.path) {
        let best = 0, bd = Infinity;
        for (let i = 0; i <= 200; i++) {
          const q = M.path.getPointAt(i / 200);
          const dd = (q.x - player.position.x) ** 2 + (q.z - player.position.z) ** 2;
          if (dd < bd) { bd = dd; best = i / 200; }
        }
        goal = best > 0.96 && compass.target ? compass.target : M.path.getPointAt(Math.min(1, best + 0.03));
      }
      if (!goal || !player.controllable) return;
      const d = new THREE.Vector3(goal.x - player.position.x, 0, goal.z - player.position.z);
      if (d.length() < 0.35) { input.move.x = input.move.y = 0; return; }
      d.normalize();
      const yaw = game.cam.yaw;
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      input.move.y = d.dot(fwd); input.move.x = d.dot(right);
    });
    try {
      for (let k = 0; k < seconds * 4; k++) {
        await w.__drive(0.25);
        // A press prompt: tap E between frames (so the story sees it on its next one).
        const label = prompt.classList.contains('show') ? prompt.textContent ?? '' : '';
        if (label && !/hold|release/.test(label) && (pressT -= 0.25) <= 0) {
          pressT = 0.75;
          dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' }));
          dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', key: 'e' }));
        }
        if (progress.checkpoint !== beat) {
          beat = progress.checkpoint;
          beats.push(String(beat));
          await w.__save(`auto_${String(BEATS.indexOf(beat as never)).padStart(2, '0')}_${beat}`, 640);
        }
        if (errors.length) break;
      }
    } finally {
      off();
      input.keys.delete('KeyS');
      input.keys.delete('ArrowLeft');
      for (const k of ['KeyW', 'KeyA', 'KeyD']) input.keys.delete(k);
      g.guide.mode = guideMode;
      delete input.actionHeld;
      input.move.x = input.move.y = 0;
    }
    return { beats, at: progress.checkpoint, t: +t.toFixed(1), controllable: player.controllable,
      prompt: prompt.classList.contains('show') ? prompt.textContent : '', errors: errors.splice(0) };
  };
  w.__shot = (pos: number[] | THREE.Vector3, target: number[] | THREE.Vector3, lens = 35) => {
    const v = (a: number[] | THREE.Vector3) => (Array.isArray(a) ? new THREE.Vector3(a[0], a[1], a[2]) : a.clone());
    game.cam.cutTo({ position: v(pos), target: v(target), lens, range: 4, bokeh: 1, handheld: 0 }, 0);
  };
}

/**
 * Dev skip: jump past the current cutscene. In the grove, the next afterimage counts as found
 * and the path resumes after it; anywhere else, the story moves on to the next beat.
 */
function installSkip(w: any) {
  const skip = () => {
    const cur = progress.checkpoint ?? 'coldOpen';
    if (cur === 'grove') {
      const next = ORDER.find((id) => !progress.found.includes(id));
      if (next) { progress.addFound(next); location.search = '?beat=grove'; return; }
    }
    const i = BEATS.indexOf(cur);
    location.search = i >= BEATS.length - 1 || new URLSearchParams(location.search).get('beat') === 'credits' ? '?beat=credits' : `?beat=${BEATS[i + 1]}`;
  };
  w.__skip = skip;
  addEventListener('keydown', (e) => { if (e.code === 'KeyN' && !e.repeat) skip(); });
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'skip ›';
  b.title = 'dev: skip this cutscene (N)';
  b.style.cssText = 'position:fixed;top:12px;right:64px;z-index:50;font:12px system-ui;letter-spacing:.08em;'
    + 'color:#e9e2d2;background:#1a1916b3;border:1px solid #e9e2d240;border-radius:4px;padding:6px 10px;cursor:pointer';
  b.addEventListener('click', skip);
  document.body.appendChild(b);
}
