import * as THREE from 'three/webgpu';
import type { Shot } from '../core/camera';
import { LENS } from '../core/lens';
import type { Player } from '../player/player';

// Shot recipes from the Part I film, built relative to her body so they work anywhere.

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Extreme close-up of her left eye (the fissure side). */
export function eyeShot(p: Player, dist = 0.2): Shot {
  const eye = p.eyeWorld();
  const face = p.faceDir();
  const side = V(Math.cos(p.yaw), 0, -Math.sin(p.yaw)); // her left
  return {
    position: eye.clone().addScaledVector(face, dist).addScaledVector(side, 0.03).add(V(0, 0.01, 0)),
    target: eye.clone().addScaledVector(side, 0.012),
    focus: eye,
    lens: LENS.close,
    range: 0.035,
    bokeh: 16,
  };
}

/** Close-up of the cyan port on her left shoulder. */
export function portShot(p: Player, dist = 0.32): Shot {
  const { pos, normal } = p.portWorld();
  const back = V(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  return {
    position: pos.clone().addScaledVector(normal, dist).addScaledVector(back, 0.12).add(V(0, 0.06, 0)),
    target: pos.clone(),
    focus: pos.clone(),
    lens: LENS.close,
    range: 0.08,
    bokeh: 14,
  };
}

/** High overhead, looking down at her where she lies (branch shadows on cracked ground). */
export function topDown(center: THREE.Vector3, height: number): Shot {
  return {
    position: center.clone().add(V(0.5, height, 0.9)),
    target: center.clone().add(V(0, 0.25, 0)),
    lens: LENS.mid,
    range: 1.4,
    bokeh: 6,
  };
}

/** 85mm over the water, from behind her right side, looking into the light. */
export function handShot(contact: THREE.Vector3, fwd: THREE.Vector3, right: THREE.Vector3): Shot {
  return {
    position: contact.clone().addScaledVector(right, 0.62).addScaledVector(fwd, -0.3).add(V(0, 0.2, 0)),
    target: contact.clone().add(V(0, 0.1, 0)),
    focus: contact.clone().add(V(0, 0.08, 0)),
    lens: LENS.close,
    range: 0.25,
    bokeh: 14,
  };
}

/**
 * Her point of view, looking down into the still pool at her own mirrored face (the film's
 * upside-down reflection). Optically this is the only place her face shows in the water.
 */
export function reflectionShot(p: Player): Shot {
  const eye = p.eyeWorld();
  const face = p.faceDir();
  const image = V(eye.x, -eye.y, eye.z);   // mirror across the water plane (y = 0)
  const position = eye.clone().addScaledVector(face, 0.08);
  const towardBody = V(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  return {
    position,
    target: image,
    up: towardBody, // screen-top toward her body: the reflected face reads upside-down
    focus: image.clone(),
    lens: LENS.mid,
    // The depth buffer holds the pool floor, not the virtual image: keep the pool sharp.
    range: 3,
    bokeh: 3,
  };
}

/** The film's opening: small figure standing in shallow water, glare behind her. */
export function wideOpening(standing: THREE.Vector3, yaw: number): Shot {
  const fwd = V(Math.sin(yaw), 0, Math.cos(yaw));
  const right = V(-fwd.z, 0, fwd.x);
  return {
    position: standing.clone().addScaledVector(fwd, 8.5).addScaledVector(right, -1.2).add(V(0, 0.45, 0)),
    target: standing.clone().add(V(0, 1.0, 0)),
    lens: LENS.wide,
    range: 2.5,
    bokeh: 6,
  };
}
