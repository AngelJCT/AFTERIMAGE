/**
 * A memory seen through fractures: the film's own footage, played inside a window of broken
 * crystal over the living game. The window is a Voronoi fracture of an irregular opening:
 * whole in the middle (fine crack lines only), loose shards at its rim that drift and tilt,
 * a few far fragments floating off, rims catching warm light. It cracks open from a point,
 * trembles when what holds it slips, and shatters outward when the memory ends.
 *
 * Drawn on its own 2D canvas above the game (below the fade, subtitles and prompts), so the
 * present stays visible around it.
 */

type Pt = [number, number];

interface Cell {
  poly: Pt[];          // in window-normalised space (unit = window radius), around the centre
  c: Pt;               // centroid
  kind: 'inner' | 'rim' | 'far';
  reveal: number;      // 0..1: when it appears while opening
  drift: Pt;           // outward direction
  spin: number;
  phase: number;
  off: number;         // resting offset (rim and far shards stand a little out)
}

const rand = (a: number, b: number, r: () => number) => a + (b - a) * r();

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clip a convex polygon to the half-plane (p - m)·n <= 0. */
function clip(poly: Pt[], m: Pt, n: Pt): Pt[] {
  const out: Pt[] = [];
  const side = (p: Pt) => (p[0] - m[0]) * n[0] + (p[1] - m[1]) * n[1];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const sa = side(a), sb = side(b);
    if (sa <= 0) out.push(a);
    if ((sa <= 0) !== (sb <= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export class MemoryFrame {
  readonly video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cells: Cell[] = [];
  /** 0 closed .. 1 fully open. */
  openness = 0;
  /** 0 .. 1: shattering outward (the end). */
  shatter = 0;
  /** 0 .. 1: strain — the window trembles and dims (what holds the memory is slipping). */
  tension = 0;
  /** Where the window sits on screen (fractions), and its radii (fractions of height). */
  centre: Pt = [0.665, 0.47];
  radius: Pt = [0.45, 0.42];
  private t = 0;
  private dpr = 1;
  /** Embers and grit coming off the broken rim (screen px, velocity, life). */
  private embers: { x: number; y: number; vx: number; vy: number; life: number; size: number }[] = [];

  constructor(seed = 7) {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.crossOrigin = 'anonymous';
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'memory';
    this.canvas.setAttribute('aria-hidden', 'true');
    const bars = document.getElementById('bars');
    (bars?.parentElement ?? document.body).insertBefore(this.canvas, bars?.nextSibling ?? null);
    this.ctx = this.canvas.getContext('2d')!;
    this.build(seed);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  async load(url: string) {
    if (this.video.src.endsWith(url)) return;
    this.video.src = url;
    await new Promise<void>((resolve) => {
      if (this.video.readyState >= 2) return resolve();
      const done = () => { this.video.removeEventListener('loadeddata', done); resolve(); };
      this.video.addEventListener('loadeddata', done);
      setTimeout(done, 8000);
    });
  }

  private resize() {
    this.dpr = Math.min(1.5, devicePixelRatio || 1);
    this.canvas.width = Math.round(innerWidth * this.dpr);
    this.canvas.height = Math.round(innerHeight * this.dpr);
  }

  /** The fracture: seeds in and around an irregular opening, cells by half-plane clipping. */
  private build(seed: number) {
    const r = mulberry(seed);
    const shape = (x: number, y: number) => {
      const a = Math.atan2(y, x);
      const k = 1 + 0.16 * Math.sin(a * 3 + 1.1) + 0.09 * Math.sin(a * 7 + 0.4) + 0.05 * Math.sin(a * 13 + 2.2);
      return Math.hypot(x, y) / k;
    };
    const seeds: Pt[] = [];
    for (let i = 0; i < 150 && seeds.length < 96; i++) {
      // Denser toward the rim: that's where it's broken.
      const a = r() * Math.PI * 2;
      const d = Math.pow(r(), 0.45) * 1.3;
      seeds.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
    const big: Pt[] = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
    seeds.forEach((s, i) => {
      const w = shape(s[0], s[1]);
      let kind: Cell['kind'];
      if (w < 0.78) kind = 'inner';
      else if (w < 0.98) kind = 'rim';
      else if (w < 1.3 && r() < 0.35) kind = 'far';
      else return;
      let poly = big;
      for (let j = 0; j < seeds.length && poly.length; j++) {
        if (j === i) continue;
        const o = seeds[j];
        const m: Pt = [(s[0] + o[0]) / 2, (s[1] + o[1]) / 2];
        poly = clip(poly, m, [o[0] - s[0], o[1] - s[1]]);
      }
      if (poly.length < 3) return;
      // Far fragments are small: shrink toward the seed.
      if (kind === 'far') poly = poly.map(([x, y]) => [s[0] + (x - s[0]) * 0.45, s[1] + (y - s[1]) * 0.45] as Pt);
      const c: Pt = [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];
      const dl = Math.hypot(c[0], c[1]) || 1;
      this.cells.push({
        poly, c, kind,
        reveal: Math.min(1, Math.hypot(c[0] - 0.15, c[1] + 0.05) / 1.4) * 0.75,
        drift: [c[0] / dl, c[1] / dl],
        spin: rand(-1, 1, r),
        phase: r() * Math.PI * 2,
        off: kind === 'inner' ? 0 : kind === 'rim' ? rand(0.015, 0.05, r) : rand(0.06, 0.16, r),
      });
    });
  }

  /** Draw one frame (call every game frame). */
  draw(dt: number) {
    this.t += dt;
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.openness <= 0.001 && this.shatter <= 0.001) { this.canvas.style.display = 'none'; return; }
    this.canvas.style.display = 'block';
    const W = canvas.width, H = canvas.height;
    const R = H * this.radius[1];                 // unit length (window radius in px)
    const sx = this.radius[0] / this.radius[1];   // horizontal stretch
    const cx = W * this.centre[0], cy = H * this.centre[1];
    const toPx = (p: Pt): Pt => [cx + p[0] * R * sx, cy + p[1] * R];
    // The footage covers the window's box, keeping its aspect.
    const v = this.video;
    const vw = v.videoWidth || 16, vh = v.videoHeight || 9;
    const boxW = 2.3 * R * sx, boxH = 2.3 * R;
    const scale = Math.max(boxW / vw, boxH / vh);
    const dw = vw * scale, dh = vh * scale;
    const dx = cx - dw / 2, dy = cy - dh / 2;
    const ready = v.readyState >= 2;
    const shake = this.tension * 3 * this.dpr;

    const order = this.cells;
    for (const cell of order) {
      const k = Math.min(1, Math.max(0, (this.openness - cell.reveal) / 0.25));
      if (k <= 0) continue;
      const e = k * k * (3 - 2 * k);
      const bob = cell.kind === 'inner' ? 0 : Math.sin(this.t * 0.6 + cell.phase) * 0.006;
      const out = cell.off + bob + this.shatter * this.shatter * (0.9 + cell.off * 4) + (1 - e) * 0.04;
      const ang = (cell.kind === 'inner' ? 0 : cell.spin * (0.03 + cell.off * 0.6)) + cell.spin * this.shatter * 1.2
        + (cell.kind === 'inner' ? 0 : Math.sin(this.t * 0.4 + cell.phase) * 0.01);
      const [px, py] = toPx(cell.c);
      const ox = cell.drift[0] * out * R * sx + (Math.random() - 0.5) * shake;
      const oy = cell.drift[1] * out * R + (Math.random() - 0.5) * shake;
      const alpha = e * (1 - this.shatter) * (cell.kind === 'far' ? 0.8 : 1);
      if (alpha <= 0.01) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(px + ox, py + oy);
      ctx.rotate(ang);
      ctx.translate(-px, -py);
      ctx.beginPath();
      cell.poly.forEach((p, i) => { const q = toPx(p); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.closePath();
      ctx.save();
      ctx.clip();
      if (ready) {
        // Only the part of the frame under this shard (the shards move with their piece).
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of cell.poly) { const q = toPx(p); x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
        x0 -= 2; y0 -= 2; x1 += 2; y1 += 2;
        const sx0 = Math.max(0, (x0 - dx) / scale), sy0 = Math.max(0, (y0 - dy) / scale);
        const sx1 = Math.min(vw, (x1 - dx) / scale), sy1 = Math.min(vh, (y1 - dy) / scale);
        if (sx1 > sx0 && sy1 > sy0) {
          ctx.drawImage(v, sx0, sy0, sx1 - sx0, sy1 - sy0, dx + sx0 * scale, dy + sy0 * scale, (sx1 - sx0) * scale, (sy1 - sy0) * scale);
        }
      } else {
        ctx.fillStyle = '#2a2620'; ctx.fill();
      }
      // Rim and far shards: a little darker toward their outer edge (depth), and strain dims all.
      const dim = (cell.kind === 'inner' ? 0 : cell.kind === 'rim' ? 0.12 : 0.28) + this.tension * 0.35;
      if (dim > 0) { ctx.fillStyle = `rgba(12,10,8,${dim})`; ctx.fill(); }
      ctx.restore();
      // Edges: fine cracks inside, lit rims outside.
      if (cell.kind === 'inner') {
        ctx.strokeStyle = 'rgba(245,232,210,0.16)';
        ctx.lineWidth = 0.8 * this.dpr;
        ctx.stroke();
      } else {
        // Crystal: a dark bevel, a warm lit edge with a soft glow, a faint cool prism line inside.
        ctx.strokeStyle = 'rgba(30,22,16,0.6)';
        ctx.lineWidth = 3.2 * this.dpr;
        ctx.stroke();
        ctx.save();
        ctx.shadowColor = 'rgba(255,184,110,0.95)';
        ctx.shadowBlur = 16 * this.dpr;
        ctx.strokeStyle = cell.kind === 'rim' ? 'rgba(255,226,186,0.8)' : 'rgba(255,214,168,0.65)';
        ctx.lineWidth = 1.3 * this.dpr;
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(176,222,255,0.28)';
        ctx.lineWidth = 2.4 * this.dpr;
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
      // Now and then an ember leaves a loose shard's edge.
      if (cell.kind !== 'inner' && Math.random() < dt * 2.2 * alpha && this.embers.length < 110) {
        const q = toPx(cell.poly[Math.floor(Math.random() * cell.poly.length)]);
        this.embers.push({
          x: q[0] + ox, y: q[1] + oy,
          vx: (cell.drift[0] * 18 + (Math.random() - 0.5) * 10) * this.dpr,
          vy: (cell.drift[1] * 10 - 14 - Math.random() * 10) * this.dpr,
          life: 1, size: (1.1 + Math.random() * 2.2) * this.dpr,
        });
      }
    }
    this.drawEmbers(dt, (1 - this.shatter) * Math.min(1, this.openness * 1.5));
  }

  private drawEmbers(dt: number, fade: number) {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of this.embers) {
      e.life -= dt * 0.45;
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.vy -= 4 * this.dpr * dt;
      const a = Math.max(0, e.life) * fade;
      ctx.fillStyle = `rgba(255,${170 + Math.floor(60 * e.life)},${110 + Math.floor(40 * e.life)},${0.7 * a})`;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.size * (0.6 + e.life * 0.6), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    this.embers = this.embers.filter((e) => e.life > 0);
  }
}
