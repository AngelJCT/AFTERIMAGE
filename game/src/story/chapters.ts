import type { Beat } from './progress';
import type { WeatherName } from '../world/weather';

/**
 * The game's chapters: where each begins (a beat) and its title. The title shows quietly as a
 * chapter begins (not over the first film, which opens cold from the title), and the title screen's
 * chapter select lists every chapter reached so far. Chapters marked `reboot` open with a
 * reboot interlude (story/reboot.ts) when play flows into them (not from the chapter select).
 */
export interface Chapter { beat: Beat; n: string; title: string; card: boolean; weather: WeatherName; reboot?: boolean }

export const CHAPTERS: Chapter[] = [
  { beat: 'coldOpen', n: 'I', title: 'afterimage', card: false, weather: 'day' },       // the first film, cold
  { beat: 'grove', n: 'II', title: 'the grove', card: true, weather: 'day', reboot: true },
  { beat: 'gate', n: 'III', title: 'the gate', card: true, weather: 'late' },
  { beat: 'search', n: 'IV', title: 'the search', card: true, weather: 'late', reboot: true },
  { beat: 'crossing', n: 'V', title: 'the crossing', card: true, weather: 'dusk', reboot: true },
  { beat: 'mirror', n: 'VI', title: 'the other side', card: true, weather: 'dusk' },
];

export function chapterAt(beat: Beat) {
  return CHAPTERS.find((c) => c.beat === beat) ?? null;
}
