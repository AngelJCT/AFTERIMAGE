/**
 * Checkpoints and player settings, kept in localStorage (per browser, best-effort:
 * everything still works if storage is unavailable).
 */
/** Part I (the film) is the prologue; `grove` is the open chapter of afterimages after it. */
export const BEATS = ['coldOpen', 'lying', 'eyesClosed', 'rise', 'explore', 'reflection', 'ending', 'grove', 'gate', 'memory', 'trace', 'search', 'crossing', 'mirror'] as const;
export type Beat = (typeof BEATS)[number];

const KEY = 'afterimage.v1';
const AUTO = 'afterimage.autocontinue';

interface Saved {
  beat?: Beat;
  complete?: boolean;
  subtitle?: 's' | 'm' | 'l';
  /** Afterimages found, in the order she found them. */
  found?: string[];
  /** Afterimages she has since spent as power (their frames fade; their warmth is gone). */
  spent?: string[];
  guide?: 'subtle' | 'always' | 'off';
  /** How many times each prompt has been shown (key hints fade after a few). */
  prompts?: Record<string, number>;
  /** The furthest beat ever reached (chapter select unlocks up to it). */
  reached?: number;
  /** Accessibility and comfort settings (see core/access.ts). */
  access?: Record<string, string>;
}
const ALBUM = 'afterimage.album';

function read(): Saved {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function write(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: progress simply isn't kept */
  }
}

export const progress = {
  get checkpoint(): Beat | null {
    const b = read().beat;
    return b && (BEATS as readonly string[]).includes(b) ? b : null;
  },
  save(beat: Beat) {
    const s = read();
    write({ ...s, beat, reached: Math.max(s.reached ?? 0, BEATS.indexOf(beat)) });
  },
  /**
   * Start at a chapter (chapter select): the checkpoint moves there and the memories are set as
   * they would be on arriving: none before the grove, all of `order` after it, and the first
   * spent once the search is behind her. How far she has ever reached is kept.
   */
  startChapter(beat: Beat, order: readonly string[]) {
    const s = read(), i = BEATS.indexOf(beat);
    const found = i <= BEATS.indexOf('grove') ? [] : [...order];
    const spent = i > BEATS.indexOf('search') ? [order[0]] : [];
    write({ ...s, beat, found, spent, complete: false });
  },
  /** Index (in BEATS) of the furthest beat ever reached; kept across "start over". */
  get reached() {
    return read().reached ?? 0;
  },
  complete() {
    write({ ...read(), complete: true });
  },
  get completed() {
    return !!read().complete;
  },
  clear() {
    const s = read();
    write({ subtitle: s.subtitle, guide: s.guide, reached: s.reached, access: s.access });
    try { localStorage.removeItem(ALBUM); } catch { /* ignore */ }
  },
  get found(): string[] {
    return read().found ?? [];
  },
  addFound(id: string) {
    const s = read();
    if (!(s.found ?? []).includes(id)) write({ ...s, found: [...(s.found ?? []), id] });
  },
  get spent(): string[] {
    return read().spent ?? [];
  },
  /** Spend the oldest memory not yet spent; returns its id (or null if none is left). */
  spendOne(): string | null {
    const s = read();
    const left = (s.found ?? []).filter((id) => !(s.spent ?? []).includes(id));
    if (!left.length) return null;
    write({ ...s, spent: [...(s.spent ?? []), left[0]] });
    return left[0];
  },
  /** Small frames captured at each afterimage's height (kept apart: they're the bulk). */
  get album(): Record<string, string> {
    try { return JSON.parse(localStorage.getItem(ALBUM) || '{}'); } catch { return {}; }
  },
  saveFrame(id: string, dataUrl: string) {
    try { localStorage.setItem(ALBUM, JSON.stringify({ ...this.album, [id]: dataUrl })); } catch { /* full: skip */ }
  },
  get guide() {
    return read().guide ?? 'subtle';
  },
  set guide(v: 'subtle' | 'always' | 'off') {
    write({ ...read(), guide: v });
  },
  /** Count a prompt shown; returns how many times it had been shown before. */
  /** How many times a prompt has been shown (without counting this). */
  promptCount(label: string) {
    return read().prompts?.[label] ?? 0;
  },
  promptSeen(label: string) {
    const s = read();
    const n = s.prompts?.[label] ?? 0;
    write({ ...s, prompts: { ...(s.prompts ?? {}), [label]: n + 1 } });
    return n;
  },
  getAccess(key: string) {
    return read().access?.[key];
  },
  setAccess(key: string, v: string) {
    const s = read();
    write({ ...s, access: { ...(s.access ?? {}), [key]: v } });
  },
  get subtitle() {
    return read().subtitle ?? 'm';
  },
  set subtitle(v: 's' | 'm' | 'l') {
    write({ ...read(), subtitle: v });
  },
  /** Reload straight into the saved checkpoint (used by "restart from checkpoint"). */
  reloadIntoCheckpoint() {
    this.armAutoContinue();
    location.reload();
  },
  /** The next page load skips the title and resumes the checkpoint. */
  armAutoContinue() {
    try { sessionStorage.setItem(AUTO, '1'); } catch { /* ignore */ }
  },
  takeAutoContinue() {
    try {
      const v = sessionStorage.getItem(AUTO) === '1';
      sessionStorage.removeItem(AUTO);
      return v;
    } catch {
      return false;
    }
  },
};
