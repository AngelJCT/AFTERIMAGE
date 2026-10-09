import * as THREE from 'three/webgpu';
import { cameraPosition, dot, float, normalWorld, positionWorld, pow, smoothstep, uniform } from 'three/tsl';

/**
 * Film lighting (set each frame by Game.filmLight): what a gaffer's bounce and backlight add on
 * set, only on the materials that ask for it (the characters, and set pieces like the refuge
 * gate), so the world's light is untouched.
 *   - a soft key from just above and beside the camera, wrapping round forms: up in cutscene
 *     shots (uCineKey);
 *   - a rim from behind, in the sun's colour, where the surface turns away: faint in play,
 *     fuller in cutscenes (uCineRim).
 */
export const uCineKey = uniform(0);
export const uKeyDir = uniform(new THREE.Vector3(0, 1, 0));
export const uKeyCol = uniform(new THREE.Color(1, 0.94, 0.86));
export const uCineRim = uniform(0);
export const uRimDir = uniform(new THREE.Vector3(0, 0, -1));
export const uRimCol = uniform(new THREE.Color(1, 0.85, 0.65));

/** The added light (emissive) for a surface of colour `albedo`; `strength` scales both terms. */
export function filmLight(albedo: any, strength = 1) {
  const n = normalWorld, v = cameraPosition.sub(positionWorld).normalize();
  const wrap = dot(n, uKeyDir).add(0.35).div(1.35).clamp(0, 1);
  const key = albedo.mul(uKeyCol).mul(wrap.mul(wrap)).mul(uCineKey);
  const rim = pow(float(1).sub(dot(n, v).clamp(0, 1)), 3.0).mul(smoothstep(-0.2, 0.4, dot(n, uRimDir)));
  return key.add(uRimCol.mul(rim).mul(uCineRim)).mul(strength);
}
