import type { Game } from '../main';
import { MemoryFrame } from './memoryFrame';

/**
 * The first film inside the game (Part I): AFTERIMAGE's own shots, seen through a window of
 * broken crystal, while the game stages the same moment behind it. The narration is the film's,
 * word for word and in order, spoken at the film's own times (`public/video/part1_film.mp4` is
 * the film rebuilt frame for frame from the clean source clips in `clips/part1/`: no burned-in
 * subtitles, the full 16:9 frame).
 *
 * Shots (film seconds): 0 wide in the shallows · 10.1 her eye · 17.2 the hand and the water ·
 * 24.2 from above, lying curled · 31.2 profile, eyes closing · 38.3 the port · 44.3 standing,
 * her hands · 51.4 her reflection · 58.4 walking toward the light · 69.2 end.
 */
export const FILM1 = 'video/part1_film.mp4';
export const SHOT = { wide: 0, eye: 10.1, hand: 17.2, lying: 24.2, profile: 31.2, port: 38.3, standing: 44.3, reflection: 51.4, walk: 58.4, end: 69.2 } as const;

/** [film seconds, line, seconds on screen] */
const LINES: [number, string, number][] = [
  [3.4, 'when I woke my memories were gone', 3.0],
  [6.8, 'these are the first things I remember', 2.4],
  [9.7, 'a color I almost recognized', 2.4],
  [12.5, "a feeling I couldn't give a name", 2.3],
  [15.2, 'my hand reached for the water', 2.0],
  [17.6, 'it knew how to be gentle', 1.9],
  [19.6, 'I wondered who had taught it that', 2.2],
  [22.2, 'I keep coming back to this moment', 2.5],
  [25.1, 'this is where my memory begins', 1.7],
  [27.0, 'I lay still waiting for a name to return', 3.3],
  [31.5, 'I thought that if I waited long enough', 1.8],
  [33.4, 'someone would come and tell me who I was', 2.4],
  [36.6, 'I closed my eyes', 1.6],
  [38.6, 'somewhere inside the quiet', 1.9],
  [40.6, 'I could hear a faint hum', 1.5],
  [42.3, 'my body had survived', 1.8],
  [44.5, 'I was beginning to feel present inside it', 2.4],
  [47.1, 'nobody came looking I began to wonder', 2.0],
  [49.4, 'whether I could be someone without being remembered', 2.6],
  [52.4, 'in my reflection I saw someone lost', 2.6],
  [55.4, 'I wanted to be gentle with them too', 2.6],
  [58.4, "I still don't know who I was", 1.6],
  [60.1, 'but I remember the water', 2.0],
  [62.4, "and I want to know what I'll remember tomorrow", 3.6],
];

let window_: FilmWindow | null = null;

/** The one film window (created on first use). */
export function filmWindow(g: Game) {
  window_ ??= new FilmWindow(g);
  return window_;
}

export class FilmWindow {
  private mf = new MemoryFrame(13);
  private want = false;
  private retry = 0;
  private li = 0;
  private tick: (() => void) | null = null;
  /** Holding back: the film stalls, trembling, until it's released. */
  held = false;

  constructor(private g: Game) {}

  get time() { return this.mf.video.currentTime; }

  /** Open the window at film time `at` (it cracks open), placed at `centre` with `radius`. */
  async open(at: number, centre: [number, number] = [0.72, 0.42], radius: [number, number] = [0.35, 0.33]) {
    const { g, mf } = this;
    await mf.load(`${import.meta.env.BASE_URL}${FILM1}`);
    mf.centre = centre; mf.radius = radius;
    mf.video.pause();
    mf.video.currentTime = at;
    this.li = LINES.findIndex((l) => l[0] >= at - 0.05);
    if (this.li < 0) this.li = LINES.length;
    mf.shatter = 0; mf.tension = 0;
    this.tick ??= g.onFrame((dt) => {
      const v = mf.video;
      const run = this.want && !this.held;
      if (run && v.paused && !v.ended && (this.retry -= dt) <= 0) { this.retry = 0.5; void v.play().catch(() => {}); }
      if (!run && !v.paused) v.pause();
      mf.tension += ((this.held ? 1 : 0) - mf.tension) * (1 - Math.exp(-dt * 3));
      while (this.li < LINES.length && v.currentTime >= LINES[this.li][0]) {
        const [, text, hold] = LINES[this.li++];
        void g.ui.say(text, hold);
      }
      mf.draw(dt);
    });
    this.want = true;
    await g.clock.tween(1.2, (k) => (mf.openness = k));
  }

  /** Let the film run until film time `to` (it stalls while `held`). */
  async until(to: number) {
    await this.g.clock.until(() => this.time >= to - 0.02 || this.mf.video.ended);
  }

  /** Stop the film where it is (the window stays). */
  pause() { this.want = false; }
  resume() { this.want = true; }

  /** Close the window: it shatters outward, or just fades. */
  async close(shatter = true) {
    const { g, mf } = this;
    this.want = false;
    this.held = false;
    if (shatter) {
      g.audio.clang(0.15);
      await g.clock.tween(1.0, (k) => (mf.shatter = k));
    } else {
      await g.clock.tween(0.8, (k) => (mf.openness = 1 - k));
    }
    mf.openness = 0; mf.shatter = 0; mf.tension = 0;
    mf.draw(0);
  }
}
