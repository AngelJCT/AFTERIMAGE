import * as THREE from 'three/webgpu';
import type { Game } from '../main';
import { STILL_POOL } from '../world/terrain';

/**
 * The end credits, under "Someone to Find" (public/audio/SomeoneToFind.mp3): the picture comes
 * back dim, a slow pull away from her by the still pool at dusk, and the credits rise through
 * it. Any key (after a few seconds) lets them go early. Then the title screen.
 *
 * Edit CREDITS to add names and roles; an empty string is a gap, a line starting with "# " is
 * a heading.
 */
export const CREDITS = [
  '# AFTERIMAGE',
  '',
  'from the films',
  'AFTERIMAGE',
  'AFTERIMAGE II',
  '',
  '',
  '# music',
  'Someone to Find',
  '',
  '',
  '# made with',
  'three.js',
  'Blender',
  '',
  '',
  '',
  'thank you for playing',
];

export async function runCredits(g: Game) {
  const { clock, ui, player, audio, cam, input } = g;
  const el = document.createElement('div');
  el.id = 'credits';
  const roll = document.createElement('div');
  roll.className = 'roll';
  for (const line of CREDITS) {
    const d = document.createElement('div');
    if (line.startsWith('# ')) { d.className = 'h'; d.textContent = line.slice(2); }
    else if (!line) d.className = 'gap';
    else d.textContent = line;
    roll.append(d);
  }
  el.append(roll);
  document.getElementById('card')!.before(el);

  // A slow pull away from her, rising.
  player.controllable = false;
  const p = player.position.clone();
  // Out over the still pool (the far shore sits near the world's edge), looking back at her.
  const back = STILL_POOL.clone().sub(p).setY(0).normalize();
  const side = new THREE.Vector3(-back.z, 0, back.x);
  const shot = { position: new THREE.Vector3(), target: p.clone().add(new THREE.Vector3(0, 0.9, 0)), lens: 35, range: 10, bokeh: 0.5, handheld: 0.4 };
  const place = (k: number) => shot.position.copy(p).addScaledVector(back, 3 + 14 * k).addScaledVector(side, 1.5 + 3 * k).add(new THREE.Vector3(0, 1.4 + 6 * k, 0));
  place(0);
  cam.cutTo(shot, 0);

  const playing = await audio.playMusic('credits', 3);
  const length = playing ? 176 : 40;
  void ui.fade(0.45, 5);
  el.classList.add('show');
  let t = 0, done = false;
  const tick = g.onFrame((dt) => {
    t += dt;
    const k = Math.min(1, t / length);
    place(k);
    // The roll rises from below the screen to above it over the song.
    roll.style.transform = `translateY(${(1 - k) * innerHeight - k * roll.offsetHeight}px)`;
    if (t > 6 && (input.anyPressed || input.actionPressed)) done = true;
  });
  await clock.until(() => done || t >= length);
  tick();
  audio.stopMusic(done ? 3 : 6);
  el.classList.remove('show');
  await ui.fade(1, 3);
  el.remove();
  await ui.card('AFTERIMAGE', '', 5);
}
