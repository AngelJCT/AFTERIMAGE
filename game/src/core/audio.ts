import * as THREE from 'three/webgpu';

/**
 * Procedural sound design for Part I (no recorded assets yet).
 *
 * Buses:  world (ambience + foley, can be ducked and muffled) ─┐
 *         hum (her core) ──────────────────────────────────────┼─> master -> limiter -> out
 *         music (score cues, if files are present) ────────────┘
 *         + a shared reverb send for the open grove.
 *
 * World sounds are positioned in 3D (HRTF) around a listener that follows the camera.
 * Drop score files in public/audio/ (see MUSIC_CUES) and they play at the story cues.
 */

export const MUSIC_CUES = {
  open: 'audio/part1_open.mp3',   // cold open, under "when I woke…" to "I keep coming back…"
  end: 'audio/part1_end.mp3',     // the walk toward the arches and the end card
  grove: 'audio/grove.mp3',       // the grove path between afterimages (it stops for each one)
  gate: 'audio/part2_gate.mp3',   // arriving at the refuge gate: the reflex, the place, the trigger
  past: 'audio/part2_past.mp3',   // the memory: tenderness, the flight, the gate, the choice
  trace: 'audio/part2_end.mp3',   // the strip on the bolt, the turn, the card
  credits: 'audio/SomeoneToFind.mp3', // the end credits (story/credits.ts)
  title: 'audio/main_theme.mp3',  // the title screen: "Ka-e Eren" (docs/music-suno-prompts.md), when it's there
} as const;

/** Cues under open-ended play (walking the path, waiting at the gate) loop; the rest play once. */
const LOOPED = new Set<keyof typeof MUSIC_CUES>(['grove', 'gate']);

/**
 * Stems (optional): a cue can come as separate parts that play in sync, so the story can bring
 * them in and out (the voice returning as she remembers, the pulse under a chase). List them
 * in `public/audio/stems/stems.json`, e.g. `{ "grove": ["instruments", "voice"] }`, with files
 * named `audio/stems/<cue>_<layer>.mp3` (Suno's "Get Stems" gives vocals and instrumental). A
 * cue without stems plays its single file as before.
 */
const STEMS_URL = 'audio/stems/stems.json';
export type Layer = 'instruments' | 'voice' | 'pulse' | 'strings' | 'choir' | 'piano';

type V3 = { x: number; y: number; z: number };

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private world!: GainNode;        // ducking
  private muffle!: BiquadFilterNode; // eyes closed: the world goes dull and far
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private reverbSend!: GainNode;
  private humGain!: GainNode;
  private humPanner!: PannerNode;
  private innerTone!: GainNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private pink!: AudioBuffer;
  private waterGain!: GainNode;
  private waterPanner!: PannerNode;
  private nextGust = 4;
  private nextCreak = 6;
  private nextLap = 0;
  private nextDust = 0;
  private time = 0;
  private music: { cue: string; time(): number; ended(): boolean; stop(fade: number): void } | null = null;
  private scoreFilter!: BiquadFilterNode;
  private scoreGain!: GainNode;
  private stems: Record<string, string[]> | null | undefined = undefined;
  private layerGains = new Map<string, GainNode>();
  private layerLevels: Record<string, number> = {};
  private intensity = 1;
  private musicCache = new Map<string, AudioBuffer | null>();

  /** Places sounds can come from (tree positions), set by the game. */
  creakSources: THREE.Vector2[] = [];
  /** Pools the water lapping comes from. */
  pools: V3[] = [];

  start() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    // Started without a user gesture (checkpoint reload): resume on the first input.
    if (ctx.state === 'suspended') {
      const wake = () => void ctx.resume();
      addEventListener('pointerdown', wake, { once: true });
      addEventListener('keydown', wake, { once: true });
    }

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(limiter);

    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 1;
    const reverb = ctx.createConvolver(); reverb.buffer = this.makeImpulse(3.2, 1.3);
    const reverbOut = ctx.createGain(); reverbOut.gain.value = 0.35;
    this.reverbSend.connect(reverb).connect(reverbOut).connect(this.master);

    this.world = ctx.createGain(); this.world.gain.value = 1;
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.4;
    this.world.connect(this.muffle).connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.world);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.7;
    // The score's intensity: a gentle low-pass and level (see setIntensity).
    this.scoreFilter = ctx.createBiquadFilter(); this.scoreFilter.type = 'lowpass'; this.scoreFilter.frequency.value = 20000; this.scoreFilter.Q.value = 0.5;
    this.scoreGain = ctx.createGain(); this.scoreGain.gain.value = 1;
    this.musicBus.connect(this.scoreFilter).connect(this.scoreGain).connect(this.master);
    this.applyIntensity(0);

    this.white = this.makeNoise('white');
    this.brown = this.makeNoise('brown');
    this.pink = this.makeNoise('pink');

    this.startWind();
    this.startRain();
    this.setWind(this.windLevel);
    this.setRain(this.rainLevel);
    this.startHum();
    this.startMovement();
    this.startRing();
    this.startWater();

    // "Somewhere inside the quiet": a faint inner tone that only exists with the eyes closed.
    this.innerTone = ctx.createGain(); this.innerTone.gain.value = 0;
    for (const [f, a] of [[3170, 0.004], [3181, 0.003]] as const) {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = a;
      o.connect(g).connect(this.innerTone); o.start();
    }
    this.innerTone.connect(this.master);
  }

  // ── continuous layers ──────────────────────────────────────────────────

  private windBus!: GainNode;
  private rainGain!: GainNode;
  private rainLevel = 0;
  /** Weather: how hard the wind blows (1 normal) and how hard it rains (0..1). */
  windLevel = 1;

  /** Weather (world/weather.ts): the wind's loudness (1 = the grove's usual) and gust rate. */
  setWind(level: number) {
    this.windLevel = level;
    if (!this.ctx) return;
    this.windBus.gain.setTargetAtTime(Math.min(3, level), this.ctx.currentTime, 0.8);
  }

  /** Weather: rain on water and stone, 0..1 (a filtered hiss with a patter on top). */
  setRain(level: number) {
    this.rainLevel = level;
    if (!this.ctx) return;
    this.rainGain.gain.setTargetAtTime(level * 0.16, this.ctx.currentTime, 0.8);
  }

  private startRain() {
    const ctx = this.ctx!;
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
    const hiss = this.loop(this.pink);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 5200; bp.Q.value = 0.35;
    const low = this.loop(this.brown);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const lg = ctx.createGain(); lg.gain.value = 0.5;
    hiss.connect(bp).connect(this.rainGain);
    low.connect(lp).connect(lg).connect(this.rainGain);
    this.rainGain.connect(this.world);
  }

  private startWind() {
    const ctx = this.ctx!;
    this.windBus = ctx.createGain(); this.windBus.gain.value = 1;
    this.windBus.connect(this.world);
    // Low body: brown noise, slow swell.
    const low = this.loop(this.brown);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const lg = ctx.createGain(); lg.gain.value = 0.18;
    this.lfo(0.06, 0.06, lg.gain);
    low.connect(lp).connect(lg).connect(this.windBus);
    // Air: pink noise high band, barely there.
    const air = this.loop(this.pink);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.6;
    const ag = ctx.createGain(); ag.gain.value = 0.012;
    this.lfo(0.11, 0.006, ag.gain);
    air.connect(bp).connect(ag).connect(this.windBus);
  }

  // Movement: no steps (they read as percussion). Instead two soft beds that swell and fall with
  // her pace: water parting round her legs when she wades, and a faint air/cloth breath when she
  // moves at all; and now and then, as she turns or kneels, a small ceramic creak of her shell.
  private wadeGain!: GainNode;
  private bodyGain!: GainNode;
  private nextShell = 0;
  private startMovement() {
    const ctx = this.ctx!;
    this.wadeGain = ctx.createGain(); this.wadeGain.gain.value = 0;
    const wade = this.loop(this.pink);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 850; bp.Q.value = 0.6;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    wade.connect(bp).connect(lp).connect(this.wadeGain).connect(this.sfx);
    this.bodyGain = ctx.createGain(); this.bodyGain.gain.value = 0;
    const body = this.loop(this.brown);
    const blp = ctx.createBiquadFilter(); blp.type = 'lowpass'; blp.frequency.value = 320;
    body.connect(blp).connect(this.bodyGain).connect(this.sfx);
  }

  /**
   * Each frame: how fast she moves (m/s), how deep the water at her is (m), how fast she turns
   * (rad/s) and how fast her pose changes (kneel/lie per s).
   */
  movement(speed: number, depth: number, turn: number, poseRate: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const pace = Math.min(1, speed / 2.2);
    const wet = Math.min(1, Math.max(0, depth) / 0.25);
    this.wadeGain.gain.setTargetAtTime(0.14 * pace * wet, t, 0.25);
    this.bodyGain.gain.setTargetAtTime(0.05 * pace, t, 0.4);
    // The shell: rarely, softly, only while she turns or kneels/rises.
    const stir = Math.min(1, Math.abs(turn) / 2 + Math.abs(poseRate) * 1.5);
    if ((this.nextShell -= 1 / 60) <= 0 && stir > 0.3) {
      this.nextShell = 1.8 + Math.random() * 3;
      this.shell(0.5 + stir * 0.5);
    }
  }

  /** A small ceramic creak: a few soft, inharmonic partials with a slow attack (no click). */
  private shell(k: number) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.setTargetAtTime(0.008 * k, t, 0.05);
    g.gain.setTargetAtTime(0, t + 0.18, 0.18);
    const base = 1300 + Math.random() * 500;
    for (const [m, a] of [[1, 1], [1.53, 0.5], [2.71, 0.25]] as const) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(base * m, t);
      o.frequency.linearRampToValueAtTime(base * m * 0.97, t + 0.5);
      const og = ctx.createGain(); og.gain.value = a;
      o.connect(og).connect(g);
      o.start(t); o.stop(t + 1.2);
    }
    g.connect(this.sfx);
    g.connect(this.reverbSend);
  }

  // The ring on the horizon: a low drone, two slightly detuned fifths breathing slowly, heard
  // only when she faces it (and more as it's drawn further).
  private ringGain!: GainNode;
  private startRing() {
    const ctx = this.ctx!;
    this.ringGain = ctx.createGain(); this.ringGain.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    const trem = ctx.createOscillator(); trem.frequency.value = 0.11;
    const tremAmt = ctx.createGain(); tremAmt.gain.value = 0.35;
    const body = ctx.createGain(); body.gain.value = 0.65;
    trem.connect(tremAmt).connect(body.gain); trem.start();
    for (const [f, a] of [[98, 1], [98.6, 0.8], [147, 0.45], [147.9, 0.35]] as const) {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = a;
      o.connect(og).connect(body); o.start();
    }
    body.connect(lp).connect(this.ringGain).connect(this.world);
    this.ringGain.connect(this.reverbSend);
  }

  /** 0..1: how much of the ring she faces (and how far it's drawn). */
  setRing(level: number) {
    if (!this.ctx) return;
    this.ringGain.gain.setTargetAtTime(0.035 * level, this.ctx.currentTime, 1.2);
  }

  private startHum() {
    const ctx = this.ctx!;
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0;
    this.humPanner = this.panner(1.2, 1.4);
    const vib = ctx.createOscillator(); vib.frequency.value = 0.31;
    const vibAmt = ctx.createGain(); vibAmt.gain.value = 0.6;
    vib.connect(vibAmt); vib.start();
    for (const [f, g] of [[58, 0.5], [116.4, 0.22], [174.9, 0.08], [233.6, 0.03]] as const) {
      const o = ctx.createOscillator(); o.frequency.value = f;
      vibAmt.connect(o.detune);
      const og = ctx.createGain(); og.gain.value = g;
      o.connect(og).connect(this.humGain); o.start();
    }
    // The hum sits in her body; its breathing follows a slow amplitude drift.
    const breath = ctx.createGain(); breath.gain.value = 1;
    this.lfo(0.18, 0.12, breath.gain);
    this.humGain.connect(breath).connect(this.humPanner).connect(this.master);
    breath.connect(this.reverbSend);
  }

  private startWater() {
    const ctx = this.ctx!;
    this.waterPanner = this.panner(2, 1.2);
    this.waterGain = ctx.createGain(); this.waterGain.gain.value = 0;
    this.waterGain.connect(this.waterPanner).connect(this.world);
  }

  // ── per frame ──────────────────────────────────────────────────────────

  /** Follow the camera, place her hum, and schedule the grove's incidental sounds. */
  update(dt: number, camera: THREE.Camera, player: V3, port?: V3) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.time += dt;
    const t = ctx.currentTime;
    const L = ctx.listener;
    const p = camera.getWorldPosition(new THREE.Vector3());
    const f = camera.getWorldDirection(new THREE.Vector3());
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.05); L.positionY.setTargetAtTime(p.y, t, 0.05); L.positionZ.setTargetAtTime(p.z, t, 0.05);
      L.forwardX.setTargetAtTime(f.x, t, 0.05); L.forwardY.setTargetAtTime(f.y, t, 0.05); L.forwardZ.setTargetAtTime(f.z, t, 0.05);
      L.upX.setTargetAtTime(u.x, t, 0.05); L.upY.setTargetAtTime(u.y, t, 0.05); L.upZ.setTargetAtTime(u.z, t, 0.05);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
    const hp = port ?? { x: player.x, y: player.y + 1.3, z: player.z };
    this.place(this.humPanner, hp);

    // Water: laps from the nearest pool edge, louder the closer she is.
    let near: V3 | null = null, nd = Infinity;
    for (const q of this.pools) {
      const d = Math.hypot(q.x - player.x, q.z - player.z);
      if (d < nd) { nd = d; near = q; }
    }
    if (near) {
      const k = THREE.MathUtils.clamp(1 - (nd - 2) / 7, 0, 1);
      this.waterGain.gain.setTargetAtTime(k * 0.5, t, 0.4);
      const dir = new THREE.Vector2(player.x - near.x, player.z - near.z).normalize();
      this.place(this.waterPanner, { x: near.x + dir.x * 1.6, y: 0, z: near.z + dir.y * 1.6 });
      if (k > 0 && (this.nextLap -= dt) <= 0) {
        this.lap();
        this.nextLap = 0.5 + Math.random() * 1.6;
      }
    }

    if ((this.nextGust -= dt) <= 0) { this.gust(); this.nextGust = (7 + Math.random() * 10) / Math.max(0.5, this.windLevel); }

    const gk = this.gustAt < 0 ? 1 : (this.ctx!.currentTime - this.gustAt) / this.gustDur;
    this.gustLevel = gk >= 0 && gk <= 1 ? Math.sin(Math.PI * Math.min(1, gk / 0.9)) : 0;
    if ((this.nextCreak -= dt) <= 0) { this.creak(player); this.nextCreak = 5 + Math.random() * 11; }
    if ((this.nextDust -= dt) <= 0) { this.dust(); this.nextDust = 0.25 + Math.random() * 1.1; }
  }

  // ── incidental ambience ────────────────────────────────────────────────

  /** A gust: a filtered whoosh that crosses the stereo field, whistling faintly through thorns. */
  /** 0..1: how hard the current gust is blowing (the water and dust follow it). */
  gustLevel = 0;
  private gustAt = -1;
  private gustDur = 1;

  private gust() {
    const ctx = this.ctx!, t = ctx.currentTime, dur = 3 + Math.random() * 3;
    this.gustAt = t; this.gustDur = dur;
    const src = this.oneShot(this.pink, dur + 0.5);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(300, t); bp.frequency.linearRampToValueAtTime(900 + Math.random() * 500, t + dur * 0.5);
    bp.frequency.linearRampToValueAtTime(260, t + dur);
    const g = this.env(t, 0.05 + Math.random() * 0.04, dur * 0.45, dur * 0.55);
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(Math.random() * 2 - 1, t); pan.pan.linearRampToValueAtTime(Math.random() * 2 - 1, t + dur);
    src.connect(bp).connect(g).connect(pan).connect(this.world);
    // Whistle: a narrow resonance through the branches.
    const w = ctx.createBiquadFilter(); w.type = 'bandpass'; w.Q.value = 24; w.frequency.value = 650 + Math.random() * 500;
    w.frequency.linearRampToValueAtTime(w.frequency.value * 1.08, t + dur);
    const wg = this.env(t, 0.03, dur * 0.5, dur * 0.5);
    src.connect(w).connect(wg).connect(pan);
    g.connect(this.reverbSend);
  }

  /** The grove's biomechanical conduits settling: a low groan with a metallic ring, somewhere out there. */
  creak(player: V3) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const cands = this.creakSources.filter((s) => {
      const d = Math.hypot(s.x - player.x, s.y - player.z);
      return d > 5 && d < 26;
    });
    if (!cands.length) return;
    const s = cands[Math.floor(Math.random() * cands.length)];
    const pan = this.panner(4, 1);
    this.place(pan, { x: s.x, y: 2.5, z: s.y });
    const out = ctx.createGain(); out.gain.value = 0.9;
    out.connect(pan).connect(this.world);
    out.connect(this.reverbSend);
    // Groan: a slow sawtooth through a sweeping resonant filter.
    const dur = 1.2 + Math.random() * 1.6;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = 38 + Math.random() * 30;
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (0.85 + Math.random() * 0.3), t + dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
    bp.frequency.setValueAtTime(180, t); bp.frequency.exponentialRampToValueAtTime(520 + Math.random() * 300, t + dur * 0.6);
    const g = this.env(t, 0.05, dur * 0.3, dur * 0.7);
    o.connect(bp).connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.1);
    // Ring: a few inharmonic partials, like a conduit humming after the strain.
    if (Math.random() < 0.6) {
      const base = 260 + Math.random() * 180;
      for (const [r, a] of [[1, 0.018], [2.37, 0.01], [3.91, 0.006]] as const) {
        const ro = ctx.createOscillator(); ro.frequency.value = base * r;
        const rg = this.env(t + dur * 0.3, a, 0.12, 2.4);   // a swell, not a strike
        ro.connect(rg).connect(out); ro.start(t + dur * 0.3); ro.stop(t + dur * 0.3 + 2.6);
      }
    }
  }

  /** Shallow water lapping at the edge. */
  private lap() {
    const ctx = this.ctx!, t = ctx.currentTime;
    const src = this.oneShot(this.white, 0.6);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(500 + Math.random() * 400, t); bp.frequency.exponentialRampToValueAtTime(260, t + 0.35);
    const g = this.env(t, 0.05 + Math.random() * 0.04, 0.06, 0.32);
    src.connect(bp).connect(g).connect(this.waterGain);
  }

  /** Falling dust catching the light: tiny high glints, almost below hearing. */
  private dust() {
    const ctx = this.ctx!, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.value = 5200 + Math.random() * 3600;
    const g = this.env(t, 0.0016 + Math.random() * 0.0016, 0.004, 0.18);
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1;
    o.connect(g).connect(pan).connect(this.world);
    g.connect(this.reverbSend);
    o.start(t); o.stop(t + 0.25);
  }

  // ── foley & interaction ────────────────────────────────────────────────

  /**
   * Footsteps: silent. (They read as percussion under the score; her steps show in the water
   * rings instead.)
   */
  footstep(_wet: boolean, _speed: number, _at?: V3) {}

  /** Her body shifting as she kneels, rises or stirs: silent (it read as clicks and snares). */
  bodyMove(_intensity = 0.5) {}

  /** A fingertip meeting water: a soft ringing shimmer, fuller and brighter the rougher it is. */
  touchWater(strength: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const out = ctx.createGain(); out.gain.value = 1;
    out.connect(this.sfx); out.connect(this.reverbSend);
    const t = ctx.currentTime;
    const src = this.oneShot(this.pink, 1.6);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 14 - strength * 8;
    bp.frequency.setValueAtTime(1900 + strength * 600, t); bp.frequency.exponentialRampToValueAtTime(900, t + 1.3);
    const g = this.env(t, 0.05 + strength * 0.05, 0.12, 1.3);
    src.connect(bp).connect(g).connect(out);
  }

  /** Water disturbed: a soft wash that swells and settles (no hit). */
  splash(strength: number, dest: AudioNode = this.sfx) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = this.oneShot(this.pink, 1.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = this.env(t, 0.06 * strength, 0.15, 0.8);
    src.connect(lp).connect(g).connect(dest);
  }

  portChime(level = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const car = ctx.createOscillator(); car.frequency.value = 1318.5;
    const mod = ctx.createOscillator(); mod.frequency.value = 1318.5 * 1.41;
    const modG = ctx.createGain(); modG.gain.setValueAtTime(600, t); modG.gain.exponentialRampToValueAtTime(10, t + 1.8);
    mod.connect(modG).connect(car.frequency);
    const g = this.env(t, 0.03 * level, 0.01, 2.6);
    car.connect(g); g.connect(this.humPanner); g.connect(this.reverbSend);
    car.start(t); mod.start(t); car.stop(t + 2.8); mod.stop(t + 2.8);
  }

  hum(level: number, seconds = 3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, g = this.humGain.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(level * 0.07, t + seconds);
  }

  /** Fade the world's sounds (not the hum or music) to `level` of normal. */
  duck(level: number, seconds = 1.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, g = this.world.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(level, t + seconds);
  }

  /** Eyes closed: 0 open .. 1 closed. The world dulls and recedes; an inner tone appears. */
  setClosed(k: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.muffle.frequency.setTargetAtTime(20000 * Math.pow(350 / 20000, k), t, 0.08);
    this.innerTone.gain.setTargetAtTime(k, t, 0.3);
  }

  // ── memory ─────────────────────────────────────────────────────────────

  /**
   * A memory echo heard from where it waits: a larger water note answered by a smaller one,
   * like two hands on water. Goes straight to the master (not the muffled world), so it is
   * clearest with the eyes closed.
   */
  echo(at: V3, level: number) {
    const ctx = this.ctx;
    if (!ctx || level <= 0.001) return;
    const pan = this.panner(2, 1.1);
    pan.positionX.value = at.x; pan.positionY.value = at.y; pan.positionZ.value = at.z;
    const out = ctx.createGain(); out.gain.value = level;
    pan.connect(out); out.connect(this.master); out.connect(this.reverbSend);
    const t = ctx.currentTime;
    for (const [dt, f, a] of [[0, 820, 0.07], [0.42 + Math.random() * 0.1, 1240, 0.045]] as const) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f, t + dt); o.frequency.exponentialRampToValueAtTime(f * 0.55, t + dt + 0.35);
      const g = this.env(t + dt, a, 0.006, 1.4);
      o.connect(g).connect(pan); o.start(t + dt); o.stop(t + dt + 1.6);
    }
    setTimeout(() => { pan.disconnect(); out.disconnect(); }, 3000);
  }

  /** A gust now (the salt marsh asks for one). */
  gustNow() {
    if (this.ctx) { this.gust(); this.nextGust = 8 + Math.random() * 6; }
  }

  /** Clear memory sounds: through a panner straight to the master (unmuffled by closed eyes). */
  private memoryOut(at: V3, level: number, ref = 1.5) {
    const ctx = this.ctx!;
    const pan = this.panner(ref, 1.0);
    pan.positionX.value = at.x; pan.positionY.value = at.y; pan.positionZ.value = at.z;
    const out = ctx.createGain(); out.gain.value = level;
    pan.connect(out); out.connect(this.master); out.connect(this.reverbSend);
    return { pan, done: (ms: number) => setTimeout(() => { pan.disconnect(); out.disconnect(); }, ms) };
  }

  /**
   * Rain on a coat beside her: a close patter on fabric (soft ticks, a few heavier drops)
   * with the hiss of rain around it.
   */
  rain(at: V3, seconds: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const { pan, done } = this.memoryOut(at, 1, 1.2);
    // Hiss.
    const hiss = this.oneShot(this.pink, seconds + 1);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.0001, t); hg.gain.linearRampToValueAtTime(0.05, t + 1.5);
    hg.gain.setValueAtTime(0.05, t + seconds - 1.5); hg.gain.linearRampToValueAtTime(0.0001, t + seconds);
    hiss.connect(hp).connect(hg).connect(this.master);
    // Patter on fabric: short dull ticks.
    const n = Math.round(seconds * 38);
    for (let i = 0; i < n; i++) {
      const at0 = t + 0.4 + Math.random() * (seconds - 0.8);
      const edge = Math.min(1, (at0 - t) / 1.5, (t + seconds - at0) / 1.5);
      const heavy = Math.random() < 0.08;
      const src = ctx.createBufferSource(); src.buffer = this.white;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.value = heavy ? 700 + Math.random() * 300 : 1400 + Math.random() * 1600;
      const g = this.env(at0, (heavy ? 0.09 : 0.035) * edge, 0.001, heavy ? 0.06 : 0.025);
      src.connect(bp).connect(g).connect(pan);
      src.start(at0, Math.random() * 1.5); src.stop(at0 + 0.1);
    }
    done((seconds + 3) * 1000);
  }

  /** A remembered step in shallow water: silent (steps read as percussion). */
  memoryStep(_at: V3, _weight: number) {}

  private groanNodes: { g: GainNode; osc: OscillatorNode[] } | null = null;
  /** Strained metal: a low grinding groan that swells and holds (0 fades it out). */
  groan(level: number, seconds = 1.5) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (!this.groanNodes && level > 0) {
      const g = ctx.createGain(); g.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 3;
      const osc: OscillatorNode[] = [];
      for (const [f, d] of [[46, 0], [46.7, 8], [69, -5]] as const) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d;
        const wob = ctx.createOscillator(); wob.frequency.value = 0.7 + Math.random();
        const wg = ctx.createGain(); wg.gain.value = 3;
        wob.connect(wg).connect(o.frequency); wob.start();
        o.connect(lp); o.start(); osc.push(o, wob);
      }
      lp.connect(g); g.connect(this.master); g.connect(this.reverbSend);
      this.groanNodes = { g, osc };
    }
    const n = this.groanNodes;
    if (!n) return;
    n.g.gain.cancelScheduledValues(t); n.g.gain.setValueAtTime(n.g.gain.value, t);
    n.g.gain.linearRampToValueAtTime(level * 0.05, t + seconds);
    if (level <= 0) {
      for (const o of n.osc) o.stop(t + seconds + 0.1);
      this.groanNodes = null;
    }
  }

  /** A heavy weight arriving: a low rumble that swells and fades (no knock). */
  thud(level = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = this.oneShot(this.brown, 1.4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const g = this.env(t, 0.22 * level, 0.12, 1.0);
    src.connect(lp).connect(g); g.connect(this.master); g.connect(this.reverbSend);
  }

  /** Iron ringing: a few inharmonic partials swelling in and dying away, like a bowl (no strike). */
  clang(level = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, a, d] of [[182, 0.04, 2.0], [431, 0.026, 1.5], [797, 0.014, 1.1]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f * (0.98 + Math.random() * 0.04);
      const g = this.env(t, a * level, 0.09, d);
      o.connect(g); g.connect(this.master); g.connect(this.reverbSend);
      o.start(t); o.stop(t + d + 0.2);
    }
  }

  /** Current along a conduit: a rising electrical tone with a buzz, `seconds` long. */
  charge(at: V3, seconds: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const { pan, done } = this.memoryOut(at, 1, 2.5);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(420, t + seconds);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(3200, t + seconds);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + seconds);
    o.connect(lp).connect(g).connect(pan); o.start(t); o.stop(t + seconds + 0.05);
    const s2 = ctx.createOscillator(); s2.frequency.setValueAtTime(880, t); s2.frequency.exponentialRampToValueAtTime(1760, t + seconds);
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.018, t + seconds);
    s2.connect(g2).connect(pan); s2.start(t); s2.stop(t + seconds + 0.05);
    done((seconds + 1) * 1000);
  }

  /** The surge: a rising electric whoosh and a low swell beneath it (no crackle, no hit). */
  surge() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = this.oneShot(this.pink, 1.4);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(800, t); bp.frequency.exponentialRampToValueAtTime(3600, t + 0.6);
    const g = this.env(t, 0.16, 0.18, 0.9);
    src.connect(bp).connect(g); g.connect(this.master); g.connect(this.reverbSend);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 1.0);
    const og = this.env(t, 0.08, 0.2, 0.9);
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 1.3);
  }

  /** Everything goes silent for `seconds` (her core cutting out), then comes back. */
  blackout(seconds: number, back = 2.5) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, g = this.master.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.0001, t + 0.08);
    g.setValueAtTime(0.0001, t + seconds);
    g.linearRampToValueAtTime(0.9, t + seconds + back);
  }

  /**
   * Small breaths beside her in the dark: soft inhales and exhales, a child's pace,
   * `seconds` long. Clear of the closed-eye muffle.
   */
  breaths(at: V3, seconds: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const { pan, done } = this.memoryOut(at, 1, 0.8);
    let k = t + 0.6;
    while (k < t + seconds - 1) {
      for (const [dur, f, a] of [[0.9, 1400, 0.03], [1.2, 900, 0.022]] as const) {
        const src = ctx.createBufferSource(); src.buffer = this.pink;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 0.7;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, k); g.gain.linearRampToValueAtTime(a, k + dur * 0.45); g.gain.linearRampToValueAtTime(0.0001, k + dur);
        src.connect(bp).connect(g).connect(pan); src.start(k, Math.random() * 2); src.stop(k + dur + 0.05);
        k += dur + 0.15;
      }
      k += 0.5 + Math.random() * 0.4;
    }
    done((seconds + 2) * 1000);
  }

  private pad: GainNode | null = null;
  /** A warm held chord under an afterimage (fades in/out). */
  memoryPad(on: boolean, seconds = 3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (on && !this.pad) {
      const g = ctx.createGain(); g.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      for (const [f, d] of [[220, -4], [220, 5], [277.2, 3], [329.6, -3], [440, 2]] as const) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = d;
        const og = ctx.createGain(); og.gain.value = f > 300 ? 0.012 : 0.02;
        o.connect(og).connect(lp); o.start();
        (g as any)._osc = [...((g as any)._osc ?? []), o];
      }
      lp.connect(g); g.connect(this.musicBus); g.connect(this.reverbSend);
      g.gain.linearRampToValueAtTime(1, t + seconds);
      this.pad = g;
    } else if (!on && this.pad) {
      const g = this.pad; this.pad = null;
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + seconds);
      for (const o of (g as any)._osc as OscillatorNode[]) o.stop(t + seconds + 0.1);
    }
  }

  /** One note of the three-note motif (each afterimage returns one), held and ringing. */
  motifNote(i: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const f = [440, 659.25, 587.33][i % 3] * (i >= 3 ? 2 : 1);
    const t = ctx.currentTime;
    for (const [mult, amp] of [[1, 0.07], [2, 0.014], [3, 0.005]] as const) {
      const o = ctx.createOscillator(); o.frequency.value = f * mult;
      const g = this.env(t, amp, 0.05, 5);
      o.connect(g); g.connect(this.musicBus); g.connect(this.reverbSend);
      o.start(t); o.stop(t + 5.2);
    }
  }

  // ── music ──────────────────────────────────────────────────────────────

  private async load(url: string) {
    const ctx = this.ctx!;
    let buf = this.musicCache.get(url);
    if (buf === undefined) {
      try {
        const res = await fetch(url);
        buf = res.ok && (res.headers.get('content-type') ?? '').startsWith('audio') ? await ctx.decodeAudioData(await res.arrayBuffer()) : null;
      } catch { buf = null; }
      this.musicCache.set(url, buf);
    }
    return buf;
  }

  private async stemList(cue: string) {
    if (this.stems === undefined) {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}${STEMS_URL}`);
        this.stems = res.ok && (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null;
      } catch { this.stems = null; }
    }
    return this.stems?.[cue] ?? [];
  }

  /**
   * Play a score cue if its file (or its stems) exist in public/audio. Resolves false if not.
   * Stems start together and loop together; each has its own level (setLayer).
   */
  /** `offset`: where in the cue to start (seconds; cues that play once only). */
  async playMusic(cue: keyof typeof MUSIC_CUES, fadeIn = 2, offset = 0) {
    const ctx = this.ctx;
    if (!ctx) return false;
    const base = import.meta.env.BASE_URL;
    let parts: { layer: string | null; buf: AudioBuffer }[] = [];
    for (const layer of await this.stemList(cue)) {
      const buf = await this.load(`${base}audio/stems/${cue}_${layer}.mp3`);
      if (buf) parts.push({ layer, buf });
    }
    if (!parts.length) {
      const buf = await this.load(`${base}${MUSIC_CUES[cue]}`);
      if (!buf) return false;
      parts = [{ layer: null, buf }];
    }
    this.stopMusic(1.5);
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + fadeIn);
    g.connect(this.musicBus);
    // One gain per stem, at its current level.
    this.layerGains.clear();
    const outs = parts.map(({ layer }) => {
      if (!layer) return g;
      const lg = ctx.createGain();
      lg.gain.value = this.layerLevels[layer] ?? 1;
      lg.connect(g);
      this.layerGains.set(layer, lg);
      return lg;
    });
    const sources = new Set<AudioBufferSourceNode>();
    let alive = true;
    let timer = 0;
    if (!LOOPED.has(cue)) {
      parts.forEach(({ buf }, i) => {
        const src = ctx.createBufferSource(); src.buffer = buf;
        src.connect(outs[i]); src.start(t, Math.min(offset, buf.duration));
        sources.add(src);
      });
    } else {
      // Score files fade in and out at their ends: loop only the audible part (of the fullest
      // stem, shared by all), crossfading each pass into the next so there's never a gap.
      const [a, b] = this.audibleRange(parts[0].buf);
      const len = b - a, X = Math.min(6, len / 4);
      const pass = (when: number, fade: boolean) => {
        parts.forEach(({ buf }, i) => {
          const s = ctx.createBufferSource(); s.buffer = buf;
          const sg = ctx.createGain();
          sg.gain.setValueAtTime(fade ? 0.0001 : 1, when);
          if (fade) sg.gain.exponentialRampToValueAtTime(1, when + X);
          sg.gain.setValueAtTime(1, when + len - X);
          sg.gain.linearRampToValueAtTime(0.0001, when + len);
          s.connect(sg).connect(outs[i]);
          s.start(when, a, len + 0.05);
          sources.add(s);
          s.onended = () => sources.delete(s);
        });
        const next = when + len - X;
        timer = window.setTimeout(() => { if (alive) pass(next, true); }, Math.max(0, (next - ctx.currentTime - 1) * 1000));
      };
      pass(t, false);
    }
    const length = parts[0].buf.duration;
    this.music = {
      cue,
      // Where in the cue it is now (looped cues: within the first pass only, roughly).
      time: () => (LOOPED.has(cue) ? ctx.currentTime - t : Math.min(length, ctx.currentTime - t + offset)),
      ended: () => !LOOPED.has(cue) && ctx.currentTime - t + offset >= length,
      stop: (fade: number) => {
        alive = false; clearTimeout(timer);
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.linearRampToValueAtTime(0, now + fade);
        for (const s of sources) s.stop(now + fade + 0.1);
      },
    };
    return true;
  }

  /** Bring one stem of the score in or out (0..1); kept for later cues with that stem too. */
  setLayer(layer: Layer, level: number, seconds = 2) {
    this.layerLevels[layer] = level;
    const g = this.layerGains.get(layer);
    if (!g || !this.ctx) return;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(level, t + seconds);
  }

  /** Whether the playing cue has this stem (so the story can lean on it). */
  hasLayer(layer: Layer) { return this.layerGains.has(layer); }

  /**
   * How present the score is, 0..1: at 1 it plays as mixed; lower, it recedes, darker and
   * softer, as if heard from further inside (works on any cue, stems or not).
   */
  setIntensity(k: number, seconds = 1.5) {
    k = THREE.MathUtils.clamp(k, 0, 1);
    if (Math.abs(k - this.intensity) < 0.01) return;
    this.intensity = k;
    this.applyIntensity(seconds);
  }

  private applyIntensity(seconds: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = this.intensity;
    this.scoreFilter.frequency.setTargetAtTime(700 * Math.pow(20000 / 700, k), t, Math.max(0.01, seconds / 3));
    this.scoreGain.gain.setTargetAtTime(0.55 + 0.45 * k, t, Math.max(0.01, seconds / 3));
  }

  private ranges = new WeakMap<AudioBuffer, [number, number]>();
  /** Start and end (s) of where a track is audible: within 40 dB of its loudest moment. */
  private audibleRange(buf: AudioBuffer): [number, number] {
    const hit = this.ranges.get(buf);
    if (hit) return hit;
    const d = buf.getChannelData(0), win = Math.round(buf.sampleRate * 0.1);
    const rms: number[] = [];
    for (let i = 0; i + win <= d.length; i += win) {
      let e = 0;
      for (let j = i; j < i + win; j++) e += d[j] * d[j];
      rms.push(Math.sqrt(e / win));
    }
    const floor = Math.max(...rms) * 0.01;
    const first = rms.findIndex((v) => v > floor);
    let last = rms.length - 1;
    while (last > first && rms[last] <= floor) last--;
    const r: [number, number] = [Math.max(0, first) * 0.1, (last + 1) * 0.1];
    this.ranges.set(buf, r);
    return r;
  }

  /** Whether a score cue is playing now. */
  get musicPlaying() { return this.music !== null; }

  /** How far into `cue` the music is (seconds), or null if that cue isn't what's playing. */
  musicTime(cue: keyof typeof MUSIC_CUES) {
    const m = this.music;
    return m && m.cue === cue && !m.ended() ? m.time() : null;
  }

  stopMusic(fade = 2) {
    if (!this.ctx || !this.music) return;
    this.music.stop(fade);
    this.music = null;
  }

  /** Three-note motif. Plays the ending score cue if present, else a synthesized stand-in. */
  async motif(warm = false) {
    if (await this.playMusic('end', 1)) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const notes = [440, 659.25, warm ? 587.33 : 554.37];
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.9;
      for (const [mult, amp] of [[1, 0.06], [2, 0.012], [3, 0.004]] as const) {
        const o = ctx.createOscillator(); o.frequency.value = f * mult;
        const g = this.env(t, amp, 0.04, 3.2);
        o.connect(g); g.connect(this.musicBus); g.connect(this.reverbSend);
        o.start(t); o.stop(t + 3.3);
      }
    });
  }

  // ── building blocks ────────────────────────────────────────────────────

  private plip(level: number, dest: AudioNode) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    const f = 1300 + Math.random() * 700;
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.38, t + 0.11);
    const g = this.env(t, 0.1 * level, 0.004, 0.2);
    o.connect(g).connect(dest); o.start(t); o.stop(t + 0.3);
  }

  private click(t: number, freq: number, level: number, dest: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.frequency.value = freq;
    const g = this.env(t, level, 0.001, 0.035);
    o.connect(g).connect(dest); o.start(t); o.stop(t + 0.06);
  }

  /** Gain node with an attack/decay envelope starting at t. */
  private env(t: number, peak: number, attack: number, decay: number) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private lfo(freq: number, depth: number, param: AudioParam) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = depth;
    o.connect(g).connect(param); o.start();
  }

  private loop(buf: AudioBuffer) {
    const s = this.ctx!.createBufferSource(); s.buffer = buf; s.loop = true; s.start();
    return s;
  }

  private oneShot(buf: AudioBuffer, dur: number) {
    const s = this.ctx!.createBufferSource(); s.buffer = buf;
    const t = this.ctx!.currentTime;
    // Long gusts can outlast the noise buffer: loop it instead of a negative offset.
    s.loop = dur + 0.1 > buf.duration;
    s.start(t, Math.random() * Math.max(0, buf.duration - dur - 0.1)); s.stop(t + dur);
    return s;
  }

  private panner(ref: number, rolloff: number) {
    const p = this.ctx!.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = rolloff; p.maxDistance = 60;
    return p;
  }

  private place(p: PannerNode, at: V3) {
    const t = this.ctx!.currentTime;
    if (p.positionX) {
      p.positionX.setTargetAtTime(at.x, t, 0.03); p.positionY.setTargetAtTime(at.y, t, 0.03); p.positionZ.setTargetAtTime(at.z, t, 0.03);
    } else p.setPosition(at.x, at.y, at.z);
  }

  private makeNoise(kind: 'white' | 'brown' | 'pink') {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 6;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12; }
    }
    return buf;
  }

  /** A soft, dark stereo tail for a wide open space. */
  private makeImpulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        const k = 0.35 + 0.6 * Math.exp(-t * 1.5); // darker as it decays
        lp = lp + (Math.random() * 2 - 1 - lp) * k;
        d[i] = lp * Math.exp(-t / decay) * (t < 0.012 ? t / 0.012 : 1);
      }
    }
    return buf;
  }
}
