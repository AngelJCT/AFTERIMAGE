// The storyboard specifies a lens family (32 / 50 / 85mm spherical, full-frame).
// Convert focal length to three.js vertical FOV so shots can be authored in mm.
const SENSOR_H = 24; // mm, full-frame 36x24

export function lensToFov(mm: number, aspect = 16 / 9): number {
  let fov = (2 * Math.atan(SENSOR_H / 2 / mm) * 180) / Math.PI;
  // Portrait / narrow screens: keep the horizontal field of a 16:9 frame so
  // phones held upright don't crop the composition to a sliver.
  if (aspect < 16 / 9) {
    const hRad = 2 * Math.atan(((SENSOR_H / 2) * (16 / 9)) / mm);
    fov = (2 * Math.atan(Math.tan(hRad / 2) / aspect) * 180) / Math.PI;
    fov = Math.min(fov, 75);
  }
  return fov;
}

export const LENS = { wide: 32, mid: 50, close: 85 } as const;
