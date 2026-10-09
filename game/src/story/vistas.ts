import * as THREE from 'three/webgpu';
import type { Game } from '../main';
import { progress } from './progress';
import { FALLEN, POOL_EDGE, RUINS, STILL_POOL } from '../world/terrain';
import { SHARD_AT } from '../world/landmarkShard';
import { INVERTED, invertedAt } from '../world/invertedWorld';

/**
 * Where something vast hangs in the sky, the world points at it without taking the camera: as
 * she comes near, a few glassy flakes rise off the ground round her and drift toward it. If she
 * lingers there without looking, once (ever, per place) a quiet "look up" appears, and goes as
 * soon as the view turns to it.
 */
interface Vista { id: string; at: THREE.Vector3; r: number; look: THREE.Vector3 }

const VISTAS: Vista[] = [
  // From the grove's north-east edge: the shard, and the rupture behind it.
  { id: 'shard', at: RUINS, r: 9, look: SHARD_AT },
  // By the fallen giant: the grove itself, upside down to the west.
  { id: 'inverted', at: FALLEN, r: 8, look: invertedAt(INVERTED[0]) },
  // The still pool's north shore: her shed shell, in broken rings over the water.
  { id: 'shedding', at: POOL_EDGE, r: 7, look: STILL_POOL.clone().setY(45) },
];

export function installVistas(g: Game) {
  let inside: Vista | null = null, dwell = 0, shown = false, glint = 0, shownFor = 0;
  const fwd = new THREE.Vector3(), to = new THREE.Vector3();
  // Never over a story prompt, and only ever take down its own.
  const el = document.getElementById('prompt')!;
  const busy = () => el.classList.contains('show') && !/look up/.test(el.textContent ?? '');
  const hide = () => { if (/look up/.test(el.textContent ?? '')) g.ui.hidePrompt(); };
  g.onFrame((dt) => {
    const p = g.player.position;
    const v = VISTAS.find((q) => Math.hypot(p.x - q.at.x, p.z - q.at.z) < q.r) ?? null;
    if (v !== inside) {
      if (shown) hide();
      inside = v; dwell = 0; shown = false;
    }
    if (!v || !g.player.controllable) return;
    dwell += dt;
    to.copy(v.look).sub(p).normalize();
    // The flakes: a few at a time off the ground round her, drifting up toward it.
    if ((glint -= dt) <= 0) {
      glint = 0.5;
      const at = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0.1, (Math.random() - 0.5) * 3));
      g.flakes.burst(at, 0.4, 2, 0.04, 0.25, to.clone().multiplyScalar(0.6));
    }
    // The hint: once, if she lingers and the view isn't already there.
    g.cam.camera.getWorldDirection(fwd);
    const facing = fwd.dot(to) > 0.92;
    const key = `vista:${v.id}`;
    if (!shown && dwell > 3 && !facing && !busy() && progress.promptCount(key) === 0) {
      g.ui.showPrompt('look up', g.input.padActive ? 'right stick' : 'drag', 'drag to look up', false);
      shown = true; shownFor = 0;
    }
    if (shown) {
      shownFor += dt;
      // It counts as given once it has been there a moment (or she looked).
      const done = facing || dwell > 12;
      if (done || busy()) {
        if (done || shownFor > 1.5) progress.promptSeen(key);
        hide(); shown = false;
        if (done) dwell = -Infinity;
      }
    }
  });
}
