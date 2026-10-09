// Unified input: keyboard + mouse on desktop, virtual stick + drag on touch, and a gamepad
// (standard mapping) anywhere: left stick moves, right stick looks, A acts, RT / L3 runs,
// LB / RB zoom, R3 recentres the view, Start pauses, Y is photo mode. In menus the d-pad (or
// left stick) moves between buttons, A presses, B goes back.
// Exposes intent, not devices: move vector, look delta, a "reach" axis, action press.

/** KeyboardEvent.code, falling back to .key for events that omit it. */
function codeOf(e: KeyboardEvent) {
  if (e.code) return e.code;
  const k = e.key;
  if (k.length === 1 && /[a-z]/i.test(k)) return `Key${k.toUpperCase()}`;
  if (k === ' ') return 'Space';
  if (k === 'Shift') return 'ShiftLeft';
  return k;
}

/** A key press and release, for the gamepad's shortcuts to the keyboard ones (pause, photo). */
function tap(code: string, key: string) {
  dispatchEvent(new KeyboardEvent('keydown', { code, key }));
  dispatchEvent(new KeyboardEvent('keyup', { code, key }));
}

export class Input {
  move = { x: 0, y: 0 };      // -1..1, y forward
  look = { x: 0, y: 0 };      // accumulated px since last frame
  reach = 0;                  // -1..1 per-frame vertical hand intent (drag / keys)
  zoom = 0;                   // accumulated zoom since last frame (+ out, - in; wheel px)
  recenter = false;           // edge: bring the view round behind her (R, R3)
  /** A gamepad was used last (for prompts that name buttons). */
  padActive = false;
  actionPressed = false;      // edge-triggered, cleared each frame
  anyPressed = false;         // edge-triggered for "press to continue"

  private keys = new Set<string>();
  private pad = { action: false, run: false, buttons: [] as boolean[], navCool: 0 };
  /** Accessibility: held actions toggle on one press and off the next instead. */
  toggleHold = false;
  private latched = false;
  private buttonHeld = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private reachDrag = 0;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private pinchId: number | null = null;
  private pinchAt = { x: 0, y: 0 };
  private pinchDist = 0;
  private stick = document.getElementById('stick')!;
  private knob = document.getElementById('stick-knob')!;

  constructor(private el: HTMLElement, readonly touch: boolean) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const code = codeOf(e);
      this.keys.add(code);
      if (code === 'KeyE' || code === 'Space' || code === 'Enter') { this.actionPressed = true; this.latched = !this.latched; }
      if (code === 'KeyR') this.recenter = true;
      if (e.isTrusted) this.padActive = false;
      this.anyPressed = true;
    });
    addEventListener('keyup', (e) => this.keys.delete(codeOf(e)));
    addEventListener('blur', () => { this.keys.clear(); this.latched = false; });

    if (touch) this.bindTouch();
    else this.bindMouse();
    // Zoom: the wheel (a trackpad pinch arrives as one too).
    this.el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom += e.deltaY * (e.deltaMode === 1 ? 16 : 1) * (e.ctrlKey ? 3 : 1);
    }, { passive: false });

    const btn = document.getElementById('act-btn')!;
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.actionPressed = true;
      this.latched = !this.latched;
      this.buttonHeld = true;
      btn.setPointerCapture(e.pointerId);
    });
    const release = () => (this.buttonHeld = false);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
  }

  private bindMouse() {
    this.el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.anyPressed = true;
      this.el.setPointerCapture(e.pointerId);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.look.x += dx;
      this.look.y += dy;
      this.reachDrag += dy;
    });
    const up = () => (this.dragging = false);
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
  }

  private bindTouch() {
    document.body.classList.add('touch');
    this.el.addEventListener('pointerdown', (e) => {
      this.anyPressed = true;
      this.el.setPointerCapture(e.pointerId);
      if (e.clientX < innerWidth * 0.45 && this.stickId === null) {
        this.stickId = e.pointerId;
        this.stickOrigin = { x: e.clientX, y: e.clientY };
        this.stick.style.left = `${e.clientX - 60}px`;
        this.stick.style.top = `${e.clientY - 60}px`;
        this.stick.style.bottom = 'auto';
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      } else if (this.pinchId === null) {
        // A second finger on the look side: pinch to zoom.
        this.pinchId = e.pointerId;
        this.pinchAt = { x: e.clientX, y: e.clientY };
        this.pinchDist = Math.hypot(e.clientX - this.lastX, e.clientY - this.lastY);
      }
    });
    this.el.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) {
        let dx = (e.clientX - this.stickOrigin.x) / 50;
        let dy = (e.clientY - this.stickOrigin.y) / 50;
        const len = Math.hypot(dx, dy);
        if (len > 1) { dx /= len; dy /= len; }
        this.move.x = dx;
        this.move.y = -dy;
        this.knob.style.transform = `translate(${dx * 37}px, ${dy * 37}px)`;
      } else if (e.pointerId === this.pinchId || (e.pointerId === this.lookId && this.pinchId !== null)) {
        if (e.pointerId === this.pinchId) this.pinchAt = { x: e.clientX, y: e.clientY };
        else { this.lastX = e.clientX; this.lastY = e.clientY; }
        const d = Math.hypot(this.pinchAt.x - this.lastX, this.pinchAt.y - this.lastY);
        this.zoom -= (d - this.pinchDist) * 2.5;
        this.pinchDist = d;
      } else if (e.pointerId === this.lookId) {
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.look.x += dx * 1.4;
        this.look.y += dy * 1.4;
        this.reachDrag += dy * 1.2;
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.stickId) {
        this.stickId = null;
        this.move.x = this.move.y = 0;
        this.knob.style.transform = '';
      }
      if (e.pointerId === this.lookId) this.lookId = null;
      if (e.pointerId === this.pinchId || this.lookId === null) this.pinchId = null;
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  /** Call once per frame before game logic. */
  poll(dt: number) {
    this.pollPad(dt);
    if (!this.touch || this.padActive) {
      const k = this.keys;
      this.move.x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      this.move.y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      if (this.padActive && !this.move.x && !this.move.y) { this.move.x = this.stickL.x; this.move.y = -this.stickL.y; }
      const len = Math.hypot(this.move.x, this.move.y);
      if (len > 1) { this.move.x /= len; this.move.y /= len; }
    }
    // Reach: dragging down lowers the hand. Keys give a slow, steady rate.
    const keyReach = (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0)
      - (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) + (this.padActive ? this.stickL.y : 0);
    this.reach = this.reachDrag / 700 + keyReach * dt * (this.running ? 0.6 : 0.07);
    this.reachDrag = 0;
    // Keys zoom at a steady rate.
    const zk = (this.keys.has('Equal') || this.keys.has('NumpadAdd') ? -1 : 0) + (this.keys.has('Minus') || this.keys.has('NumpadSubtract') ? 1 : 0);
    this.zoom += zk * dt * 900;
  }

  /** Interact held (E / Space / Enter, or the on-screen button). */
  get actionHeld() {
    if (this.toggleHold) return this.latched;
    const k = this.keys;
    return this.buttonHeld || this.pad.action || k.has('KeyE') || k.has('Space') || k.has('Enter');
  }

  private stickL = { x: 0, y: 0 };

  /** The first connected gamepad: sticks, buttons, and menu navigation. */
  private pollPad(dt: number) {
    const gp = Array.from(navigator.getGamepads?.() ?? []).find((g) => g && g.connected) ?? null;
    if (!gp) { this.pad.action = this.pad.run = false; this.stickL.x = this.stickL.y = 0; return; }
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    const lx = dz(gp.axes[0] ?? 0), ly = dz(gp.axes[1] ?? 0), rx = dz(gp.axes[2] ?? 0), ry = dz(gp.axes[3] ?? 0);
    const down = gp.buttons.map((b) => b.pressed || b.value > 0.5);
    const pressed = (i: number) => !!down[i] && !this.pad.buttons[i];
    if (lx || ly || rx || ry || down.some(Boolean)) this.padActive = true;
    const menuOpen = this.uiOpen();
    if (menuOpen) {
      this.padMenu(down, pressed, lx, ly, dt);
    } else {
      this.stickL.x = lx; this.stickL.y = ly;
      // The right stick, in mouse pixels per frame (about 2.4 rad/s across, 1.2 up and down).
      this.look.x += rx * Math.abs(rx) * 530 * dt;
      this.look.y += ry * Math.abs(ry) * 400 * dt;
      if (pressed(0)) { this.actionPressed = true; this.latched = !this.latched; }
      this.pad.action = !!down[0];
      this.pad.run = !!down[7] || !!down[10];
      this.zoom += ((down[4] ? 1 : 0) - (down[5] ? 1 : 0)) * dt * 900;
      if (pressed(11)) this.recenter = true;
      if (pressed(3)) tap('KeyC', 'c');
    }
    if (down.some((d, i) => d && !this.pad.buttons[i])) this.anyPressed = true;
    if (pressed(9)) tap('Escape', 'Escape');
    this.pad.buttons = down;
  }

  /** Whether a menu or the title screen has the controls (the d-pad moves between buttons). */
  private uiOpen() {
    const menu = document.getElementById('menu');
    const start = document.getElementById('start');
    return (!!menu && !menu.hidden) || (!!start && start.style.display !== 'none' && !document.body.classList.contains('playing'));
  }

  private padMenu(down: boolean[], pressed: (i: number) => boolean, lx: number, ly: number, dt: number) {
    this.pad.action = this.pad.run = false;
    this.stickL.x = this.stickL.y = 0;
    const menu = document.getElementById('menu')!;
    const scope = !menu.hidden ? menu : document.getElementById('start')!;
    const buttons = Array.from(scope.querySelectorAll<HTMLButtonElement>('button'))
      .filter((b) => !b.disabled && b.offsetParent !== null);
    if (!buttons.length) return;
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !buttons.includes(cur as HTMLButtonElement)) { buttons[0].focus(); return; }
    if (pressed(0)) { (cur as HTMLButtonElement).click(); return; }
    if (pressed(1) && !menu.hidden) { tap('Escape', 'Escape'); return; }
    // Direction: d-pad, or the left stick (repeating while held).
    let dx = (down[15] ? 1 : 0) - (down[14] ? 1 : 0), dy = (down[13] ? 1 : 0) - (down[12] ? 1 : 0);
    if (!dx && !dy && Math.hypot(lx, ly) > 0.6) { if (Math.abs(lx) > Math.abs(ly)) dx = Math.sign(lx); else dy = Math.sign(ly); }
    this.pad.navCool -= dt;
    if (!dx && !dy) { this.pad.navCool = 0; return; }
    if (this.pad.navCool > 0) return;
    this.pad.navCool = 0.22;
    // The nearest row (or column) in that direction, then the closest button within it.
    const r0 = cur.getBoundingClientRect(), c0 = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
    const cands = buttons.filter((b) => b !== cur).map((b) => {
      const r = b.getBoundingClientRect(), c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      return { b, along: (c.x - c0.x) * dx + (c.y - c0.y) * dy, across: Math.abs((c.x - c0.x) * dy) + Math.abs((c.y - c0.y) * dx) };
    }).filter((c) => c.along > 2 && (dy ? true : c.across < 12));
    if (!cands.length) return;
    const nearest = Math.min(...cands.map((c) => c.along));
    let best: HTMLButtonElement | null = null, bestScore = Infinity;
    for (const c of cands) if (c.along <= nearest + 10 && c.across < bestScore) { bestScore = c.across; best = c.b; }
    best?.focus();
  }

  /** Any movement or look input this frame (used by "stay still" beats). */
  get busy() {
    return Math.hypot(this.move.x, this.move.y) > 0.2 || Math.hypot(this.look.x, this.look.y) > 3;
  }

  get running() {
    return this.pad.run || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** Let go of a toggled hold (when the thing being held is over). */
  release() { this.latched = false; }

  endFrame() {
    this.look.x = this.look.y = 0;
    this.zoom = 0;
    this.recenter = false;
    this.actionPressed = false;
    this.anyPressed = false;
  }
}
