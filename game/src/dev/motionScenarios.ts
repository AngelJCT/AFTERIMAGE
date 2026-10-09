/** The same input sequences drive browser inspection and the shipped-rig diagnostics. */
export const MOTIONS = {
  walk: { label: 'Walk', seconds: 6, start: [0, 7] },
  run: { label: 'Run', seconds: 6, start: [0, 7] },
  'start-stop': { label: 'Start / stop', seconds: 9, start: [0, 7] },
  'walk-run': { label: 'Walk / run', seconds: 10, start: [0, 7] },
  turns: { label: 'Corners / reversal', seconds: 10, start: [0, 7] },
  slope: { label: 'Uneven ground', seconds: 7, start: [7, -18] },
} as const;
export type Motion = keyof typeof MOTIONS;

/** Camera yaw is zero: +y input walks toward world -Z, +x toward +X. */
export function motionInput(mode: Motion, t: number) {
  let x = 0, y = 1, running = mode === 'run';
  if (mode === 'start-stop') {
    y = t >= 1 && t < 3 || t >= 5 && t < 7 ? 1 : 0;
    running = t >= 5;
  } else if (mode === 'walk-run') {
    y = t >= 1 && t < 8 ? 1 : 0;
    running = t >= 3 && t < 6;
  } else if (mode === 'turns') {
    if (t < 1 || t >= 8) y = 0;
    else if (t >= 3 && t < 5) { x = 1; y = 0; }
    else if (t >= 5) { x = -1; y = 0; }
    running = t >= 5;
  }
  return { move: { x, y }, running, touch: false };
}
