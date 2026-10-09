import { progress } from '../story/progress';

/**
 * Accessibility and comfort settings (pause menu), kept with the progress.
 *
 * - shake: camera shake and handheld drift (full, low, off).
 * - effects: the afterimage trails, the drain fracture and light flashes (full, reduced).
 * - hold: actions that are held (E) can instead toggle on one press and off the next.
 * - backing: a dark band behind the subtitles.
 * - look: how fast the view turns (slow, normal, fast); invert: up and down swapped.
 */
export type Shake = 'full' | 'low' | 'off';
export type Effects = 'full' | 'reduced';
export type Hold = 'hold' | 'toggle';
export type Backing = 'off' | 'on';
export type Look = 'slow' | 'normal' | 'fast';
export type Invert = 'off' | 'on';

const DEFAULTS = { shake: 'full', effects: 'full', hold: 'hold', backing: 'off', look: 'normal', invert: 'off' } as const;
type Key = keyof typeof DEFAULTS;

const listeners = new Set<() => void>();

export const access = {
  get shake() { return (progress.getAccess('shake') ?? DEFAULTS.shake) as Shake; },
  get effects() { return (progress.getAccess('effects') ?? DEFAULTS.effects) as Effects; },
  get hold() { return (progress.getAccess('hold') ?? DEFAULTS.hold) as Hold; },
  get backing() { return (progress.getAccess('backing') ?? DEFAULTS.backing) as Backing; },
  get look() { return (progress.getAccess('look') ?? DEFAULTS.look) as Look; },
  get invert() { return (progress.getAccess('invert') ?? DEFAULTS.invert) as Invert; },
  set(key: Key, v: string) {
    progress.setAccess(key, v);
    for (const fn of listeners) fn();
  },
  get(key: Key) { return this[key] as string; },
  onChange(fn: () => void) { listeners.add(fn); fn(); return () => listeners.delete(fn); },
  /** Multiplier for how fast the view turns. */
  get lookScale() { return { slow: 0.6, normal: 1, fast: 1.6 }[this.look]; },
  /** -1 when up and down are swapped. */
  get invertY() { return this.invert === 'on' ? -1 : 1; },
  /** Multiplier for camera shake. */
  get shakeScale() { return { full: 1, low: 0.35, off: 0 }[this.shake]; },
  /** Multiplier for handheld drift. */
  get handheldScale() { return { full: 1, low: 0.55, off: 0.2 }[this.shake]; },
  /** Multiplier for the afterimage trails and the drain fracture. */
  get fxScale() { return this.effects === 'full' ? 1 : 0.35; },
  /** A flash colour, dimmed toward black when effects are reduced. */
  flash(colour: string) {
    if (this.effects === 'full' || !/^#[0-9a-f]{6}$/i.test(colour)) return colour;
    const n = parseInt(colour.slice(1), 16);
    const dim = (c: number) => Math.round(c * 0.3).toString(16).padStart(2, '0');
    return `#${dim(n >> 16)}${dim((n >> 8) & 255)}${dim(n & 255)}`;
  },
};
