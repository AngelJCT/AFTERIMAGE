import * as THREE from 'three/webgpu';
import type { Game } from '../main';
import { lensToFov } from '../core/lens';
import { strideFrequency } from '../player/animator';
import { SUN_DIR } from '../world/atmosphere';
import type { WeatherName } from '../world/weather';
import { MOTIONS, motionInput, type Motion } from './motionScenarios';
import { REFERENCES } from './referenceCatalog';
import './inspection.css';

type Mode = 'still' | Motion;
type View = 'front' | 'three-quarter' | 'side' | 'back' | 'portrait';

/** Repeatable studies of the shipped rig. Never start the story or write player progress. */
export function installInspection(g: Game) {
  const w = window as any, p = g.player;
  const params = new URLSearchParams(location.search);
  const requested = params.get('inspect') ?? 'still';
  let mode: Mode = Object.hasOwn(MOTIONS, requested) ? requested as Motion : 'still';
  let view: View = requested === 'portrait' ? 'portrait' : 'three-quarter';
  let playing = false, busy = false, elapsed = 0, frameIndex = 0, running = false;
  let weather: WeatherName = 'day';
  let refId = Object.hasOwn(REFERENCES, params.get('ref') ?? '') ? params.get('ref')! : 'artwork';
  let localUrl: string | null = null;
  const duration = () => mode === 'still' ? 6 : MOTIONS[mode].seconds;
  const shot = { position: new THREE.Vector3(), target: new THREE.Vector3(), lens: 55, range: 6, bokeh: 0, handheld: 0 };
  const shell = document.createElement('main');
  shell.id = 'inspection';
  shell.innerHTML = `
    <header><div><span class="study-kicker">AFTERIMAGE / CHARACTER STUDY</span><h1>Movement & reference</h1></div>
      <span class="study-note">Locked camera · fixed light · 60 Hz playback</span></header>
    <div class="study-tools">
      <label>Movement<select name="motion"><option value="still">Standing</option>${Object.entries(MOTIONS).map(([id, m]) => `<option value="${id}">${m.label}</option>`).join('')}</select></label>
      <label>Camera<select name="view"><option value="front">Front</option><option value="three-quarter">Three-quarter</option><option value="side">Side</option><option value="back">Back</option><option value="portrait">Portrait</option></select></label>
      <label>Light<select name="light"><option value="day">Film daylight</option><option value="late">Late afternoon</option><option value="rain">Overcast</option></select></label>
      <label class="study-clear"><input name="clear" type="checkbox">Clear foreground</label>
      <label>Reference<select name="reference">${Object.entries(REFERENCES).map(([id, r]) => `<option value="${id}">${r.label}</option>`).join('')}</select></label>
      <label class="study-file">Open image<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Open local reference image"></label>
      <label>Compare<select name="layout"><option value="split">Side by side</option><option value="overlay">Overlay</option><option value="solo">Game only</option></select></label>
    </div>
    <div class="study-align" hidden><label>Opacity<input name="opacity" type="range" min="0" max="1" step="0.01" value="0.5"></label><label>Scale<input name="scale" type="range" min="0.5" max="2" step="0.01" value="1"></label><label>Horizontal<input name="x" type="range" min="-50" max="50" step="0.1" value="0"></label><label>Vertical<input name="y" type="range" min="-50" max="50" step="0.1" value="0"></label><button data-act="align-reset">Reset alignment</button></div>
    <div class="study-views" data-layout="split"><figure class="study-game"><figcaption>IN GAME <span>Shipped model & materials</span></figcaption><div class="study-stage"></div></figure><figure class="study-reference"><figcaption>SOURCE <span class="study-source"></span></figcaption><div class="study-image"><img alt="Character reference artwork"></div></figure></div>
    <footer><div class="study-transport"><button data-act="play">Play</button><button data-act="reset">Restart</button><button data-act="back" aria-label="Previous frame">−1 frame</button><button data-act="step" aria-label="Next frame">+1 frame</button><label class="study-timeline">Time<input name="time" type="range" min="0" max="6" step="0.0166666667" value="0"></label><output class="study-time">0.00 s</output><button data-act="capture">Save comparison</button><button data-act="stride">Save stride</button><button data-act="copy">Copy view link</button></div><div class="study-bottom"><span class="study-status" role="status">Ready</span><span>Compare proportions, joint bends, foot contact and surface response.</span></div></footer>`;
  document.body.append(shell);
  document.body.classList.add('inspecting');
  for (const id of ['start', 'fade', 'loading', 'bars']) document.getElementById(id)!.style.display = 'none';
  const field = <T extends HTMLElement>(selector: string) => shell.querySelector<T>(selector)!;
  const select = (name: string) => field<HTMLSelectElement>(`[name="${name}"]`);
  const status = field<HTMLElement>('.study-status');
  const stage = field<HTMLDivElement>('.study-stage');
  const img = field<HTMLImageElement>('.study-image img');
  const timeline = field<HTMLInputElement>('[name=time]');
  const clutter = new Set(['grove', 'arches', 'landmarks', 'gate', 'rocks', 'debris', 'thorns', 'reeds', 'crossing', 'otherSide']);
  const scenery = g.scene.children.filter(o => clutter.has(o.name)).map(object => ({ object, visible: object.visible }));
  const clearForeground = () => {
    const clear = field<HTMLInputElement>('[name=clear]').checked;
    for (const item of scenery) item.object.visible = clear ? false : item.visible;
  };
  stage.append(g.renderer.domElement);
  p.blockers = []; p.interests = []; p.lookWeight = 0;
  g.guide.setGoal(null);
  g.guide.mode = 'off';
  g.holdRes = true;
  g.renderer.setPixelRatio(1);
  g.post.uGrain.value = 0;
  g.post.uAfter.value = 0;
  Object.defineProperty(g.input, 'running', { configurable: true, get: () => running });

  const frameCamera = () => {
    shot.lens = view === 'portrait' ? 85 : 55;
    const angle = { front: 0, 'three-quarter': 0.42, side: Math.PI / 2, back: Math.PI, portrait: 0.25 }[view];
    const yaw = mode === 'still' ? p.yaw : Math.PI;
    const fov = lensToFov(shot.lens, g.cam.camera.aspect) * THREE.MathUtils.DEG2RAD;
    // Fit the whole body even in a narrow split view; no clipped toes or hair.
    const height = view === 'portrait' ? 0.57 : 1.98;
    const width = view === 'portrait' ? 0.52 : mode === 'still' ? 0.85 : 1.6;
    const distance = Math.max(height, width / g.cam.camera.aspect) / (2 * Math.tan(fov / 2));
    shot.target.copy(p.position).add(new THREE.Vector3(0, view === 'portrait' ? 1.44 : 0.84, 0));
    shot.position.copy(shot.target).add(new THREE.Vector3(Math.sin(yaw + angle) * distance, 0.03, Math.cos(yaw + angle) * distance));
    g.cam.cutTo(shot, 0);
    g.input.look.x = g.input.look.y = g.input.zoom = 0;
    g.cam.update(0, g.input, p.position, false, p.yaw, p.pose.speed);
    g.post.uFocus.value = g.cam.focusDistance;
    g.post.uFocusRange.value = 6;
    g.post.uBokeh.value = 0;
    g.post.trackSun(g.cam.camera, SUN_DIR);
  };
  const draw = () => { frameCamera(); w.__render(); };
  const resize = () => {
    const { width, height } = stage.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    g.renderer.setSize(Math.round(width), Math.round(height), false);
    g.cam.resize(width / height);
    draw();
  };
  const updateTime = () => {
    timeline.value = String(elapsed);
    field<HTMLOutputElement>('.study-time').value = `${elapsed.toFixed(2)} s`;
  };
  const pause = () => { playing = false; w.__freeze(); field('[data-act=play]').textContent = 'Play'; };
  const reset = () => {
    pause(); elapsed = 0; frameIndex = 0; g.clock.time = 0;
    const start = mode === 'still' ? [0, 7] : MOTIONS[mode].start;
    p.place(new THREE.Vector3(start[0], 0, start[1]), mode === 'still' ? 0 : Math.PI);
    p.floorY = null; p.autopilot = null; p.controllable = mode !== 'still';
    Object.assign(p.pose, { phase: 0, speed: 0, kneel: 0, lie: 0, lean: 0, headPitch: 0, breath: 0 });
    p.reachWeight = p.leftReachWeight = p.eyelids = 0;
    // No random blink or residual hair spring should change a saved comparison.
    Object.assign(p, { nextBlink: Infinity, blinkT: -1 });
    (p as any).hair.set(0, 0, 0); (p as any).hairVel.set(0, 0, 0);
    g.input.move.x = g.input.move.y = g.input.look.x = g.input.look.y = g.input.zoom = 0;
    g.cam.yaw = 0;
    g.weather.set(weather, 0);
    g.skyEnv?.markDirty(true);
    g.skyEnv?.update(0);
    p.update(0, 0, g.input, 0);
    timeline.max = String(duration());
    field<HTMLButtonElement>('[data-act=stride]').disabled = mode !== 'walk' && mode !== 'run';
    updateTime(); draw();
  };
  g.onFrame(() => {
    const input = mode === 'still' ? { move: { x: 0, y: 0 }, running: false } : motionInput(mode, elapsed);
    Object.assign(g.input.move, input.move); running = input.running;
    // Camera motion and wheel zoom cannot change a study or write zoom to the saved game.
    g.input.look.x = g.input.look.y = g.input.zoom = 0;
    g.cam.yaw = 0;
    elapsed = Math.min(duration(), ++frameIndex / 60);
    frameCamera();
  });
  const advance = (frames = 1) => {
    const render = g.post.render;
    g.post.render = () => {};
    try { for (let i = 0; i < frames && elapsed < duration() - 1e-6; i++) w.__step(1); }
    finally { g.post.render = render; }
    updateTime(); draw();
  };
  const step = () => advance(1);
  const play = () => {
    if (elapsed >= duration() - 1e-6) reset();
    playing = true; field('[data-act=play]').textContent = 'Pause';
    let previous = performance.now(), accumulator = 0;
    g.renderer.setAnimationLoop(() => {
      const now = performance.now();
      accumulator += Math.min(0.05, (now - previous) / 1000); previous = now;
      while (accumulator >= 1 / 60 && playing) {
        step(); accumulator -= 1 / 60;
        if (elapsed >= duration() - 1e-6) pause();
      }
    });
  };
  const seek = async (seconds: number) => {
    if (busy) return;
    busy = true; reset();
    status.textContent = 'Positioning…';
    const frames = Math.round(THREE.MathUtils.clamp(seconds, 0, duration()) * 60);
    // Simulate every input/IK frame, but render only the final pose when scrubbing.
    const render = g.post.render;
    g.post.render = () => {};
    try {
      for (let i = 0; i < frames; i++) {
        w.__step(1);
        if (i % 60 === 59) await new Promise<void>(r => setTimeout(r, 0));
      }
    } finally { g.post.render = render; busy = false; updateTime(); draw(); status.textContent = `${mode} · ${view} · ${weather}`; }
  };
  const setReference = () => {
    if (localUrl) { URL.revokeObjectURL(localUrl); localUrl = null; }
    const ref = REFERENCES[refId as keyof typeof REFERENCES];
    img.src = `/__reference?id=${encodeURIComponent(refId)}`;
    img.alt = ref.label;
    field('.study-source').textContent = ref.label;
  };
  img.onerror = () => { status.textContent = 'Reference unavailable. Use Open image to choose a local file.'; };
  const alignment = () => {
    const value = (name: string) => Number(field<HTMLInputElement>(`[name=${name}]`).value);
    img.style.transform = `translate(${value('x')}%, ${value('y')}%) scale(${value('scale')})`;
    img.style.opacity = select('layout').value === 'overlay' ? String(value('opacity')) : '1';
  };
  const capture = async () => {
    if (busy) return;
    pause(); busy = true; status.textContent = 'Saving…';
    try {
      draw();
      const pending = g.captureFrame(1000, 0.94); w.__render();
      const url = await pending;
      if (!url) throw new Error('Could not capture the game frame');
      const gameImage = new Image(); gameImage.src = url; await gameImage.decode();
      const out = document.createElement('canvas'); out.width = 2000; out.height = 1260;
      const ctx = out.getContext('2d')!;
      ctx.fillStyle = '#171b1b'; ctx.fillRect(0, 0, out.width, out.height);
      const contain = (image: HTMLImageElement, x: number) => {
        const k = Math.min(960 / image.naturalWidth, 1120 / image.naturalHeight);
        const width = image.naturalWidth * k, height = image.naturalHeight * k;
        ctx.drawImage(image, x + (1000 - width) / 2, 80 + (1120 - height) / 2, width, height);
      };
      contain(gameImage, 0);
      if (img.complete && img.naturalWidth) contain(img, 1000);
      ctx.fillStyle = '#ebe7df'; ctx.font = '24px system-ui';
      ctx.fillText(`IN GAME / ${mode} / ${view}`, 28, 42);
      ctx.fillText(`SOURCE / ${img.alt}`, 1028, 42);
      ctx.font = '18px system-ui';
      ctx.fillText(`${elapsed.toFixed(3)} s · ${weather} · ${shot.lens} mm · ${g.q.tier} · source proportions preserved`, 28, 1232);
      const a = document.createElement('a');
      a.href = out.toDataURL('image/png'); a.download = `afterimage-${mode}-${view}-${elapsed.toFixed(2)}.png`; a.click();
      const name = `${params.get('label') ?? 'study'}-${mode}-${view}-${Math.round(elapsed * 60)}`;
      await w.__save(name, 1000);
      status.textContent = 'Comparison downloaded; clean game frame saved to .shots/';
    } catch (error) { status.textContent = String(error); }
    finally { busy = false; }
  };
  const captureStride = async () => {
    if (busy || mode !== 'walk' && mode !== 'run') return;
    await seek(2);
    busy = true;
    try {
      // Advance naturally to a heel strike: changing phase directly would invalidate IK contacts.
      const cycle = Math.floor(p.pose.phase / (2 * Math.PI));
      while (Math.floor(p.pose.phase / (2 * Math.PI)) === cycle && elapsed < duration()) advance();
      const frames = Math.max(8, Math.min(60, Math.round(Number(params.get('frames')) || 24)));
      const seconds = 1 / strideFrequency(p.pose.speed, p.pose.run), start = frameIndex;
      const prefix = `${params.get('label') ?? 'study'}-${mode}-cycle`;
      for (let i = 0; i < frames; i++) {
        advance(Math.max(0, start + Math.round(i * seconds * 60 / frames) - frameIndex));
        status.textContent = `Saving stride ${i + 1} / ${frames}…`;
        const result = await w.__save(`${prefix}-${String(i).padStart(2, '0')}`, 1000);
        if (result !== 'saved') throw new Error('Could not save the stride');
      }
      status.textContent = `Saved ${frames} stride frames to .shots/${prefix}-*.jpg`;
    } catch (error) { status.textContent = String(error); }
    finally { busy = false; }
  };
  shell.addEventListener('change', async (event) => {
    if (busy) return;
    const el = event.target as HTMLInputElement;
    if (el.name === 'motion') { mode = el.value as Mode; reset(); }
    if (el.name === 'view') { view = el.value as View; draw(); }
    if (el.name === 'clear') { clearForeground(); draw(); }
    if (el.name === 'light') { weather = el.value as WeatherName; await seek(elapsed); }
    if (el.name === 'reference') { refId = el.value; setReference(); }
    if (el.name === 'layout') {
      field('.study-views').setAttribute('data-layout', el.value);
      field<HTMLElement>('.study-align').hidden = el.value !== 'overlay'; alignment(); resize();
    }
    if (el.name === 'time') await seek(Number(el.value));
    if (el.type === 'file' && el.files?.[0]) {
      if (localUrl) URL.revokeObjectURL(localUrl);
      localUrl = URL.createObjectURL(el.files[0]); img.src = localUrl; img.alt = el.files[0].name;
      field('.study-source').textContent = img.alt;
      el.value = ''; // Selecting this same file again after a built-in reference must fire change.
    }
  });
  shell.addEventListener('input', event => {
    if (['opacity', 'scale', 'x', 'y'].includes((event.target as HTMLInputElement).name)) alignment();
  });
  shell.addEventListener('click', async event => {
    if (busy) return;
    const act = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-act]')?.dataset.act;
    if (act === 'play') playing ? pause() : play();
    if (act === 'reset') reset();
    if (act === 'step') { pause(); step(); }
    if (act === 'back') await seek(elapsed - 1 / 60);
    if (act === 'capture') await capture();
    if (act === 'stride') await captureStride();
    if (act === 'align-reset') {
      for (const [name, value] of Object.entries({ opacity: 0.5, scale: 1, x: 0, y: 0 })) field<HTMLInputElement>(`[name=${name}]`).value = String(value);
      alignment();
    }
    if (act === 'copy') {
      const url = new URL(location.href);
      for (const [key, value] of Object.entries({ inspect: mode, view, light: weather, ref: refId, at: elapsed.toFixed(3), q: g.q.tier, fixedres: '1' })) url.searchParams.set(key, value);
      url.searchParams.set('layout', select('layout').value);
      url.searchParams.set('clear', field<HTMLInputElement>('[name=clear]').checked ? '1' : '0');
      for (const name of ['opacity', 'scale', 'x', 'y']) url.searchParams.set(name, field<HTMLInputElement>(`[name=${name}]`).value);
      try { await navigator.clipboard.writeText(url.href); status.textContent = 'View link copied (local images must be reopened).'; }
      catch { status.textContent = url.href; }
    }
  });
  w.__inspection = { seek, reset, play, pause, capture, captureStride, advance, get time() { return elapsed; }, get mode() { return mode; } };
  if (['front', 'three-quarter', 'side', 'back', 'portrait'].includes(params.get('view') ?? '')) view = params.get('view') as View;
  if (['day', 'late', 'rain'].includes(params.get('light') ?? '')) weather = params.get('light') as WeatherName;
  select('motion').value = mode; select('view').value = view; select('light').value = weather; select('reference').value = refId;
  field<HTMLInputElement>('[name=clear]').checked = params.get('clear') === '1';
  clearForeground();
  const layout = params.get('layout');
  if (layout && ['split', 'overlay', 'solo'].includes(layout)) {
    select('layout').value = layout; field('.study-views').setAttribute('data-layout', layout);
    field<HTMLElement>('.study-align').hidden = layout !== 'overlay';
  }
  for (const name of ['opacity', 'scale', 'x', 'y']) {
    const value = params.get(name), input = field<HTMLInputElement>(`[name=${name}]`);
    if (value !== null && Number.isFinite(Number(value))) input.value = String(THREE.MathUtils.clamp(Number(value), Number(input.min), Number(input.max)));
  }
  alignment();
  setReference(); reset();
  new ResizeObserver(resize).observe(stage);
  addEventListener('resize', resize);
  resize();
  const at = Number(params.get('at'));
  if (Number.isFinite(at) && at > 0) void seek(at);
}
