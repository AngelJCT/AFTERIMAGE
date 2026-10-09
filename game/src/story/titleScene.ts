import * as THREE from 'three/webgpu';
import type { Game } from '../main';
import { EXIT, STILL_POOL, heightAt } from '../world/terrain';

/**
 * The title screen, alive: behind the title, she stands at the grove's edge in the late light,
 * looking up toward what hangs over the still pool (her shed shell in its broken rings, the ring
 * of light beyond, the grove upside down in the haze) while the camera drifts slowly behind her.
 * The first touch or key wakes the sound: the main theme when it's there, else the grove's cue,
 * quietly. Beginning (or continuing) hands over to the story, which sets its own scene.
 */
export function startTitleScene(g: Game) {
  const dir = new THREE.Vector3(STILL_POOL.x - EXIT.x, 0, STILL_POOL.z - EXIT.z).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const spot = EXIT.clone().addScaledVector(dir, 1.5);
  spot.y = heightAt(spot.x, spot.z);
  const yaw = Math.atan2(dir.x, dir.z);
  const p = g.player;
  p.place(spot, yaw);
  p.controllable = false;
  Object.assign(p.pose, { kneel: 0, lie: 0, lean: 0, headPitch: -0.22 });
  g.weather.set('late', 0);
  // The sky as it will be partway through: the rupture open, most of the rings hung.
  g.setStage('trace', true);

  const look = spot.clone().addScaledVector(dir, 30).add(new THREE.Vector3(0, 16, 0));
  const shot = {
    position: new THREE.Vector3(), target: look.clone(), lens: 26,
    focus: spot.clone().add(new THREE.Vector3(0, 1.4, 0)), range: 40, bokeh: 0, handheld: 0.5,
  };
  let t = 0;
  const place = () => {
    // Low behind her and a little to her left, easing slowly sideways and in.
    const s = Math.sin(t * 0.045), c = Math.cos(t * 0.03);
    shot.position.copy(spot).addScaledVector(dir, -4.4 + c * 0.6).addScaledVector(side, 1.1 + s * 1.4).add(new THREE.Vector3(0, 0.7 + s * 0.15, 0));
    shot.target.copy(look).addScaledVector(side, s * 3);
  };
  place();
  g.cam.cutTo(shot, 0);
  const off = g.onFrame((dt) => { t += dt; place(); });

  // Sound, on the first gesture (browsers won't play before one).
  let woke = false;
  const wake = async () => {
    if (woke || document.body.classList.contains('playing')) return;
    woke = true;
    g.audio.start();
    if (!(await g.audio.playMusic('title', 4))) {
      g.audio.setIntensity(0.55, 0);
      await g.audio.playMusic('grove', 6);
    }
  };
  addEventListener('pointerdown', wake, { once: true });
  addEventListener('keydown', wake, { once: true });

  return {
    stop() {
      off();
      removeEventListener('pointerdown', wake);
      removeEventListener('keydown', wake);
      g.cam.release(0);
    },
  };
}
