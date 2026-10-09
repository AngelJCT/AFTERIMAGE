import * as THREE from 'three/webgpu';
import {
  abs, cameraPosition, color, Discard, dot, float, Fn, If, length, max, mix, mx_cell_noise_float, normalize, normalWorld,
  positionWorld, pow, sin, smoothstep, time, uniform,
} from 'three/tsl';
import { SUN_DIR } from './atmosphere';

/**
 * Things seen far off against the bright haze (the inverted world in the sky, the suspended
 * echoes): flat silhouettes in one tone, a pale rim where the light catches their edges, fading
 * into the horizon's colour with distance. Drawn without the scene's fog, which would erase them
 * long before they read, and following the sky's colour through the weather instead.
 *
 * With `holes`, they come apart like the far world does: cells of it missing, the gaps slowly
 * opening and closing.
 */
export interface SilhouetteOpts {
  tone: number;
  /** Distance (m) over which it fades toward the horizon, and how far (0..1) it goes. */
  near: number; far: number; cap: number;
  /** Rim light strength. */
  rim?: number;
  /** Size (m) of the cells that go missing, and how many (0..1); 0 for none. */
  holes?: number; holeAmount?: number;
  /** A height above which it dissolves into the haze (the inverted world's roots in cloud). */
  rootY?: number;
}

export function silhouetteMaterial(atmos: { uHorizon: any; uSunCol: any }, o: SilhouetteOpts) {
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  mat.fog = false;
  const uSun = uniform(SUN_DIR);
  const dist = length(positionWorld.sub(cameraPosition));
  const n = normalize(normalWorld), v = normalize(cameraPosition.sub(positionWorld));
  const fres = pow(float(1).sub(abs(dot(n, v))), 3.0);
  const sunSide = max(dot(n, uSun), 0.0);
  let k: any = smoothstep(o.near, o.far, dist).mul(o.cap);
  if (o.rootY !== undefined) k = max(k, smoothstep(o.rootY - 30, o.rootY, positionWorld.y));
  const base = color(o.tone).mul(float(0.92).add(sunSide.mul(0.16)));
  const lit = base.add(atmos.uSunCol.mul(fres.mul(o.rim ?? 0.5)));
  const col = mix(lit, atmos.uHorizon, k);
  if (o.holes) {
    const holes = o.holes, amount = o.holeAmount ?? 0.2;
    mat.colorNode = Fn(() => {
      const cell = mx_cell_noise_float(positionWorld.div(holes));
      If(cell.lessThan(float(amount).add(sin(time.mul(0.07).add(cell.mul(40.0))).mul(0.06))), () => { Discard(); });
      return col;
    })();
  } else {
    mat.colorNode = col;
  }
  return mat;
}
