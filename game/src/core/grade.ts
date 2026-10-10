import * as THREE from 'three/webgpu';

/**
 * Film-matched colour grade, baked into a 3D LUT (display-referred sRGB in -> sRGB out).
 *
 * The statistics come from measuring (CIE Lab, subtitle band cropped):
 *   - the Part I film: blender/scripts/film_stats.py AFTERIMAGE.mp4
 *   - the game's own output before grading (in-browser readback)
 * The LUT moves the game's Lab mean/spread part of the way toward the film's (Reinhard
 * transfer), then adds restrained cool shadows and warmer highlights.
 */
export const FILM = { mean: [50.47, 0.06, 10.37], std: [22.54, 2.91, 6.92] };
// Measured with tone mapping, light shafts and god rays on, before the LUT.
export const GAME = { mean: [72.87, 0.49, 6.85], std: [22.0, 0.59, 3.13] };

export interface GradeParams {
  strength: number;      // 0..1 how far colour (a/b) moves toward the film statistics
  lightStrength: number; // 0..1 how far lightness moves (less: bright shots should stay bright)
  maxChroma: number;     // cap on the a/b spread multiplier
  shadowTint: [number, number];    // Lab a/b added in the shadows
  highlightTint: [number, number]; // Lab a/b added in the highlights
}

export const DEFAULT_GRADE: GradeParams = {
  strength: 0.48,
  lightStrength: 0.38,
  maxChroma: 2.2,
  shadowTint: [-0.10, -1.2],
  highlightTint: [0.5, 1.6],
};

const Xn = 0.95047, Zn = 1.08883;
const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / Xn;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / Zn;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

function labToSrgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const X = fInv(fx) * Xn, Y = fInv(fy), Z = fInv(fz) * Zn;
  const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const B = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  return [R, G, B].map((v) => THREE.MathUtils.clamp(toSrgb(Math.max(0, v)), 0, 1)) as [number, number, number];
}

export function buildGradeLut(p: GradeParams = DEFAULT_GRADE, size = 33) {
  const data = new Uint8Array(size * size * size * 4);
  const ratio = [0, 1, 2].map((k) =>
    THREE.MathUtils.clamp(FILM.std[k] / GAME.std[k], 0.8, k === 0 ? 1.1 : p.maxChroma));
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        const lab = srgbToLab(ri / (size - 1), gi / (size - 1), bi / (size - 1));
        const t = [0, 1, 2].map((k) => FILM.mean[k] + (lab[k] - GAME.mean[k]) * ratio[k]);
        let [L, a, b] = lab.map((v, k) => v + (t[k] - v) * (k === 0 ? p.lightStrength : p.strength));
        // Split tone, weighted by lightness (after the transfer).
        const sh = THREE.MathUtils.clamp(1 - L / 45, 0, 1);
        const hi = THREE.MathUtils.clamp((L - 60) / 35, 0, 1);
        a += p.shadowTint[0] * sh + p.highlightTint[0] * hi;
        b += p.shadowTint[1] * sh + p.highlightTint[1] * hi;
        // The film's blacks sit around L 9: a soft matte lift instead of crushed shadows.
        L = L + 8 * Math.max(0, 1 - Math.max(L, 0) / 32) ** 2;
        // Keep paper white untinted.
        const anchor = Math.min(1, (100 - lab[0]) / 3);
        const [R, G, B] = labToSrgb(
          lab[0] + (L - lab[0]) * anchor, lab[1] + (a - lab[1]) * anchor, lab[2] + (b - lab[2]) * anchor);
        const i = ((bi * size + gi) * size + ri) * 4;
        data[i] = Math.round(R * 255);
        data[i + 1] = Math.round(G * 255);
        data[i + 2] = Math.round(B * 255);
        data[i + 3] = 255;
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
