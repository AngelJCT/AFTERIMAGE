import * as THREE from 'three/webgpu';
import type { Game } from '../main';
import { color, uv, length, smoothstep, uniform } from 'three/tsl';

/**
 * The ochre strip as a compass (after Part II, while she carries it). There is no marker and
 * no HUD: the strip in her fist leans toward where the child went next, as if a wind were
 * blowing that way.
 *
 * - Walking, it barely stirs.
 * - Standing still, she raises her fist and it streams out toward the trace, almost level.
 * - With her eyes closed (hold E, when the story allows it), its pull is felt instead: a warm
 *   glow through the lids in its direction, and a faint sound from there when she faces it.
 *
 * The guide setting still applies: "always" keeps a steady pull, "off" leaves only the still
 * and eyes-closed cues.
 */
export const compass = {
  /** Where it pulls (world), or null: the strip just hangs. */
  target: null as THREE.Vector3 | null,
  /** Whether holding E closes her eyes to feel it (off while E does something else). */
  listen: true,
  /** 0..1, read by the strip. */
  pull: 0,
  /** Horizontal world direction of the pull, read by the strip. */
  dir: new THREE.Vector3(0, 0, 1),
};

let installed = false;

export function installCompass(g: Game, holding: () => boolean) {
  if (installed) return;
  installed = true;
  const { player: P, input, post, audio, cam } = g;
  let still = 0, closed = 0, echoT = 0, raised = 0, looked = false;
  const v = new THREE.Vector3();
  // Wisps: faint ochre motes that leave the strip's end and drift the way it pulls, so the
  // direction reads even when the strip points away from the camera.
  const wispMat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  wispMat.fog = false;
  const wispLevel = uniform(0);
  wispMat.colorNode = color(1.0, 0.7, 0.36).mul(smoothstep(0.5, 0.0, length(uv().sub(0.5)))).mul(wispLevel).mul(0.9);
  const wisps = Array.from({ length: 28 }, () => {
    const sp = new THREE.Sprite(wispMat);
    sp.scale.setScalar(0.035);
    sp.visible = false;
    g.scene.add(sp);
    return { sp, vel: new THREE.Vector3(), life: 0 };
  });
  let spawn = 0;
  g.onFrame((dt, t) => {
    const target = compass.target;
    const active = !!target && holding() && P.controllable;
    let want = 0;
    if (active) {
      const speed = Math.hypot(P.velocity.x, P.velocity.z);
      still = speed < 0.15 ? still + dt : 0;
      const mode = g.guide.mode;
      const base = mode === 'always' ? 0.5 : mode === 'off' ? 0 : 0.12;
      want = Math.max(base * Math.min(1, speed + 0.4), still > 0.6 ? 0.95 : 0);
      compass.dir.set(target.x - P.position.x, 0, target.z - P.position.z);
      if (compass.dir.lengthSq() > 1e-6) compass.dir.normalize();
    }
    compass.pull += (want - compass.pull) * (1 - Math.exp(-dt * (want > compass.pull ? 1.8 : 3)));

    // She lifts her fist a little while it pulls: out to her left front, below the chest, the
    // elbow low (holding it out to the wind, not raising it).
    const r = active ? THREE.MathUtils.smoothstep(compass.pull, 0.35, 0.8) : 0;
    raised += (r - raised) * (1 - Math.exp(-dt * 3));
    if (raised > 0.005 || r > 0) {
      const f = new THREE.Vector3(Math.sin(P.yaw), 0, Math.cos(P.yaw));
      const l = new THREE.Vector3(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
      P.leftReachTarget.copy(P.chestWorld(v)).addScaledVector(f, 0.3).addScaledVector(l, 0.3).add(new THREE.Vector3(0, -0.16, 0));
      P.leftReachWeight = raised;
      P.leftAim = f.clone().add(new THREE.Vector3(0, 0.05, 0)).normalize();
      P.leftElbowDown = 0.85 * raised;
      // Her eyes go where it points.
      if (raised > 0.5 && target) { P.lookTarget = target.clone().setY(target.y + 1.2); looked = true; }
      else if (looked) { P.lookTarget = null; looked = false; }
      if (raised <= 0.005 && r === 0) { P.leftReachWeight = 0; P.leftAim = null; P.leftElbowDown = 0; }
    }

    // Wisps off the strip's end while it pulls.
    wispLevel.value = compass.pull;
    if (compass.pull > 0.45 && (spawn -= dt) <= 0) {
      spawn = 0.12;
      const w = wisps.find((x) => x.life <= 0);
      if (w) {
        w.life = 1;
        w.sp.position.copy(P.leftGripWorld(v)).addScaledVector(compass.dir, 0.2);
        w.vel.copy(compass.dir).multiplyScalar(0.9 + Math.random() * 0.5).add(new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.08 + Math.random() * 0.1, (Math.random() - 0.5) * 0.2));
      }
    }
    for (const w of wisps) {
      if (w.life <= 0) { w.sp.visible = false; continue; }
      w.life -= dt / 2.6;
      w.sp.position.addScaledVector(w.vel, dt);
      w.sp.visible = true;
      w.sp.scale.setScalar(0.02 + 0.03 * Math.sin(Math.PI * Math.max(0, w.life)));
    }

    // Eyes closed: the pull felt through the lids.
    const listen = active && compass.listen;
    const wantClosed = listen && input.actionHeld ? 1 : 0;
    const was = closed;
    closed += (wantClosed - closed) * (1 - Math.exp(-dt * (wantClosed ? 1.6 : 3.5)));
    if (closed > 0.002 || was > 0.002) {
      P.eyelids = Math.min(1, closed * 1.9);
      post.uEyesClosed.value = Math.max(0, (closed - 0.45) / 0.55);
      audio.setClosed(closed);
      audio.setIntensity(1 - 0.45 * closed, 0.6);
      if (target) {
        v.copy(target).setY(target.y + 1).project(cam.camera);
        let x = v.x, y = v.y;
        if (v.z > 1) { x = -x; y = -y; }
        const m = Math.max(Math.abs(x), Math.abs(y));
        if (v.z > 1 || m > 0.92) { x = (x / m) * 0.92; y = (y / m) * 0.92; }
        post.uEcho.value.set(x * 0.5 + 0.5, 0.5 - y * 0.5, closed > 0.3 ? 0.9 : 0);
        const facing = new THREE.Vector3(Math.sin(P.yaw), 0, Math.cos(P.yaw)).dot(compass.dir);
        if (closed > 0.6 && facing > 0.9 && (echoT -= dt) <= 0) {
          audio.echo(target, 0.7);
          echoT = 2.4 + Math.random() * 0.5;
        }
      }
      if (closed <= 0.002) { post.uEcho.value.z = 0; P.eyelids = 0; post.uEyesClosed.value = 0; audio.setClosed(0); audio.setIntensity(1, 0.6); }
    }
    void t;
  });
}
