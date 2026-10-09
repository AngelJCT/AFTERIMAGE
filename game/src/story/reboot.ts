import type { Game } from '../main';
import { progress } from './progress';
import { ORDER } from './afterimages';
import { uPortGlow } from '../player/placeholder';

/**
 * A reboot between chapters: she powers down, and comes back. No words.
 *
 * Black, then her core as a cyan ring drawing itself, the hum rising. Around it, a socket for
 * each of the grove's afterimages. Holding E brings her back up: the ring fills, and one by one
 * the sockets answer. A memory she holds lights with its frame from the album and its note of
 * the motif. One she has spent flickers, cracks, and stays dark. One not yet found is only an
 * empty outline. Let go and the boot stalls, the ring trembling. When it completes, the ring
 * flares and her eyes open on the next chapter.
 *
 * Drawn on its own canvas over the game (under the fade and the prompt).
 */

interface Socket { id: string; found: boolean; spent: boolean; img: HTMLImageElement | null; at: number; lit: number; crack: number; flick: number; sounded: boolean }

const TAU = Math.PI * 2;
const HOLD = 6.5;      // seconds of holding to come back up

export async function reboot(g: Game) {
  const { clock, ui, audio, input, player } = g;
  const cv = document.createElement('canvas');
  cv.id = 'reboot';
  cv.setAttribute('aria-hidden', 'true');
  document.getElementById('fade')!.before(cv);
  const ctx = cv.getContext('2d')!;
  const dpr = Math.min(2, devicePixelRatio || 1);

  const found = progress.found, spent = progress.spent, album = progress.album;
  const sockets: Socket[] = ORDER.map((id, i) => {
    let img: HTMLImageElement | null = null;
    if (album[id]) { img = new Image(); img.src = album[id]; }
    return { id, found: found.includes(id), spent: spent.includes(id), img, at: (i + 0.8) / (ORDER.length + 0.8), lit: 0, crack: 0, flick: 0, sounded: false };
  });

  let ring = 0, boot = 0, tension = 0, flare = 0, t = 0;
  // Forgetting flakes: a spent memory, failing to light, sheds glassy slivers that rise and go.
  const flakes: { x: number; y: number; vx: number; vy: number; a: number; va: number; s: number; age: number; life: number }[] = [];
  const shed = (x: number, y: number, n: number, S: number) => {
    for (let k = 0; k < n; k++) {
      flakes.push({
        x: x + (Math.random() - 0.5) * S * 1.4, y: y + (Math.random() - 0.5) * S * 1.4,
        vx: (Math.random() - 0.5) * S * 0.25, vy: -S * (0.2 + Math.random() * 0.45),
        a: Math.random() * TAU, va: (Math.random() - 0.5) * 4, s: S * (0.05 + Math.random() * 0.08), age: 0, life: 1.6 + Math.random() * 1.8,
      });
    }
  };
  const alpha = 1;
  const hex = (x: number, y: number, r: number) => {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = TAU * k / 6 + Math.PI / 6;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  };
  const draw = (dt: number) => {
    t += dt;
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#050504';
    ctx.fillRect(0, 0, w, h);
    const cx = w * 0.5, cy = h * 0.47, R = Math.min(w, h) * 0.085;
    const shake = tension * 2.5 * dpr;
    const jx = (Math.random() - 0.5) * shake, jy = (Math.random() - 0.5) * shake;
    const trem = 1 - tension * 0.35 * (0.5 + 0.5 * Math.sin(t * 31));

    // Conduits from the core to each socket that has answered.
    const SR = R * 2.9, S = R * 0.62;
    sockets.forEach((s, i) => {
      const a = -Math.PI / 2 + TAU * i / sockets.length;
      const x = cx + Math.cos(a) * SR + jx, y = cy + Math.sin(a) * SR + jy;
      const on = s.found && !s.spent ? s.lit : s.spent ? s.flick * 0.5 : 0;
      if (on > 0.01) {
        ctx.strokeStyle = `rgba(79,216,255,${0.35 * on * trem})`;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R * 1.25, cy + Math.sin(a) * R * 1.25);
        ctx.lineTo(x - Math.cos(a) * S, y - Math.sin(a) * S);
        ctx.stroke();
      }
      // The socket: an outline, and what it holds.
      const seen = Math.min(1, ring * 1.4);
      hex(x, y, S);
      ctx.save();
      ctx.clip();
      if (s.found && s.img?.complete && s.img.naturalWidth) {
        const k = s.spent ? s.flick : s.lit;
        if (k > 0.01) {
          ctx.globalAlpha = alpha * k * trem;
          ctx.filter = s.spent ? 'grayscale(1) brightness(0.45)' : 'sepia(0.15)';
          const iw = s.img.naturalWidth, ih = s.img.naturalHeight, sc = (2 * S) / Math.min(iw, ih);
          ctx.drawImage(s.img, x - iw * sc / 2, y - ih * sc / 2, iw * sc, ih * sc);
          ctx.filter = 'none';
        }
      } else if (s.found) {
        ctx.fillStyle = `rgba(214,170,100,${0.25 * (s.spent ? s.flick : s.lit)})`;
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = alpha;
      const edge = s.found && !s.spent ? 0.18 + 0.6 * s.lit : s.spent ? 0.12 + 0.3 * s.flick : 0.1;
      ctx.strokeStyle = s.found && !s.spent && s.lit > 0.5 ? `rgba(239,222,190,${edge * seen})` : `rgba(239,232,216,${edge * seen})`;
      ctx.lineWidth = 1 * dpr;
      hex(x, y, S);
      ctx.stroke();
      // A spent one cracks across, and sheds.
      if (s.crack > 0 && s.crack < 1 && Math.random() < dt * 14) shed(x, y, 2, S);
      if (s.crack > 0) {
        ctx.strokeStyle = `rgba(170,220,255,${0.6 * s.crack})`;
        ctx.beginPath();
        ctx.moveTo(x - S * 0.8, y - S * 0.35); ctx.lineTo(x - S * 0.1, y + S * 0.05); ctx.lineTo(x + S * 0.25, y - S * 0.2); ctx.lineTo(x + S * 0.75, y + S * 0.45);
        ctx.moveTo(x - S * 0.1, y + S * 0.05); ctx.lineTo(x - S * 0.05, y + S * 0.8);
        ctx.stroke();
      }
    });

    for (const f of flakes) {
      f.age += dt;
      f.x += f.vx * dt; f.y += f.vy * dt; f.a += f.va * dt;
      f.vx += Math.sin(f.age * 2 + f.y * 0.01) * 4 * dpr * dt;
      const k = f.age / f.life, o = Math.min(1, f.age * 5) * (1 - k * k);
      ctx.save();
      ctx.translate(f.x, f.y); ctx.rotate(f.a); ctx.scale(1, 0.25 + 0.75 * Math.abs(Math.cos(f.a * 1.7)));
      ctx.fillStyle = `rgba(214,232,240,${0.55 * o})`;
      ctx.beginPath(); ctx.moveTo(-f.s, 0); ctx.lineTo(0, -f.s * 0.6); ctx.lineTo(f.s * 0.9, f.s * 0.1); ctx.lineTo(0, f.s * 0.5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    for (let k = flakes.length - 1; k >= 0; k--) if (flakes[k].age >= flakes[k].life) flakes.splice(k, 1);

    // The core: a ring that draws itself, filling as she comes back up.
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(79,216,255,0.9)';
    ctx.shadowBlur = (10 + 30 * flare) * dpr;
    ctx.strokeStyle = `rgba(79,216,255,${(0.25 + 0.35 * ring) * trem})`;
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(cx + jx, cy + jy, R, -Math.PI / 2, -Math.PI / 2 + TAU * ring); ctx.stroke();
    if (boot > 0) {
      ctx.strokeStyle = `rgba(160,236,255,${(0.7 + 0.3 * flare) * trem})`;
      ctx.lineWidth = (3 + 5 * flare) * dpr;
      ctx.beginPath(); ctx.arc(cx + jx, cy + jy, R, -Math.PI / 2, -Math.PI / 2 + TAU * boot); ctx.stroke();
    }
    const pulse = 0.5 + 0.5 * Math.sin(t * (2 + 6 * boot));
    ctx.fillStyle = `rgba(79,216,255,${(0.15 + 0.4 * boot * pulse + flare) * trem})`;
    ctx.beginPath(); ctx.arc(cx + jx, cy + jy, R * (0.22 + 0.1 * boot + 0.6 * flare), 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  };

  // From black (if the last chapter didn't end there, go there first).
  if (!ui.dark) await ui.fade(1, 1.2);
  player.controllable = false;
  player.eyelids = 1;
  uPortGlow.value = 0;
  audio.stopMusic(2);
  audio.duck(0.25, 2);
  const tick = g.onFrame((dt) => draw(dt));
  draw(0);
  await ui.fade(0, 1.2);

  // The ring draws itself; her hum comes up with it.
  audio.hum(0.4, 2.2);
  await clock.tween(2.4, (k) => (ring = k * k * (3 - 2 * k)));

  ui.showPrompt('wake', 'hold E', 'hold to wake', true);
  let hum = 0;
  const booting = g.onFrame((dt) => {
    if (input.actionHeld) {
      boot = Math.min(1, boot + dt / HOLD);
      tension = Math.max(0, tension - dt * 2);
      ui.hidePrompt();
      if ((hum -= dt) <= 0) { audio.hum(0.35 + 0.5 * boot, 0.7); hum = 0.7; }
    } else {
      tension = Math.min(1, tension + dt * 1.5);
      if (boot < 1) ui.showPrompt('wake', 'hold E', 'hold to wake', true);
    }
    uPortGlow.value = boot * 1.2;
    for (const [i, s] of sockets.entries()) {
      const reached = boot >= s.at;
      if (reached && !s.sounded) {
        s.sounded = true;
        if (s.found && !s.spent) audio.motifNote(i);
        else if (s.spent) audio.clang(0.12);
        else audio.portChime(0.15);
      }
      if (!reached) continue;
      if (s.found && !s.spent) s.lit = Math.min(1, s.lit + dt * 1.2);
      if (s.spent) {
        // It tries to light, fails, and cracks.
        s.flick = s.crack < 1 ? (Math.random() < 0.5 ? 0.9 : 0.1) : Math.max(0, s.flick - dt);
        s.crack = Math.min(1, s.crack + dt * 1.1);
      }
    }
  });
  await clock.until(() => boot >= 1);
  booting();
  ui.hidePrompt();
  input.release();

  // Up: the ring flares, and her eyes open.
  audio.portChime(1);
  audio.duck(1, 2.5);
  await clock.tween(0.9, (k) => (flare = Math.sin(k * Math.PI)));
  // To black; the chapter that follows opens on its place.
  await ui.fade(1, 1.4);
  tick();
  cv.remove();
  uPortGlow.value = 1;
  player.eyelids = 0;
}
