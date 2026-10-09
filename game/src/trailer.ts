import * as THREE from 'three/webgpu';
import type { Game } from './main';
import type { Beat } from './story/progress';
import type { WeatherName } from './world/weather';
import {
  WAKE_POINT, POOL, MIRROR, SALT_FLAT, RUINS, POOL_EDGE, STILL_POOL, EXIT, GATE, LIFT, OTHER_ARCH, heightAt,
} from './world/terrain';
import { SHARD_AT } from './world/landmarkShard';
import { WIND_DIR } from './world/weather';
import { ORDER } from './story/afterimages';
import { INVERTED, invertedAt } from './world/invertedWorld';
import { REFLECTION_ONLY } from './world/mirrorWorld';
import type { Shot } from './core/camera';

/**
 * Dev only (`?trailer`): authored camera moves through the world, cut to the main theme ("Ka-e
 * Eren"), for a trailer without screen-recording play. "preview" plays it live with the music;
 * "record" renders it frame by frame at 1920×1080 (no dropped frames, however slow the machine),
 * writes the frames through the dev server and has ffmpeg put them together with the music:
 * game/.trailer/<take>.mp4.
 *
 *   ?trailer&from=76.5                   preview from that point in the song
 *   ?trailer&edit=teaser                 preview the 35 s teaser
 *   window.__trailer.record({ edit, vertical, fps, width, take, crf })
 *       edit 'full' (2 min) or 'teaser'; vertical: 9:16 that follows her; crf 19 default
 *   window.__trailer.still('face', 0.5)  a 16:9 framing check of one clip, in .shots/
 *
 * A clip sets the weather, the sky's stage and where she is, then moves the camera over its
 * length (k: 0..1). The CUTS timeline places clips on the song's bars (see BAR), hard cuts on the
 * downbeats, black only where the music breathes.
 */
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const ease = (k: number) => k * k * (3 - 2 * k);
const lerp = THREE.MathUtils.lerp;
const ground = (p: THREE.Vector3) => p.clone().setY(heightAt(p.x, p.z));
const flat = (a: THREE.Vector3, b: THREE.Vector3) => b.clone().sub(a).setY(0).normalize();
const sideOf = (f: THREE.Vector3) => V(f.z, 0, -f.x); // her left when facing f
/** A point `d` metres from `from` toward `far` (aiming partway up at something vast). */
const toward = (from: THREE.Vector3, far: THREE.Vector3, d: number) => from.clone().addScaledVector(far.clone().sub(from).normalize(), d);

interface Clip {
  name: string;
  seconds: number;
  weather: WeatherName;
  beat: Beat;
  /** Place her and set the scene. */
  enter(g: Game): void;
  /** Each frame: the camera (and anything she does). k is 0..1 through the clip. */
  frame(g: Game, k: number, dt: number, shot: Shot): void;
  exit?(g: Game): void;
}

function head(g: Game, out = V()) {
  return g.player.rig.get('Head').getWorldPosition(out);
}

function stand(g: Game, at: THREE.Vector3, facing: THREE.Vector3, pose: Partial<Game['player']['pose']> = {}) {
  const p = g.player;
  p.place(ground(at), Math.atan2(facing.x, facing.z));
  Object.assign(p.pose, { kneel: 0, lie: 0, lean: 0, headPitch: 0, ...pose });
}

/** Flakes rising off the ground round her, drifting toward `to` (the vistas' cue). */
function drift(g: Game, to: THREE.Vector3, every: { t: number }, dt: number) {
  if ((every.t -= dt) > 0) return;
  every.t = 0.35;
  const p = g.player.position;
  const dir = to.clone().sub(p).normalize().multiplyScalar(0.7);
  g.flakes.burst(p.clone().add(V((Math.random() - 0.5) * 3, 0.1, (Math.random() - 0.5) * 3)), 0.4, 2, 0.04, 0.25, dir);
}

/** The other side: the water all glass, the causeway only in its reflection. */
function glass(g: Game, on: boolean) {
  g.mirrorWorld!.group.visible = on;
  g.water.uGlass.value = on ? 1 : 0;
  g.water.showInReflection(g.cam.camera, REFLECTION_ONLY, on);
}

/** The rupture in the sky behind the shard (world/landmarkShard.ts). */
const rift = () => SHARD_AT.clone().add(SHARD_AT.clone().setY(0).normalize().multiplyScalar(28)).add(V(0, 34, 0));

/** Frames from the trailer's own shots, hung in her memory panes (filled by `prepare`). */
const album: (string | undefined)[] = [];

const CLIPS: Clip[] = [
  {
    // Where she wakes (as the film opens): high overhead, sinking slowly toward her curled on
    // the cracked ground; at the end her eyes open.
    name: 'wake', seconds: 6.5, weather: 'day', beat: 'coldOpen',
    enter(g) {
      g.player.place(WAKE_POINT, Math.PI);
      Object.assign(g.player.pose, { kneel: 0, lie: 1, lean: 0, headPitch: 0 });
      g.player.eyelids = 1;
    },
    frame(g, k, _dt, shot) {
      const c = g.player.position, e = ease(k);
      shot.position.copy(c).add(V(lerp(0.9, 0.45, e), lerp(4.6, 2.4, e), lerp(1.3, 0.8, e)));
      shot.target.copy(c).add(V(0, 0.25, 0));
      shot.focus = shot.target.clone();
      shot.lens = 40; shot.range = 1.6; shot.bokeh = 3;
      g.player.eyelids = 1 - ease(THREE.MathUtils.clamp((k - 0.62) / 0.3, 0, 1));
    },
    exit(g) { g.player.eyelids = 0; },
  },
  {
    // Through the grove in the late light, the camera keeping pace beside her.
    name: 'grove', seconds: 6.5, weather: 'late', beat: 'grove',
    enter(g) {
      const f = flat(POOL, MIRROR);
      stand(g, POOL.clone().lerp(MIRROR, 0.12), f);
      g.player.autopilot = f.clone();
      g.player.autopilotSpeed = 1.15;
      g.player.velocity.copy(f).multiplyScalar(1.15);
    },
    frame(g, k, _dt, shot) {
      const f = flat(POOL, MIRROR), s = sideOf(f);
      const p = g.player.position;
      shot.position.copy(p).addScaledVector(s, -3.4).addScaledVector(f, lerp(1.6, 0.4, k)).setY(p.y + 1.25);
      shot.target.copy(p).addScaledVector(f, 0.9).setY(p.y + 1.15);
      shot.lens = 40; shot.range = 6; shot.bokeh = 0.6; shot.focus = p.clone().setY(p.y + 1.2);
    },
  },
  {
    // She looks up at the grove hanging upside down in the haze; the camera rises behind her.
    name: 'inverted', seconds: 7, weather: 'late', beat: 'trace',
    enter(g) {
      // Out on the open salt flat, facing what hangs in the sky.
      const f = flat(SALT_FLAT, invertedAt(INVERTED[0]));
      stand(g, SALT_FLAT, f, { headPitch: -0.38 });
    },
    frame(g, k, dt, shot) {
      const sky = invertedAt(INVERTED[0]);
      const f = flat(SALT_FLAT, sky), h = head(g);
      const e = ease(k);
      const out = f.clone().applyAxisAngle(V(0, 1, 0), lerp(0.35, 1.1, e)).multiplyScalar(-4.5);
      shot.position.copy(h).add(out).setY(h.y + lerp(-0.65, -0.2, e));
      shot.target.copy(toward(h, sky, lerp(2, 3.2, e)));
      shot.lens = 24; shot.range = 60; shot.bokeh = 0; shot.focus = undefined;
      drift(g, sky, this as unknown as { t: number }, dt);
    },
  },
  {
    // The shard over the ruins, and the rupture opening behind it: she is small at the foot.
    name: 'shard', seconds: 7, weather: 'late', beat: 'search',
    enter(g) {
      stand(g, RUINS, flat(RUINS, SHARD_AT), { headPitch: -0.3 });
    },
    frame(g, k, dt, shot) {
      const f = flat(RUINS, SHARD_AT), s = sideOf(f), p = g.player.position;
      const e = ease(k);
      shot.position.copy(p).addScaledVector(f, -5).addScaledVector(s, lerp(2.4, 0.9, e)).setY(p.y + lerp(0.5, 1.1, e));
      shot.target.copy(toward(p.clone().setY(p.y + 1.2), SHARD_AT, lerp(3, 5, e)));
      shot.lens = 20; shot.range = 60; shot.bokeh = 0; shot.focus = undefined;
      drift(g, SHARD_AT, this as unknown as { t: number }, dt);
    },
  },
  {
    // The still pool at dusk: her shed shell turning in broken rings over the water. The camera
    // swings round behind her.
    name: 'shedding', seconds: 8, weather: 'dusk', beat: 'mirror',
    enter(g) {
      stand(g, POOL_EDGE, flat(POOL_EDGE, STILL_POOL), { headPitch: -0.42 });
    },
    frame(g, k, _dt, shot) {
      const f = flat(POOL_EDGE, STILL_POOL), h = head(g);
      // From out over the water to her side (behind her are the squeeze's stones).
      const a = lerp(1.35, 1.75, ease(k));
      const out = f.clone().applyAxisAngle(V(0, 1, 0), a).multiplyScalar(-6);
      shot.position.copy(h).add(out).setY(h.y - 0.4);
      shot.target.copy(toward(h, STILL_POOL.clone().setY(24), lerp(1.8, 2.4, ease(k))));
      shot.lens = 20; shot.range = 60; shot.bokeh = 0; shot.focus = undefined;
    },
  },
  {
    // The beam over the channel in the dust storm, side on, from below.
    name: 'beam', seconds: 6, weather: 'storm', beat: 'crossing',
    enter(g) {
      const X = g.crossing!;
      const start = X.beamAt(0.3);
      stand(g, start, X.beamDir);
      const p = g.player;
      p.floorY = () => {
        const s = THREE.MathUtils.clamp(p.position.clone().sub(X.beamAt(0)).dot(X.beamDir) / X.beamLength, 0, 1);
        return X.beamAt(s).y;
      };
      p.position.y = start.y;
      p.autopilot = X.beamDir.clone();
      p.autopilotSpeed = 0.55;
      p.pose.lean = 0.08;
    },
    frame(g, k, _dt, shot) {
      const X = g.crossing!, f = X.beamDir.clone().setY(0).normalize(), s = sideOf(f);
      const p = g.player.position;
      shot.position.copy(p).addScaledVector(s, 5.2).addScaledVector(f, lerp(-1.2, 0.6, k)).setY(p.y - 1.1);
      shot.target.copy(p).setY(p.y + 0.9);
      shot.lens = 32; shot.range = 60; shot.bokeh = 0; shot.focus = undefined;
    },
  },
  {
    // Night on the other side: the water all glass, the causeway only in its reflection, and
    // her walking out along it toward the arch and the ring.
    name: 'causeway', seconds: 9, weather: 'other', beat: 'mirror',
    enter(g) {
      const M = g.mirrorWorld!;
      glass(g, true);
      const p0 = M.path.getPointAt(0.25), t0 = M.path.getTangentAt(0.25).setY(0).normalize();
      stand(g, p0, t0);
      const p = g.player;
      p.floorY = () => 0.02;
      p.position.y = 0.02;
      p.autopilot = t0.clone();
      p.autopilotSpeed = 0.95;
      p.velocity.copy(t0).multiplyScalar(0.95);
      (this as any).u = 0.25;
    },
    frame(g, k, _dt, shot) {
      const M = g.mirrorWorld!, p = g.player;
      // Keep her on the line: steer by the tangent at the nearest point ahead.
      let best = (this as any).u as number, d = Infinity;
      for (let u = best; u < Math.min(1, best + 0.05); u += 0.002) {
        const q = M.path.getPointAt(u), dd = Math.hypot(q.x - p.position.x, q.z - p.position.z);
        if (dd < d) { d = dd; best = u; }
      }
      (this as any).u = best;
      const ahead = M.path.getPointAt(Math.min(1, best + 0.03));
      p.autopilot!.copy(ahead).sub(p.position).setY(0).normalize();
      const f = M.path.getTangentAt(best).setY(0).normalize(), s = sideOf(f);
      const e = ease(k);
      shot.position.copy(p.position).addScaledVector(f, -lerp(3.6, 5, e)).addScaledVector(s, 0.9).setY(lerp(0.9, 1.9, e));
      shot.target.copy(p.position).addScaledVector(f, 12).setY(lerp(0.9, 2.6, e));
      shot.lens = 28; shot.range = 60; shot.bokeh = 0; shot.focus = undefined;
    },
    exit(g) { glass(g, false); },
  },
  {
    // Toward the refuge gate in the dusk, the arcade beyond it: low behind her.
    name: 'gate', seconds: 6.4, weather: 'dusk', beat: 'gate',
    enter(g) {
      const f = flat(EXIT, GATE);
      stand(g, EXIT.clone().lerp(GATE, 0.35), f);
      g.player.autopilot = f.clone();
      g.player.autopilotSpeed = 0.9;
      g.player.velocity.copy(f).multiplyScalar(0.9);
    },
    frame(g, k, _dt, shot) {
      const f = flat(EXIT, GATE), s = sideOf(f), p = g.player.position, e = ease(k);
      shot.position.copy(p).addScaledVector(f, -lerp(2.8, 3.6, e)).addScaledVector(s, lerp(0.9, -0.4, e)).setY(p.y + lerp(0.55, 0.9, e));
      shot.target.copy(p).addScaledVector(f, 10).setY(p.y + 2.2);
      shot.lens = 26; shot.range = 60; shot.bokeh = 0; shot.focus = undefined;
    },
  },
  {
    // Her memories as panes of glass round the dead lift; she looks up at them.
    name: 'lift', seconds: 6.4, weather: 'dusk', beat: 'search',
    enter(g) {
      g.panes.group.visible = true;
      g.panes.set(ORDER.map((id, i) => ({ id, found: true, spent: false, img: album[i] })));
      const f = flat(GATE, LIFT);
      stand(g, LIFT.clone().addScaledVector(f, -4.6), f, { headPitch: -0.5 });
    },
    frame(g, k, _dt, shot) {
      const f = flat(GATE, LIFT), s = sideOf(f), h = head(g), e = ease(k);
      shot.position.copy(h).addScaledVector(f, -lerp(1.8, 2.6, e)).addScaledVector(s, lerp(-1.1, -0.5, e)).setY(h.y + lerp(-0.7, -0.4, e));
      shot.target.copy(toward(h, LIFT.clone().setY(heightAt(LIFT.x, LIFT.z) + 6), lerp(3.5, 4.5, e)));
      shot.lens = 24; shot.range = 60; shot.bokeh = 0; shot.focus = undefined;
    },
  },
  {
    // Under the rupture: close at her shoulder, looking steeply up into the rift.
    name: 'rupture', seconds: 6.4, weather: 'late', beat: 'search',
    enter(g) {
      stand(g, RUINS, flat(RUINS, SHARD_AT), { headPitch: -0.55 });
    },
    frame(g, k, dt, shot) {
      const sky = rift(), f = flat(RUINS, sky), s = sideOf(f), h = head(g), e = ease(k);
      shot.position.copy(h).addScaledVector(f, -lerp(1.5, 1.1, e)).addScaledVector(s, -0.55).setY(h.y + lerp(-0.35, -0.15, e));
      shot.target.copy(toward(h, sky, lerp(6, 9, e)));
      shot.lens = lerp(18, 22, e); shot.range = 60; shot.bokeh = 0; shot.focus = undefined;
      drift(g, sky, this as unknown as { t: number }, dt);
    },
  },
  {
    // Close on her face at dusk, from a little below, the wind in her hair; on the music's
    // breath she lowers her head.
    name: 'face', seconds: 6.4, weather: 'dusk', beat: 'mirror',
    enter(g) {
      stand(g, POOL_EDGE, flat(POOL_EDGE, STILL_POOL), { headPitch: -0.25 });
    },
    frame(g, k, _dt, shot) {
      const p = g.player, eye = p.eyeWorld(V()), face = p.faceDir(V()).setY(0).normalize(), s = sideOf(face), e = ease(k);
      shot.position.copy(eye).addScaledVector(face, lerp(1.0, 0.8, e)).addScaledVector(s, lerp(0.42, 0.3, e)).add(V(0, -0.24, 0));
      shot.target.copy(eye).addScaledVector(s, 0.04).add(V(0, 0.03, 0));
      shot.focus = eye.clone();
      shot.lens = 85; shot.range = 0.35; shot.bokeh = 5;
      // A gust comes through.
      p.wind.copy(WIND_DIR).multiplyScalar(0.5 + 1.3 * Math.sin(Math.PI * Math.min(1, k * 1.4)));
      p.pose.headPitch = lerp(-0.25, 0.22, ease(THREE.MathUtils.clamp((k - 0.5) / 0.4, 0, 1)));
    },
  },
  {
    // The ring of light over the far shore, at dusk: she stands small before it.
    name: 'ring', seconds: 6.4, weather: 'dusk', beat: 'mirror',
    enter(g) {
      const at = OTHER_ARCH.clone().addScaledVector(flat(STILL_POOL, OTHER_ARCH), -3);
      stand(g, at, flat(at, g.ring.group.position), { headPitch: -0.25 });
    },
    frame(g, k, _dt, shot) {
      const ring = g.ring.group.position, f = flat(g.player.position, ring), s = sideOf(f), h = head(g), e = ease(k);
      shot.position.copy(h).addScaledVector(f, -lerp(5.5, 3.5, e)).addScaledVector(s, 0.8).setY(h.y + lerp(-0.7, -0.4, e));
      shot.target.copy(toward(h, ring, lerp(5, 7, e)));
      shot.lens = 30; shot.range = 60; shot.bokeh = 0; shot.focus = undefined;
    },
  },
  {
    // Last: night, the glass water, her small at the far arch, seen from across the pool.
    name: 'farshore', seconds: 15, weather: 'other', beat: 'mirror',
    enter(g) {
      glass(g, true);
      const at = OTHER_ARCH.clone().addScaledVector(flat(STILL_POOL, OTHER_ARCH), -1.5);
      stand(g, at, flat(at, g.ring.group.position), { headPitch: -0.2 });
    },
    frame(g, k, _dt, shot) {
      const h = head(g), back = flat(g.ring.group.position, h), e = ease(k);
      shot.position.copy(h).addScaledVector(back, lerp(8, 5.5, e)).addScaledVector(sideOf(back), 1.2).setY(lerp(0.8, 1.1, e));
      shot.target.copy(h).addScaledVector(back, -6).setY(lerp(2.0, 3.0, e));
      shot.lens = 30; shot.range = 60; shot.bokeh = 0; shot.focus = undefined;
    },
    exit(g) { glass(g, false); },
  },
];

/**
 * The main theme (76 bpm): a quiet intro, sparse hits from 12.78 s, the verse from 25.5, the
 * chorus from 51, a breath at 73.4, the climax from 76.5, a hard stop at 101, then the outro.
 * Its bars are 3.19 s apart from the first hit.
 */
const BAR = 3.1895, HIT = 12.78;
const D = (n: number) => HIT + n * BAR;
const END = 119.4;
/** The title over the outro: fades in, holds, the picture goes down behind it. */
const TITLE_AT = 110.5;

interface Cut {
  clip: string; from: number; to: number;
  /** The part of the clip shown (k range); a montage shows a slice. */
  k?: [number, number];
  /** Fades through black (seconds); cuts are hard otherwise. */
  dipIn?: number; dipOut?: number;
}

const CUTS: Cut[] = [
  // Intro: she lies where she wakes; her eyes open on the first hit.
  { clip: 'wake', from: 0, to: D(0), dipIn: 2.5 },
  // Sparse hits.
  { clip: 'grove', from: D(0), to: D(2) },
  { clip: 'inverted', from: D(2), to: D(4) },
  // Verse.
  { clip: 'shard', from: D(4), to: D(6) },
  { clip: 'gate', from: D(6), to: D(8) },
  { clip: 'lift', from: D(8), to: D(10) },
  { clip: 'shedding', from: D(10), to: D(12) },
  // Chorus.
  { clip: 'beam', from: D(12), to: D(14) },
  { clip: 'rupture', from: D(14), to: D(16) },
  { clip: 'grove', from: D(16), to: D(18), k: [0.2, 1] },
  // Into the breath: her face, the eyes closing, down to black before the climax.
  { clip: 'face', from: D(18), to: D(20) - 0.15, dipOut: 2.2 },
  // Climax.
  { clip: 'causeway', from: D(20), to: D(22) },
  { clip: 'ring', from: D(22), to: D(24) },
  // Montage: a cut every two beats to the hard stop.
  ...(['inverted', 'shard', 'gate', 'shedding', 'beam', 'face', 'lift', 'causeway'] as const).map((clip, i): Cut => ({
    clip, from: D(24) + i * BAR / 2, to: i === 7 ? 101.0 : D(24) + (i + 1) * BAR / 2,
    k: clip === 'face' ? [0.05, 0.3] : [0.45, 0.65],
  })),
  // Outro, after a beat of black.
  { clip: 'farshore', from: 103.2, to: END, dipIn: 2.5 },
];

/**
 * The teaser (about 35 s, for posting): the song's last chorus bar, the breath, the whole
 * climax to the hard stop, then the title on black over the quiet close.
 */
const TEASER: Cut[] = [
  { clip: 'shard', from: D(18), to: D(19), k: [0.3, 0.8], dipIn: 0.6 },
  { clip: 'face', from: D(19), to: D(20) - 0.15, k: [0.1, 0.9], dipOut: 2.2 },
  { clip: 'causeway', from: D(20), to: D(21), k: [0, 0.5] },
  { clip: 'shedding', from: D(21), to: D(22), k: [0.3, 0.8] },
  { clip: 'ring', from: D(22), to: D(23), k: [0.2, 0.7] },
  { clip: 'beam', from: D(23), to: D(24), k: [0.2, 0.7] },
  ...(['inverted', 'gate', 'lift', 'rupture', 'grove', 'wake', 'causeway', 'face'] as const).map((clip, i): Cut => ({
    clip, from: D(24) + i * BAR / 2, to: i === 7 ? 101.0 : D(24) + (i + 1) * BAR / 2,
    k: clip === 'face' ? [0.05, 0.3] : clip === 'wake' ? [0.72, 0.95] : [0.45, 0.65],
  })),
];

/** An edit: its cuts, where in the song it runs, and when the title comes. */
interface Edit { cuts: Cut[]; start: number; end: number; titleAt: number }
const EDITS: Record<'full' | 'teaser', Edit> = {
  full: { cuts: CUTS, start: 0, end: END, titleAt: TITLE_AT },
  teaser: { cuts: TEASER, start: D(18), end: 105.4, titleAt: 101.7 },
};

interface Overlay { black: number; title: number }

export function installTrailer(game: Game) {
  const g = game;
  const w = window as any;
  const params = new URLSearchParams(location.search);
  const music = params.get('music');
  let edit: Edit = EDITS[(params.get('edit') as 'full' | 'teaser') ?? 'full'] ?? EDITS.full;
  const byName = new Map(CLIPS.map((c) => [c.name, c]));

  document.getElementById('start')!.style.display = 'none';
  document.getElementById('fade')!.style.opacity = '0';
  document.getElementById('loading')?.setAttribute('hidden', '');
  const p = g.player;
  p.controllable = false;
  p.blockers = [];
  g.guide.setGoal(null);

  const shot: Shot = { position: V(), target: V(), lens: 35, range: 60, bokeh: 0, handheld: 0.35 };
  let cut = -1, t = 0, running = false, onDone: (() => void) | null = null;
  /** For stills: one clip on its own, outside the timeline. */
  let solo: { clip: Clip; t: number } | null = null;
  let current: Clip | null = null;
  const ov: Overlay = { black: 1, title: 0 };

  const enter = (c: Clip) => {
    current?.exit?.(g);
    current = c;
    const pl = g.player;
    pl.autopilot = null; pl.floorY = null; pl.eyelids = 0;
    pl.velocity.set(0, 0, 0);
    // Anywhere goes for her (the grove's edges don't apply to a camera move).
    pl.areas = [{ a: new THREE.Vector2(-5, -20), b: new THREE.Vector2(-5, -20), r: 400 }];
    (c as any).t = 0;
    g.weather.set(c.weather, 0);
    g.setStage(c.beat, true);
    c.enter(g);
    c.frame(g, 0, 0, shot);
    shot.position.y = Math.max(shot.position.y, Math.max(heightAt(shot.position.x, shot.position.z), 0) + 0.35);
    g.cam.cutTo(shot, 0);
  };

  /** Run clip c at k this frame (never inside the ground or the water). */
  const play = (c: Clip, k: number, dt: number) => {
    c.frame(g, Math.min(1, Math.max(0, k)), dt, shot);
    const floor = Math.max(heightAt(shot.position.x, shot.position.z), 0) + 0.35;
    if (shot.position.y < floor) shot.position.y = floor;
  };

  g.onFrame((dt) => {
    if (solo) {
      if (current !== solo.clip) enter(solo.clip);
      solo.t += dt;
      play(solo.clip, solo.t / solo.clip.seconds, dt);
      ov.black = 0; ov.title = 0;
      return;
    }
    if (!running) return;
    t += dt;
    if (t >= edit.end) {
      running = false;
      current?.exit?.(g); current = null; cut = -1;
      ov.black = 1; ov.title = 0;
      onDone?.();
      return;
    }
    const i = edit.cuts.findIndex((c) => t >= c.from && t < c.to);
    if (i < 0) { ov.black = 1; ov.title = title(t); return; }
    const c = edit.cuts[i], clip = byName.get(c.clip)!;
    // A new cut re-enters its clip, so a montage slice starts from her own place.
    if (i !== cut) { cut = i; enter(clip); }
    const [k0, k1] = c.k ?? [0, 1];
    const local = t - c.from, len = c.to - c.from;
    // Before a slice, run the clip on to where it starts (her walk, her eyes), unseen.
    if (local < dt * 1.5 && k0 > 0) for (let s = 0; s < k0 * clip.seconds; s += 1 / 30) play(clip, s / clip.seconds, 1 / 30);
    play(clip, lerp(k0, k1, local / len), dt);
    ov.black = Math.max(0,
      c.dipIn ? 1 - Math.min(1, local / c.dipIn) : 0,
      c.dipOut ? 1 - Math.min(1, (c.to - t) / c.dipOut) : 0);
    ov.title = title(t);
    // Behind the title the picture goes down, and at the very end, all of it.
    ov.black = Math.max(ov.black, ease(THREE.MathUtils.clamp((t - edit.titleAt - 1.5) / 4, 0, 1)) * 0.75, 1 - Math.min(1, (edit.end - t) / 1.2));
  });

  /** The title: in over 2.5 s from the edit's titleAt, holding, out in the last second and a half. */
  function title(time: number) {
    return ease(THREE.MathUtils.clamp((time - edit.titleAt) / 2.5, 0, 1)) * Math.min(1, Math.max(0, (edit.end - time) / 1.5));
  }

  const draw = (ctx: CanvasRenderingContext2D, W: number, H: number) => {
    if (ov.black > 0.001) { ctx.fillStyle = `rgba(0,0,0,${ov.black})`; ctx.fillRect(0, 0, W, H); }
    if (ov.title > 0.001) {
      const size = Math.round(Math.min(H * 0.045, W * 0.058));
      ctx.font = `400 ${size}px Montserrat, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(239,232,216,${ov.title})`;
      (ctx as any).letterSpacing = `${Math.round(size * 0.6)}px`;
      ctx.fillText('AFTERIMAGE', W / 2 + size * 0.3, H / 2);
    }
  };

  // Live overlay for preview (the recording draws the same thing into each frame).
  const layer = document.createElement('canvas');
  layer.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:900';
  document.body.append(layer);
  g.onFrame(() => {
    if (layer.width !== innerWidth) { layer.width = innerWidth; layer.height = innerHeight; }
    const ctx = layer.getContext('2d')!;
    ctx.clearRect(0, 0, layer.width, layer.height);
    if (running) draw(ctx, layer.width, layer.height);
  });

  const track = async () => {
    if (music) return music;
    const theme = 'audio/main_theme.mp3';
    const ok = await fetch(theme, { method: 'HEAD' }).then((r) => r.ok && !/text\/html/.test(r.headers.get('content-type') ?? '')).catch(() => false);
    return ok ? theme : 'audio/part1_end.mp3';
  };

  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;top:16px;left:16px;z-index:1000;display:flex;gap:8px;align-items:center;padding:10px 12px;background:#181914e8;color:#eee;font:12px system-ui;border-radius:6px';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  const button = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:12px system-ui;padding:4px 10px';
    b.onclick = fn;
    panel.append(b);
    return b;
  };
  status.textContent = `${edit.cuts.length} cuts · ${(edit.end - edit.start).toFixed(1)} s`;

  const preview = async (from = Number(params.get('from') ?? edit.start)) => {
    await prepare();
    w.__resume();
    g.audio.start();
    const src = await track();
    const el = new Audio(src);
    el.volume = 0.9;
    el.currentTime = from;
    t = from; cut = -1; running = true; solo = null;
    void el.play().catch(() => {});
    status.textContent = `preview · ${src}`;
    await new Promise<void>((r) => (onDone = r));
    el.pause();
    status.textContent = 'preview done';
  };

  /** Render at width×(width·9/16) until the returned function puts the window's size back. */
  const frame16x9 = (width: number) => {
    const r = g.renderer, height = Math.round(width * 9 / 16);
    const prevRatio = r.getPixelRatio();
    g.holdRes = true;
    r.setPixelRatio(1);
    r.setSize(width, height, false);
    g.cam.resize(width / height);
    return () => {
      g.holdRes = false;
      r.setPixelRatio(prevRatio);
      r.setSize(innerWidth, innerHeight, false);
      g.cam.resize(innerWidth / innerHeight);
    };
  };

  /** Fill the memory panes' album from the trailer's own shots (once). */
  const prepare = async () => {
    if (album.length) return;
    const restore = frame16x9(960);
    w.__freeze();
    try {
      for (const name of ['wake', 'grove', 'inverted', 'shard', 'shedding', 'ring']) {
        const c = byName.get(name)!;
        current = null;
        solo = { clip: c, t: 0 };
        w.__step(Math.round(c.seconds * 0.55 * 60));
        const p = g.captureFrame(480, 0.85);
        w.__step(1);
        album.push((await p) ?? undefined);
      }
      // Hang them now, so their images have loaded before the lift's cut comes round.
      g.panes.set(ORDER.map((id, i) => ({ id, found: true, spent: false, img: album[i] })));
      const loaded = () => ((g.panes as any).panes as { tex: THREE.Texture | null }[]).every((q) => !q.tex || (q.tex.image as HTMLImageElement | undefined)?.complete);
      for (let i = 0; i < 50 && !loaded(); i++) await new Promise((r) => setTimeout(r, 100));
    } finally {
      solo = null;
      current?.exit?.(g);
      current = null;
      restore();
    }
  };

  /**
   * Record an edit. `vertical` renders 16:9 at 3414×1920 and keeps a 1080×1920 window that
   * follows her across each shot (for Reels / TikTok / Shorts).
   */
  const record = async (o: { fps?: number; width?: number; take?: string; crf?: number; edit?: 'full' | 'teaser'; vertical?: boolean } = {}) => {
    edit = EDITS[o.edit ?? 'full'];
    const fps = o.fps ?? 30, vertical = !!o.vertical;
    const width = vertical ? 3414 : o.width ?? 1920;
    const take = (o.take ?? (o.edit === 'teaser' ? (vertical ? 'teaser_vertical' : 'teaser') : 'trailer')).replace(/[^\w-]/g, '');
    await prepare();
    const restore = frame16x9(width);
    w.__freeze();
    const per = Math.round(60 / fps);
    const frames = Math.ceil((edit.end - edit.start) * fps);
    t = edit.start; cut = -1; running = true; solo = null;
    // The vertical window: centred on her head, eased within a shot, snapping on a cut.
    let focus = 0.5, focusCut = -2;
    const her = V();
    const crop = (ctx: CanvasRenderingContext2D, W: number, H: number) => {
      const cw = Math.round(H * 9 / 16);
      head(g, her).project(g.cam.camera);
      const want = her.z < 1 ? THREE.MathUtils.clamp(her.x * 0.5 + 0.5, 0, 1) : focus;
      if (cut !== focusCut) { focus = want; focusCut = cut; } else focus += (want - focus) * 0.08;
      const x = THREE.MathUtils.clamp(focus * W - cw / 2, 0, W - cw);
      const c = document.createElement('canvas');
      c.width = cw; c.height = H;
      const cx = c.getContext('2d')!;
      cx.drawImage(ctx.canvas, x, 0, cw, H, 0, 0, cw, H);
      draw(cx, cw, H);
      return c;
    };
    const started = performance.now();
    try {
      for (let i = 0; i < frames && running; i++) {
        w.__step(per - 1);
        const shotP = g.captureFrame(width, 0.93, vertical ? crop : draw);
        w.__step(1);
        const url = await shotP;
        if (!url) throw new Error(`frame ${i} failed`);
        await fetch(`/__frame?take=${take}&i=${i}`, { method: 'POST', body: url });
        if (i % 15 === 0) {
          const per1 = (performance.now() - started) / (i + 1);
          status.textContent = `recording ${i}/${frames} · ${Math.round((frames - i) * per1 / 1000)} s left`;
          await new Promise((res) => setTimeout(res, 0));
        }
      }
      status.textContent = 'encoding…';
      const src = await track();
      const res = await fetch(`/__encode?take=${take}&fps=${fps}&crf=${o.crf ?? 19}&ss=${edit.start.toFixed(3)}&music=${encodeURIComponent(src)}`, { method: 'POST' });
      const text = await res.text();
      status.textContent = res.ok ? `saved ${text.replace(/^.*\/game\//, 'game/')}` : 'encode failed (see console)';
      if (!res.ok) console.error(text);
      return res.ok ? text : null;
    } finally {
      running = false;
      restore();
      w.__resume();
    }
  };

  /** One 16:9 still from a clip (for framing), saved to .shots/trailer_<name>_<k%>.jpg. */
  const still = async (name: string, k = 0.5) => {
    const c = byName.get(name);
    if (!c) return 'no such clip';
    await prepare();
    w.__freeze();
    const restore = frame16x9(1280);
    running = false;
    current = null;
    solo = { clip: c, t: 0 };
    w.__step(Math.max(1, Math.round(c.seconds * k * 60)));
    const saved = await w.__save(`trailer_${name}_${Math.round(k * 100)}`, 1280);
    solo = null;
    restore();
    return saved;
  };

  button('preview', () => void preview());
  button('record 1080p', () => void record());
  button('teaser 16:9', () => void record({ edit: 'teaser' }));
  button('teaser 9:16', () => void record({ edit: 'teaser', vertical: true }));
  panel.append(status);
  document.body.append(panel);
  w.__trailer = { preview, record, still, clips: CLIPS.map((c) => c.name), edits: EDITS };
}
