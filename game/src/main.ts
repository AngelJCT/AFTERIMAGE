import * as THREE from 'three/webgpu';
import { detectQuality, Quality } from './core/quality';
import { Input } from './core/input';
import { CameraRig } from './core/camera';
import { createPost } from './core/post';
import { Audio } from './core/audio';
import { access } from './core/access';
import { PhotoMode } from './core/photoMode';
import { createTerrain, createDepthTexture, heightAt, WATER_LEVEL, POOL, MIRROR, EXIT, SALT_FLAT, FALLEN, RUINS, OTHER_PATH, OTHER_ARCH, STILL_POOL } from './world/terrain';
import { Water } from './world/water';
import { createGrove, createRubble, groveSpots } from './world/grove';
import { loadGroveKit } from './world/groveKit';
import { loadRockKit } from './world/rockKit';
import { loadLandmarks } from './world/landmarks';
import { loadGate, type Gate } from './world/gate';
import { Guide, type GuideMode } from './world/guide';
import { LightPillar } from './world/lightPillar';
import { FoundMarks } from './world/foundMarks';
import { compass } from './story/compass';
import { Weather, WIND_DIR } from './world/weather';
import { createCrossing, type Crossing } from './world/crossing';
import { loadDebris } from './world/debris';
import { loadThorns } from './world/thorns';
import { createReeds, uReedGust } from './world/reeds';
import { chunkInstances } from './world/chunk';
import { createLandmarkShard } from './world/landmarkShard';
import { Flakes } from './world/flakes';
import { createShedding, type Shedding } from './world/shedding';
import { createInvertedWorld, INVERTED, WORLD_CENTRE } from './world/invertedWorld';
import { createClouds, cloudBanks } from './world/clouds';
import { createRing } from './world/ring';
import { MemoryPanes } from './world/memoryPanes';
import { installVistas } from './story/vistas';
import { startTitleScene } from './story/titleScene';
import { Echoes } from './world/echo';
import { WorldTitle } from './world/worldTitle';
import { createMirrorWorld, type MirrorWorld } from './world/mirrorWorld';
import { HERO_TREES } from './world/groveKit';
import { createSkyEnvironment, createAtmosphere, createDust, SUN_DIR } from './world/atmosphere';
import { createArches, loadArches, loadCanopy } from './world/arches';
import { Player } from './player/player';
import { runAmount } from './player/animator';
import { loadCharacter } from './player/character';
import { uCineKey, uKeyDir, uKeyCol, uCineRim, uRimDir, uRimCol } from './core/filmLight';
import { Clock } from './story/clock';
import { UI } from './story/ui';
import { runPartI } from './story/partI';
import { PLANNED, ORDER, SITES } from './story/afterimages';
import { progress, BEATS, type Beat } from './story/progress';
import { CHAPTERS } from './story/chapters';

type FrameFn = (dt: number, t: number) => void;
const FIXED_RES = new URLSearchParams(location.search).has('fixedres');
const _fl = { f: new THREE.Vector3(), r: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };

export class Game {
  q: Quality;
  renderer: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  input: Input;
  cam: CameraRig;
  post: ReturnType<typeof createPost>;
  audio = new Audio();
  clock = new Clock();
  ui: UI;
  water: Water;
  player!: Player;
  guide!: Guide;
  /** A pillar of light on where the story wants her next (world/lightPillar.ts). */
  pillar!: LightPillar;
  /** Crystal and remembering trees at each afterimage found (world/foundMarks.ts). */
  marks!: FoundMarks;
  /** Time of day and weather (world/weather.ts). */
  weather!: Weather;
  /** Chapter V's conduit and slabs (world/crossing.ts). */
  crossing: Crossing | null = null;
  /** Chapter VI's causeway, seen only in the water (world/mirrorWorld.ts). */
  mirrorWorld: MirrorWorld | null = null;
  /** Forgetting made visible: glassy flakes that peel away and rise (world/flakes.ts). */
  flakes!: Flakes;
  /** Crystal afterimages of her left at moments of feeling (world/echo.ts). */
  echoes!: Echoes;
  /** Chapter titles set in the world (world/worldTitle.ts). */
  title!: WorldTitle;
  /** The shard on the horizon and its rupture (world/landmarkShard.ts). */
  shard!: ReturnType<typeof createLandmarkShard>;
  /** The sky as the reflection environment (world/atmosphere.ts). */
  skyEnv: ReturnType<typeof createSkyEnvironment> | null = null;
  /** The ring on the horizon (world/ring.ts). */
  ring!: ReturnType<typeof createRing>;
  /** Her memories as panes of glass round the lift (world/memoryPanes.ts). */
  panes!: MemoryPanes;
  /** Her shed shell, in broken rings over the still pool (world/shedding.ts). */
  shedding!: Shedding;
  /** Afterimage trails the story asks for (0..1); running adds a little of its own. */
  afterimage = 0;
  /** The refuge gate (Part II); hidden until the grove's mist lifts toward it. */
  gate: Gate | null = null;
  atmos: ReturnType<typeof createAtmosphere>;
  paused = false;
  /** Photo mode holds the moment (core/photoMode.ts). */
  photo = false;
  photoMode!: PhotoMode;
  private frameFns = new Set<FrameFn>();
  private last = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    this.q = detectQuality();
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(this.q.pixelRatio);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.shadowMap.enabled = this.q.shadows > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.input = new Input(canvas, this.q.touch);
    this.cam = new CameraRig(innerWidth / innerHeight);
    this.ui = new UI(this.clock, this.q.touch);

    this.atmos = createAtmosphere(this.scene, this.q.shadows);
    this.scene.add(createTerrain(this.q.tier === 'high' ? 220 : 130));
    this.scene.add(createDust(this.q.dust));
    this.water = new Water(this.scene, createDepthTexture(), this.q.reflectionScale, SUN_DIR);

    this.post = createPost(this.renderer, this.scene, this.cam.camera, this.q, this.atmos.sun);

    addEventListener('resize', () => {
      this.renderer.setSize(innerWidth, innerHeight, false);
      this.cam.resize(innerWidth / innerHeight);
    });
  }

  /**
   * How far the story has gone, shown in the sky: the rupture behind the shard opens wider and
   * more of her echoes hang over the still pool with each chapter.
   */
  setStage(beat: Beat, now = false) {
    const k = Math.max(0, BEATS.indexOf(beat)) / (BEATS.length - 1);
    this.shard.setStage(0.12 + 0.88 * k, now);
    this.shedding.setFill(0.2 + 0.8 * k);
    this.ring.setStage(k, now);
    // Her memories hang round the lift from the gate on, as she holds them now.
    this.panes.group.visible = BEATS.indexOf(beat) >= BEATS.indexOf('gate');
    this.refreshPanes();
  }

  /** The memory panes, from what she has found, spent and kept a frame of. */
  refreshPanes() {
    const found = progress.found, spent = progress.spent, album = progress.album;
    this.panes.set(ORDER.map((id) => ({ id, found: found.includes(id), spent: spent.includes(id), img: album[id] })));
  }

  /**
   * Flood the frame with one colour for a moment (a peak): in over `rise` s, held, out slowly.
   * Cyan for what she spends, amber for what she keeps.
   */
  async flood(hex: number, hold = 2.2, rise = 0.9) {
    this.post.uFlood.value.setHex(hex);
    const k = this.post.uFloodK;
    // (Never quite all the way: a trace of the world's own colour stays.)
    await this.clock.tween(rise, (t) => (k.value = Math.max(k.value, 0.82 * t * t * (3 - 2 * t))));
    await this.clock.sleep(hold);
    const from = k.value;
    await this.clock.tween(2.4, (t) => (k.value = from * (1 - t * t * (3 - 2 * t))));
    k.value = 0;
  }

  /** Register a per-frame callback; returns an unsubscribe function. */
  onFrame(fn: FrameFn) {
    this.frameFns.add(fn);
    return () => this.frameFns.delete(fn);
  }

  /** Load everything, reporting 0..1. Each part falls back to its procedural stand-in. */
  async init(onProgress: (k: number) => void = () => {}) {
    // Weights of each stage in the progress bar.
    const W = { renderer: 0.05, character: 0.55, grove: 0.15, compile: 0.25 };
    let done = 0;
    const report = (stage: number, k: number) => onProgress(Math.min(1, done + stage * k));
    const finish = (stage: number) => { done += stage; onProgress(done); };

    await this.renderer.init();
    finish(W.renderer);

    // The rigged character, falling back to the procedural stand-in (?body=placeholder forces it).
    let body;
    if (new URLSearchParams(location.search).get('body') !== 'placeholder') {
      try {
        body = await loadCharacter(`${import.meta.env.BASE_URL}models/woman.glb`, (k) => report(W.character, k));
      } catch (err) {
        console.warn('character failed to load, using placeholder', err);
      }
    }
    finish(W.character);

    try {
      const grove = await loadGroveKit(`${import.meta.env.BASE_URL}models/grove.glb`, this.q.trees, (k) => report(W.grove, k), this.q.tier === 'high' ? 26 : 12);
      this.scene.add(grove);
      this.cam.obstacles = grove.userData.obstacles;
    } catch (err) {
      console.warn('grove kit failed to load, using procedural trees', err);
      this.scene.add(createGrove(Math.round(this.q.trees * 0.7)));
    }
    try {
      this.scene.add(await loadArches(`${import.meta.env.BASE_URL}models/arches.glb`));
    } catch (err) {
      console.warn('arcade failed to load, using procedural arches', err);
      this.scene.add(createArches());
    }
    let landmarks: Awaited<ReturnType<typeof loadLandmarks>> | null = null;
    let rockBlockers: { a: THREE.Vector2; b: THREE.Vector2; r: number }[] = [];
    let canopyBlockers: { a: THREE.Vector2; b: THREE.Vector2; r: number }[] = [];
    try {
      landmarks = await loadLandmarks(`${import.meta.env.BASE_URL}models/landmarks.glb`);
      this.scene.add(landmarks.group);
      this.cam.obstacles = [...this.cam.obstacles, ...landmarks.obstacles];
    } catch (err) {
      console.warn('landmarks failed to load', err);
    }
    try {
      this.gate = await loadGate(`${import.meta.env.BASE_URL}models/gate.glb`);
      this.gate.root.visible = progress.found.includes('mirror');
      this.scene.add(this.gate.root);
      this.cam.obstacles = [...this.cam.obstacles, ...this.gate.obstacles];
      canopyBlockers = (await loadCanopy(`${import.meta.env.BASE_URL}models/arches.glb`, this.gate.root)).blockers;
    } catch (err) {
      console.warn('gate failed to load', err);
    }
    try {
      const rocks = await loadRockKit(`${import.meta.env.BASE_URL}models/rocks.glb`, this.q.rubble);
      this.scene.add(rocks);
      rockBlockers = rocks.userData.blockers ?? [];
    } catch (err) {
      console.warn('rock kit failed to load, using procedural rubble', err);
      this.scene.add(createRubble(this.q.rubble));
    }
    try {
      this.scene.add(await loadDebris(`${import.meta.env.BASE_URL}models/debris.glb`, this.q.tier === 'high' ? 1100 : 500));
    } catch (err) {
      console.warn('debris failed to load', err);
    }
    try {
      const thorns = await loadThorns(`${import.meta.env.BASE_URL}models/thorns.glb`, this.q.tier === 'high' ? 1 : 0.5, groveSpots(this.q.trees).thickets);
      // On low, the thickets (the densest geometry in the grove) stay out of the shadow map.
      if (this.q.tier === 'low') thorns.traverse((o) => (o.castShadow = false));
      this.scene.add(thorns);
      this.cam.obstacles = [...this.cam.obstacles, ...groveSpots(this.q.trees).thickets];
    } catch (err) {
      console.warn('thorns failed to load', err);
    }
    // The shard on the horizon (world/landmarkShard.ts).
    const shard = createLandmarkShard(this.atmos);
    this.shard = shard;
    this.scene.add(shard.group);
    this.onFrame((dt) => shard.update(dt));
    this.ring = createRing(this.atmos, this.q.tier === 'high' ? 1400 : 600);
    this.scene.add(this.ring.group);
    this.onFrame((dt) => this.ring.update(dt));
    // The grove upside down in the sky, and cloud banks between the distances (one copy on low).
    {
      const grove = this.scene.getObjectByName('grove');
      const far: THREE.Object3D[] = [];
      grove?.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name.endsWith('_far')) far.push(o); });
      const sources = [...far, ...['arches', 'landmarks'].map((n) => this.scene.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o)];
      const copies = this.q.tier === 'high' ? INVERTED : INVERTED.slice(0, 1);
      this.scene.add(createInvertedWorld(sources, WORLD_CENTRE, copies, this.atmos));
      const decks = copies.map((c) => ({ at: new THREE.Vector3(WORLD_CENTRE.x + Math.sin(c.bearing) * c.dist, c.height + 4, WORLD_CENTRE.z - Math.cos(c.bearing) * c.dist), radius: 65 * c.scale }));
      this.scene.add(createClouds(cloudBanks(WORLD_CENTRE, decks, this.q.tier === 'high' ? 22 : 12), this.atmos));
    }
    this.scene.add(createReeds(this.q.tier === 'high' ? 900 : 350));
    // Every instanced kit spans the grove as one mesh: split them into ground cells, so the view,
    // the sun's shadow box and the reflection each draw only the cells they can see. (The far
    // silhouettes stay whole: they're always in view, and the inverted world copies them.)
    for (const name of ['grove', 'thorns', 'rocks', 'debris', 'reeds']) {
      const o = this.scene.getObjectByName(name);
      if (o) chunkInstances(o, 28, (m) => m.name.endsWith('_far'));
    }
    this.crossing = createCrossing();
    this.scene.add(this.crossing.group);
    try {
      await this.crossing.loadKit(`${import.meta.env.BASE_URL}models/crossing.glb`);
    } catch (err) {
      console.warn('crossing kit failed to load, using stand-ins', err);
    }
    this.cam.obstacles = [...this.cam.obstacles, ...this.crossing.camObstacles];
    this.mirrorWorld = createMirrorWorld(OTHER_PATH, OTHER_ARCH.clone().setY(heightAt(OTHER_ARCH.x, OTHER_ARCH.z)));
    this.mirrorWorld.group.visible = false;
    this.scene.add(this.mirrorWorld.group);
    finish(W.grove);
    this.player = new Player(this.scene, body);
    this.shedding = createShedding(STILL_POOL.clone().setY(heightAt(STILL_POOL.x, STILL_POOL.z)), this.q.tier === 'high' ? 90 : 45, this.atmos);
    this.scene.add(this.shedding.group);
    this.onFrame((dt) => this.shedding.update(dt));
    this.flakes = new Flakes(this.scene);
    this.echoes = new Echoes(this.scene, this.flakes);
    this.panes = new MemoryPanes(this.flakes);
    this.scene.add(this.panes.group);
    this.onFrame((dt) => this.panes.update(dt, this.cam.camera));
    this.title = new WorldTitle(this.scene, this.flakes);
    this.ui.padActive = () => this.input.padActive;
    installVistas(this);
    this.ui.worldTitle = (n, t) => this.title.show(n, t, () => {
      const cam = this.cam.camera, c = cam.position, her = this.player.position;
      // Half the view's width at her distance.
      const halfW = Math.hypot(c.x - her.x, c.z - her.z) * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect;
      return { her, yaw: Math.atan2(c.x - her.x, c.z - her.z), halfW, narrow: cam.aspect < 1.1 };
    });
    this.guide = new Guide(this.scene);
    this.pillar = new LightPillar(this.scene);
    this.skyEnv = createSkyEnvironment(this.renderer, this.scene);
    this.weather = new Weather(this);
    this.guide.mode = progress.guide as GuideMode;
    this.setStage(BEATS[0], true);
    // Out of the water's reflection: small clutter, and what hangs far up in the sky (one
    // reflection draw each saved; on low quality the thorns too).
    const NO_REFLECT = 7;
    const skip = ['debris', 'rocks', 'flakes', 'invertedWorld', 'dust', 'chapter-title', 'memoryPanes', ...(this.q.tier === 'low' ? ['thorns'] : [])];
    this.water.excludeFromReflection(this.cam.camera, this.atmos.sun.shadow.camera, NO_REFLECT,
      skip.map((n) => this.scene.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o));
    this.player.onFootstep = (x, z, speed) => {
      const wet = heightAt(x, z) < WATER_LEVEL;
      if (wet) this.water.addRipple(x, z, 0.0012 + speed * 0.0007);
      this.audio.footstep(wet, speed, { x, y: Math.max(heightAt(x, z), WATER_LEVEL), z });
    };
    // Where the grove's creaks come from, and where water laps.
    // The trees that stay creak; the thorn thickets are solid too (world/thorns.ts).
    const spots = groveSpots(this.q.trees);
    this.audio.creakSources = spots.trees;
    if (!this.cam.obstacles.length) this.cam.obstacles = this.audio.creakSources;
    this.audio.pools = [POOL, MIRROR, SALT_FLAT];
    // What she can't walk through: tree trunks (grove spots and the hero trees) and landmarks.
    const trunk = (x: number, z: number, r: number) => ({ a: new THREE.Vector2(x, z), b: new THREE.Vector2(x, z), r });
    this.player.blockers = [
      ...this.audio.creakSources.map((v) => trunk(v.x, v.y, 0.32)),
      ...spots.thickets.map((v) => trunk(v.x, v.y, 0.75)),
      ...HERO_TREES.map((h) => trunk(h.x, h.z, 0.4)),
      ...(landmarks?.blockers ?? []),
      ...(this.gate?.blockers() ?? []),
      ...canopyBlockers,
      ...rockBlockers,
      ...(this.crossing?.blockers ?? []),
    ];
    // Crystal and remembering trees where she has found afterimages (clear of what blocks her).
    this.marks = new FoundMarks(this.scene, SITES, this.scene.getObjectByName('grove'), () => progress.found, () => progress.spent, this.player.blockers);
    this.onFrame((dt) => this.marks.update(dt));
    // Her gaze drifts to the water and the way out (pools at eye-down height, the exit at head height).
    this.player.interests = [
      POOL.clone().setY(0), MIRROR.clone().setY(0), EXIT.clone().setY(1.6),
      SALT_FLAT.clone().setY(0.2), FALLEN.clone().setY(1.2), RUINS.clone().setY(2.2),
    ];

    // Compile every shader now (instead of hitching on the first frames), then warm the pipeline.
    this.player.update(0, 0, this.input, this.cam.yaw);
    this.cam.update(0, this.input, this.player.position, false);
    await this.renderer.compileAsync(this.scene, this.cam.camera);
    this.post.warm();
    finish(W.compile);
  }

  start() {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /**
   * The characters' film lighting (player/character.ts): in cutscene shots a soft key from just
   * above and beside the camera, and a fuller rim from the sun behind them; in play, a faint rim.
   */
  private filmLight() {
    const cine = this.cam.cinematic, cam = this.cam.camera;
    const f = cam.getWorldDirection(_fl.f), r = _fl.r.crossVectors(f, _fl.up).normalize();
    uKeyDir.value.copy(f).negate().addScaledVector(_fl.up, 0.55).addScaledVector(r, 0.4).normalize();
    const sun = this.atmos.sun, strength = Math.min(1.2, sun.intensity / 4.5);
    uKeyCol.value.setRGB(1, 0.95, 0.88).lerp(sun.color, 0.35);
    uCineKey.value = cine * 1.1;
    uRimDir.value.copy(SUN_DIR);
    uRimCol.value.copy(sun.color).multiplyScalar(strength);
    uCineRim.value = 0.25 + 0.95 * cine;
  }

  /** Thin 2:1 bars while a cinematic shot owns the frame (none on portrait screens). */
  private bars = 0;
  private letterbox(dt: number) {
    const want = this.cam.cinematic;
    this.bars += (want - this.bars) * (1 - Math.exp(-dt * (want > this.bars ? 2.5 : 1.8)));
    const w = innerWidth, h = innerHeight;
    const full = w > h ? Math.min(h * 0.075, Math.max(0, (h - w / 2) / 2)) : 0;
    const px = Math.round(full * this.bars);
    if (px !== this.barsPx) {
      this.barsPx = px;
      document.documentElement.style.setProperty('--bars', `${px}px`);
    }
  }
  private barsPx = -1;

  setPaused(p: boolean) {
    this.paused = p;
    if (this.audio.ctx) void (p ? this.audio.ctx.suspend() : this.audio.ctx.resume());
  }

  private frame(fixedDt?: number) {
    // The sun's shadow, once a frame: left to itself it renders again for every camera that
    // sees it (the water's reflection is a second), though it doesn't depend on the viewer.
    this.atmos.sun.shadow.needsUpdate = this.atmos.sun.castShadow;
    const now = performance.now();
    const dt = fixedDt ?? Math.min(0.05, (now - this.last) / 1000);
    this.adaptResolution(now - this.last);
    this.last = now;
    if (this.paused) {
      // (Input still polls: a gamepad moves through the pause menu.)
      this.input.poll(dt);
      this.post.render();
      this.input.endFrame();
      return;
    }
    // Photo mode: the moment holds; only the free camera moves.
    if (this.photo) {
      this.input.poll(dt);
      this.photoMode.update(dt);
      this.post.trackSun(this.cam.camera, SUN_DIR);
      this.filmLight();
      this.post.updateFragments(this.cam.camera, this.player.position, 0);
      this.post.render();
      for (const fn of this.afterRender.splice(0)) fn();
      this.input.endFrame();
      return;
    }
    const t = this.clock.time;

    this.input.poll(dt);
    this.clock.tick(dt);
    for (const fn of this.frameFns) fn(dt, t);

    this.player.update(dt, t, this.input, this.cam.yaw);
    this.cam.update(dt, this.input, this.player.position, this.player.controllable, this.player.yaw, this.player.pose.speed);
    this.letterbox(dt);
    this.guide.update(dt, t, this.player.position);
    this.pillar.update(dt, this.cam.camera, this.player.position, this.guide.target ?? this.guide.waypoint ?? compass.target, this.guide.mode, this.player.controllable);
    {
      // Only the story asks for trails now (running no longer smears the picture).
      const want = this.afterimage;
      this.post.uFx.value = access.fxScale;
      const u = this.post.uAfter;
      u.value += (want - u.value) * (1 - Math.exp(-dt * (want > u.value ? 3 : 1.5)));
    }
    this.water.update(t);
    this.skyEnv?.update(dt);
    this.water.uGust.value += (this.audio.gustLevel - this.water.uGust.value) * Math.min(1, dt * 3);
    uReedGust.value = this.water.uGust.value * Math.min(2, this.audio.windLevel);
    // Her hair takes the same wind: a steady breath of it, much more in a gust.
    this.player.wind.copy(WIND_DIR).multiplyScalar(Math.min(2, this.audio.windLevel) * (0.3 + this.water.uGust.value * 1.4));
    this.atmos.follow(this.player.position);
    this.post.uFocus.value = this.cam.focusDistance;
    this.post.uFocusRange.value = this.cam.focusRange;
    this.post.uBokeh.value = this.q.dof ? this.cam.bokeh : 0;
    this.post.trackSun(this.cam.camera, SUN_DIR);
    this.filmLight();
    this.post.updateFragments(this.cam.camera, this.player.position, dt);
    this.flakes.update(dt, this.cam.camera, this.player.position, 0.6 + this.water.uGust.value);
    this.echoes.update(dt);
    this.title.update(dt);
    this.audio.update(dt, this.cam.camera, this.player.position, this.player.portWorld().pos);
    {
      // Movement sound: pace, water over her feet (none on chapter VI's causeway), turning, kneeling/rising.
      const pp = this.player.position, pose = this.player.pose;
      const poseNow = pose.kneel + pose.lie;
      this.audio.movement(pose.speed, WATER_LEVEL - pp.y, pose.turn ?? 0, (poseNow - this.lastPose) / Math.max(dt, 1e-3));
      this.lastPose = poseNow;
      // The ring's drone, as she faces it.
      const fwd = this.cam.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
      const toRing = this.ring.group.position.clone().sub(pp).setY(0).normalize();
      this.audio.setRing(THREE.MathUtils.smoothstep(fwd.dot(toRing), 0.6, 0.95) * this.ring.arc);
    }

    this.post.render();
    for (const fn of this.afterRender.splice(0)) fn();
    this.input.endFrame();
  }

  /**
   * Resolution follows the frame rate: when frames run long for a couple of seconds the render
   * scale steps down, and steps back up (to the quality's own ceiling) once there is room again.
   * Only from real animation frames, in play (not paused, hidden or in photo mode); `?fixedres`
   * turns it off.
   */
  private res = { acc: 0, n: 0, cool: 3, scale: -1 };
  /** Keep the render size as set (the trailer tool renders at a fixed size). */
  holdRes = false;
  private adaptResolution(ms: number) {
    const r = this.res;
    if (r.scale < 0) r.scale = this.q.pixelRatio;
    if (this.paused || this.photo || document.hidden || ms > 250 || FIXED_RES || this.holdRes) { r.acc = r.n = 0; return; }
    r.acc += ms; r.n++;
    r.cool -= ms / 1000;
    if (r.acc < 2000 || r.cool > 0) return;
    const avg = r.acc / r.n;
    r.acc = r.n = 0;
    const max = this.q.maxPixelRatio, min = Math.max(0.6, this.q.pixelRatio * 0.5);
    let next = r.scale;
    if (avg > 1000 / 42) next = Math.max(min, r.scale - 0.15);
    else if (avg < 1000 / 57) next = Math.min(max, r.scale + 0.15);
    if (next === r.scale) return;
    // Down again soon if it's still slow; up only after a longer settle.
    r.cool = next < r.scale ? 2 : 6;
    r.scale = next;
    this.renderer.setPixelRatio(next);
    this.renderer.setSize(innerWidth, innerHeight, false);
  }

  private lastPose = 0;
  private afterRender: (() => void)[] = [];
  /**
   * A small JPEG of the next frame (for the album), or null if it can't be read. The frame is
   * rendered once more into an offscreen target and read back, which works whether or not
   * the page is being presented.
   */
  /** `overlay` draws over the frame; if it returns a canvas, that is encoded instead (a crop). */
  captureFrame(width = 320, quality = 0.8, overlay?: (ctx: CanvasRenderingContext2D, w: number, h: number) => HTMLCanvasElement | void): Promise<string | null> {
    return new Promise((resolve) => {
      // Just after the frame (reading back from inside the frame never resolves).
      this.afterRender.push(() => setTimeout(() => {
        const src = this.renderer.domElement;
        const w = width, h = Math.round(width * src.height / src.width);
        const rt = new THREE.RenderTarget(w, h);
        try {
          this.renderer.setRenderTarget(rt);
          this.post.render();
        } finally {
          this.renderer.setRenderTarget(null);
        }
        this.renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h).then((px) => {
          try {
            // Rows come padded to 256 bytes on WebGPU.
            const src8 = px as Uint8Array;
            const stride = src8.length >= w * h * 4 + 1 ? Math.ceil((w * 4) / 256) * 256 : w * 4;
            const img = new ImageData(w, h);
            for (let y = 0; y < h; y++) img.data.set(src8.subarray(y * stride, y * stride + w * 4), y * w * 4);
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const ctx = c.getContext('2d')!;
            ctx.putImageData(img, 0, 0);
            const out = overlay?.(ctx, w, h) ?? c;
            resolve(out.toDataURL('image/jpeg', quality));
          } catch {
            resolve(null);
          }
          rt.dispose();
        }, () => { rt.dispose(); resolve(null); });
      }, 0));
    });
  }
}

async function boot() {
  // Production: cache the heavy files for return visits (public/sw.js).
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* optional */ });
  }
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const startEl = document.getElementById('start')!;
  let game: Game;
  const loading = document.getElementById('loading')!;
  const bar = loading.querySelector('i')!;
  const setProgress = (k: number) => {
    bar.style.width = `${Math.round(k * 100)}%`;
    loading.setAttribute('aria-valuenow', String(Math.round(k * 100)));
  };
  try {
    game = new Game(canvas);
    await game.init(setProgress);
  } catch (err) {
    console.error(err);
    document.getElementById('fallback')!.hidden = false;
    return;
  }
  game.start();
  game.photoMode = new PhotoMode(game);
  (window as any).game = game; // debugging handle
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('trailer')) {
    const debug = await import('./debug');
    debug.installDebug(game);
    (await import('./trailer')).installTrailer(game);
    return;
  }
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('inspect')) {
    const debug = await import('./debug');
    debug.installDebug(game);
    debug.installInspection(game);
    return;
  }
  if (import.meta.env.DEV) void import('./debug').then((m) => m.installDebug(game));
  setupMenu(game);
  setProgress(1);
  loading.classList.add('done');
  setTimeout(() => {
    loading.hidden = true;
    (startEl.querySelector('.buttons') as HTMLElement).hidden = false;
  }, 700);

  const params = new URLSearchParams(location.search);
  const devBeat = params.get('beat') as Beat | null;
  const saved = progress.checkpoint;
  const cont = document.getElementById('continue-btn')!;
  cont.hidden = !saved || saved === 'coldOpen' || progress.completed;

  // The title over the living world (unless play goes straight in).
  let title: ReturnType<typeof startTitleScene> | null = null;
  const begin = async (from: Beat) => {
    // From the living title: down to black first (the story opens from black).
    if (title) {
      startEl.classList.add('gone');
      await game.ui.fade(1, 0.9);
    }
    title?.stop();
    title = null;
    startEl.classList.add('gone');
    document.body.classList.add('playing');
    game.audio.start();
    void runPartI(game, from);
  };
  if (devBeat && (BEATS as readonly string[]).includes(devBeat)) return void begin(devBeat);
  // Dev: `?beat=credits` plays the end credits alone, by the far shore of the still pool.
  if (import.meta.env.DEV && params.get('beat') === 'credits') {
    startEl.classList.add('gone');
    document.body.classList.add('playing');
    game.audio.start();
    game.weather.set('dusk', 0);
    const at = OTHER_ARCH.clone().setY(heightAt(OTHER_ARCH.x, OTHER_ARCH.z));
    game.player.place(at, Math.atan2(STILL_POOL.x - at.x, STILL_POOL.z - at.z));
    void import('./story/credits').then(async (m) => { await m.runCredits(game); location.href = location.pathname; });
    return;
  }
  if (progress.takeAutoContinue() && saved) return void begin(saved);
  title = startTitleScene(game);
  startEl.classList.add('live');
  void game.ui.fade(0, 2.5);
  document.getElementById('begin-btn')!.addEventListener('click', () => {
    progress.clear();
    begin('coldOpen');
  }, { once: true });
  cont.addEventListener('click', () => begin(saved ?? 'coldOpen'), { once: true });

  // Chapter select: every chapter reached so far (the rest shown, dimmed, still to come).
  const chaptersBtn = document.getElementById('chapters-btn')!;
  const list = document.getElementById('chapters')!;
  const buttons = startEl.querySelector('.buttons') as HTMLElement;
  const reached = progress.reached;
  chaptersBtn.hidden = reached < BEATS.indexOf('grove');
  chaptersBtn.addEventListener('click', () => {
    list.innerHTML = '';
    for (const c of CHAPTERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span class="n">${c.n}</span><span>${c.title}</span>`;
      b.disabled = BEATS.indexOf(c.beat) > reached;
      b.addEventListener('click', () => { progress.startChapter(c.beat, ORDER); begin(c.beat); }, { once: true });
      list.append(b);
    }
    const back = document.createElement('button');
    back.type = 'button'; back.className = 'back'; back.textContent = 'back';
    back.addEventListener('click', () => { list.hidden = true; buttons.hidden = false; });
    list.append(back);
    buttons.hidden = true;
    list.hidden = false;
    (list.querySelector('button:not(:disabled)') as HTMLButtonElement | null)?.focus();
  });
}

function setupMenu(game: Game) {
  const menu = document.getElementById('menu')!;
  const applySub = () => {
    document.body.classList.remove('sub-s', 'sub-m', 'sub-l');
    document.body.classList.add(`sub-${progress.subtitle}`);
    menu.querySelectorAll<HTMLButtonElement>('[data-sub]').forEach((b) => b.classList.toggle('on', b.dataset.sub === progress.subtitle));
  };
  // Accessibility (core/access.ts): menu buttons, the subtitle band, and held actions.
  access.onChange(() => {
    menu.querySelectorAll<HTMLButtonElement>('[data-access]').forEach((b) => {
      const [k, v] = b.dataset.access!.split(':');
      b.classList.toggle('on', access.get(k as 'shake') === v);
    });
    document.body.classList.toggle('sub-bg', access.backing === 'on');
    game.input.toggleHold = access.hold === 'toggle';
    if (!game.input.toggleHold) game.input.release();
  });
  const applyGuide = () => menu.querySelectorAll<HTMLButtonElement>('[data-guide]').forEach((b) => b.classList.toggle('on', b.dataset.guide === progress.guide));
  applyGuide();
  // Pause button: shown while the pointer moves, then it fades out of the picture.
  let awake = 0;
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    document.body.classList.add('pointer-awake');
    clearTimeout(awake);
    awake = window.setTimeout(() => document.body.classList.remove('pointer-awake'), 2500);
  });
  const q = new URLSearchParams(location.search).get('q') ?? 'auto';
  menu.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) => b.classList.toggle('on', b.dataset.q === q));
  applySub();

  const open = (v: boolean) => {
    if (!document.body.classList.contains('playing') || game.photo) return;
    menu.hidden = !v;
    game.setPaused(v);
    if (v) fillAlbum();
    else document.getElementById('menu-chapters')!.hidden = true;
  };
  // Afterimages found so far: one frame each, and empty frames for those still waiting.
  const album = document.getElementById('album')!;
  const fillAlbum = () => {
    const found = progress.found, frames = progress.album;
    album.hidden = found.length === 0;
    album.querySelector('.frames')!.innerHTML = '';
    for (let i = 0; i < PLANNED; i++) {
      const cell = document.createElement('div');
      cell.className = 'frame';
      const id = found[i];
      // Spent as power: the frame is still there, drained and cracked.
      if (id && progress.spent.includes(id)) cell.classList.add('spent');
      if (id && frames[id]) {
        const img = document.createElement('img'); img.src = frames[id]; img.alt = '';
        cell.append(img);
      } else if (id) {
        cell.classList.add('lit');
      }
      album.querySelector('.frames')!.append(cell);
    }
  };
  // Chapters reached so far: jump to one (reloads into it; dev `?beat=` params are dropped).
  const chapterList = document.getElementById('menu-chapters')!;
  const fillChapters = () => {
    if (!chapterList.hidden) { chapterList.hidden = true; return; }
    chapterList.innerHTML = '';
    for (const c of CHAPTERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span class="n">${c.n}</span><span>${c.title}</span>`;
      b.disabled = BEATS.indexOf(c.beat) > progress.reached;
      b.addEventListener('click', () => {
        progress.startChapter(c.beat, ORDER);
        progress.armAutoContinue();
        const url = new URL(location.href);
        url.searchParams.delete('beat'); url.searchParams.delete('at');
        location.href = url.toString();
      });
      chapterList.append(b);
    }
    chapterList.hidden = false;
  };
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') open(menu.hasAttribute('hidden'));
  });
  document.getElementById('pause-btn')!.addEventListener('click', () => open(true));
  menu.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.access) { const [k, v] = b.dataset.access.split(':'); access.set(k as 'shake', v); }
    if (b.dataset.sub) { progress.subtitle = b.dataset.sub as 's' | 'm' | 'l'; applySub(); }
    if (b.dataset.guide) { progress.guide = b.dataset.guide as GuideMode; game.guide.mode = progress.guide; applyGuide(); }
    if (b.dataset.q) {
      const url = new URL(location.href);
      if (b.dataset.q === 'auto') url.searchParams.delete('q'); else url.searchParams.set('q', b.dataset.q);
      progress.armAutoContinue();
      location.href = url.toString();
    }
    switch (b.dataset.act) {
      case 'resume': open(false); break;
      case 'photo': open(false); game.photoMode.enter(); break;
      case 'checkpoint': progress.reloadIntoCheckpoint(); break;
      case 'chapters': fillChapters(); break;
      case 'reset': progress.clear(); location.href = location.pathname; break;
    }
  });
}

void boot();
