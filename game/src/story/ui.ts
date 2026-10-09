import { Clock } from './clock';
import { progress } from './progress';
import { access } from '../core/access';

/** Subtitles, prompts and fades. All waits run on game time (see Clock). */
export class UI {
  private sub = document.getElementById('subtitle')!;
  private prompt = document.getElementById('prompt')!;
  private promptKey = this.prompt.querySelector('.key')!;
  private promptLabel = this.prompt.querySelector('.label')!;
  private fadeEl = document.getElementById('fade')!;
  private actBtn = document.getElementById('act-btn')!;
  private foundEl = document.getElementById('found')!;
  private shown = '';
  private foundTimer = 0;

  /** Whether a gamepad is in use (prompts then name its buttons). */
  padActive: () => boolean = () => false;

  /** The title set in the world (world/worldTitle.ts), when the world is there to hold it. */
  worldTitle: ((n: string, title: string) => Promise<void>) | null = null;

  constructor(private clock: Clock, private touch: boolean) {}

  /** Show a line for `hold` seconds, then fade it out. Resolves after the fade. */
  async say(text: string, hold = 3.2) {
    this.sub.textContent = text;
    this.sub.classList.add('show');
    await this.clock.sleep(hold);
    this.sub.classList.remove('show');
    await this.clock.sleep(1.0);
  }

  showPrompt(label: string, key = '', touchLabel?: string, button = false) {
    // Key hints fade away once a prompt has been seen a few times: the word is enough.
    if (this.shown !== label) {
      this.shown = label;
      this.prompt.classList.toggle('known', progress.promptSeen(label) >= 3);
    }
    // With held actions set to toggle, "hold" becomes a press (and a tap on touch).
    if (access.hold === 'toggle') {
      key = key.replace(/^(hold|release) /, 'press ');
      touchLabel = touchLabel?.replace(/^hold to /, 'tap to ');
    }
    if (this.padActive()) key = padKey(key);
    this.promptKey.textContent = key;
    this.promptLabel.textContent = this.touch && touchLabel ? touchLabel : label;
    // On touch, an action button replaces the text prompt.
    if (!(this.touch && button)) this.prompt.classList.add('show');
    if (button) {
      this.actBtn.textContent = label;
      this.actBtn.classList.add('show');
    }
  }

  hidePrompt() {
    this.shown = '';
    this.prompt.classList.remove('show');
    this.actBtn.classList.remove('show');
  }

  /**
   * Afterimages found: a row of small dots (the newest glowing) that fades in for a moment, then
   * away, with a quiet line under it (what the chapter asks, or what came back).
   */
  showFound(n: number, total: number, caption = '', seconds = 5) {
    this.foundEl.innerHTML = '';
    const dots = document.createElement('div');
    dots.className = 'dots';
    for (let i = 0; i < total; i++) {
      const d = document.createElement('i');
      if (i < n) d.className = i === n - 1 ? 'on new' : 'on';
      dots.append(d);
    }
    this.foundEl.append(dots);
    if (caption) {
      const c = document.createElement('div');
      c.className = 'caption';
      c.textContent = caption;
      this.foundEl.append(c);
    }
    this.foundEl.classList.add('show');
    clearTimeout(this.foundTimer);
    this.foundTimer = window.setTimeout(() => this.foundEl.classList.remove('show'), seconds * 1000);
  }

  /**
   * A chapter's goal, once, quietly at the top (the found row's caption, without dots). Not
   * narration: a few words of what to do, like a chapter subtitle.
   */
  objective(text: string, seconds = 6) {
    this.showFound(0, 0, text, seconds);
  }

  /**
   * A hint that teaches something once, ever (counted with the prompts): shown for `seconds`
   * unless something else takes the prompt first. Returns whether it showed.
   */
  hintOnce(key: string, label: string, keyLabel = '', touchLabel = label, seconds = 6) {
    if (progress.promptCount(key) > 0) return false;
    progress.promptSeen(key);
    this.showPrompt(label, keyLabel, touchLabel, false);
    void this.clock.sleep(seconds).then(() => { if (this.promptLabel.textContent === (this.touch ? touchLabel : label)) this.hidePrompt(); });
    return true;
  }

  /** Whether the screen is (nearly) covered by the fade. */
  get dark() {
    return Number(this.fadeEl.style.opacity || getComputedStyle(this.fadeEl).opacity) > 0.9;
  }

  /** Fade the screen to `to` opacity of black (or another colour, e.g. white light). */
  async fade(to: number, seconds = 2.4, colour = '#000') {
    this.fadeEl.style.background = access.flash(colour);
    this.fadeEl.style.transition = `opacity ${seconds}s ease`;
    this.fadeEl.style.opacity = String(to);
    await this.clock.sleep(seconds);
  }

  /**
   * A chapter's title as it begins (it doesn't hold anything up): set in the world when it can
   * be, else low and quiet over the picture. The text is always put in the live region too, so a
   * screen reader announces it either way.
   */
  async chapter(n: string, title: string) {
    const el = document.getElementById('chapter')!;
    el.querySelector('.n')!.textContent = n;
    el.querySelector('.t')!.textContent = title;
    if (this.worldTitle) return this.worldTitle(n, title);
    el.classList.add('show');
    await this.clock.sleep(5);
    el.classList.remove('show');
  }

  /** Title card over the fade (e.g. the end of Part I). */
  async card(title: string, sub: string, hold = 4) {
    const el = document.getElementById('card')!;
    el.innerHTML = '';
    const t = document.createElement('div'); t.className = 't'; t.textContent = title;
    const s = document.createElement('div'); s.className = 's'; s.textContent = sub;
    el.append(t, s);
    el.classList.add('show');
    await this.clock.sleep(hold);
    el.classList.remove('show');
    await this.clock.sleep(2);
  }
}

/** A keyboard prompt's keys, named for a gamepad. */
function padKey(key: string) {
  return key
    .replace(/\bWASD\b/, 'left stick')
    .replace(/W {2}· {2}A \/ D/, 'left stick')
    .replace(/← \/ A/, 'left stick ←')
    .replace(/^S$/, 'left stick ↓')
    .replace(/^W$/, 'left stick ↑')
    .replace(/\bE\b/, 'A');
}
