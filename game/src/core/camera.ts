import * as THREE from 'three/webgpu';
import { access } from './access';
import { Input } from './input';
import { lensToFov, LENS } from './lens';
import { heightAt } from '../world/terrain';
import { progress } from '../story/progress';

/**
 * A framing zone: as she walks in, the follow camera eases toward a composed angle (the player
 * keeps full control; steering the view takes precedence). Any field left out keeps the follow
 * camera's own value.
 */
export interface Shot {
  position: THREE.Vector3;
  target: THREE.Vector3;
  lens: number;          // mm
  focus?: THREE.Vector3; // focus point, defaults to target
  range?: number;        // depth-of-field range (m) before full blur; smaller = shallower
  bokeh?: number;        // blur size
  up?: THREE.Vector3;    // camera roll for shots looking straight down (default world up)
  handheld?: number;     // breathing drift amount (default 1; 0 = locked off)
}

const FOLLOW_RANGE = 1.1;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
// In play the whole landscape stays sharp (only the far distance comes apart, in post);
// cutscene shots still set their own shallow focus.
const FOLLOW_BOKEH = 0;
const HANDHELD = 0.0026;       // radians of drift at handheld 1
const FOLLOW_HANDHELD = 0.45;
const TRUNK_RADIUS = 0.36;     // camera keeps this far from trunk/branch cells
const TRUNK_HEIGHT = 3.2;
/** How far the player can zoom (multipliers on the follow boom). */
const ZOOM_MIN = 0.5, ZOOM_MAX = 2.4;

/**
 * Third-person follow camera with cinematic "shots" that beats can cut or blend to.
 * Exploration uses the 32mm lens from the storyboard; close contact beats use 85mm.
 */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0.18;
  distance = 3.1;
  followTarget = new THREE.Vector3();
  focusDistance = 3;
  focusRange = FOLLOW_RANGE;
  bokeh = FOLLOW_BOKEH;
  /** Ease the follow camera around behind her as she walks (cinematic walk-offs). */
  followBehind = false;
  /** Tree trunks (world XZ) the follow camera must not pass through. */
  obstacles: THREE.Vector2[] = [];
  /** 0..1, how much a cinematic shot owns the frame (drives the letterbox). */
  cinematic = 0;
  /** The player's zoom: a multiplier on the boom length (target, and eased). */
  zoom = THREE.MathUtils.clamp(Number(progress.getAccess('zoom') ?? 1) || 1, ZOOM_MIN, ZOOM_MAX);
  private zoomNow = this.zoom;
  private zoomSave = 0;
  private recentering = 0;

  private time = 0;
  private shakeAmp = 0;
  private speedPull = 0;
  private reach = 1;          // follow boom length fraction after collision
  private idleLook = 0;

  private shot: Shot | null = null;
  private blend = 0;        // 0 follow, 1 shot
  private blendSpeed = 1;
  private followPos = new THREE.Vector3();
  private followLook = new THREE.Vector3();
  private lens: number = LENS.wide;
  private lensTarget: number = LENS.wide;
  private tmpPos = new THREE.Vector3();
  private tmpLook = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(lensToFov(LENS.wide, aspect), aspect, 0.03, 520);
  }

  /** Hard cut (seconds = 0) or blend to a shot. */
  cutTo(shot: Shot, seconds = 0) {
    this.shot = shot;
    this.lensTarget = shot.lens;
    if (seconds <= 0) {
      this.blend = 1;
      this.lens = shot.lens;
      this.blendSpeed = 0;
    } else {
      this.blendSpeed = 1 / seconds;
    }
  }

  /** Return to follow; seconds = 0 is a hard cut. */
  release(seconds = 1.2) {
    this.lensTarget = LENS.wide;
    if (seconds <= 0) {
      this.blend = 0;
      this.shot = null;
      this.lens = LENS.wide;
      this.snapFollow = true;
    } else {
      this.blendSpeed = -1 / seconds;
    }
  }

  /** A short jolt (startle, impact); decays over about half a second. */
  shake(amount: number) {
    this.shakeAmp = Math.max(this.shakeAmp, amount * access.shakeScale);
  }

  /** The lens in use now (mm). */
  get lensNow() {
    return this.lens;
  }

  get inShot() {
    return this.shot !== null && this.blend > 0.999;
  }

  private snapFollow = true;

  update(dt: number, input: Input, player: THREE.Vector3, lookEnabled: boolean, playerYaw = 0, playerSpeed = 0) {
    // While she walks and the view isn't being steered, drift around behind her.
    if (!this.followBehind && lookEnabled && playerSpeed > 0.4 && this.idleLook > 2) {
      let d = playerYaw + Math.PI - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * 0.35 * Math.min(1, playerSpeed / 1.4)));
    }
    // Pull back a little when she runs; lean in slowly when she stands still.
    this.speedPull += (THREE.MathUtils.clamp((playerSpeed - 1.5) / 1.5, 0, 1) * 0.6 - this.speedPull) * (1 - Math.exp(-dt * 1.5));
    if (this.followBehind) {
      let d = playerYaw + Math.PI - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * 0.8));
    }
    if (lookEnabled) {
      const sens = access.lookScale;
      this.yaw -= input.look.x * 0.0045 * sens;
      // (Down to -0.5: low behind her, looking up past her into the sky.)
      this.pitch = THREE.MathUtils.clamp(this.pitch + input.look.y * 0.003 * sens * access.invertY, -0.5, 0.9);
      // Recentre (R, R3): round behind her and level again, quickly but not a cut.
      if (input.recenter) this.recentering = 0.5;
    }
    if (this.recentering > 0) {
      this.recentering -= dt;
      const k = 1 - Math.exp(-dt * 9);
      let d = playerYaw + Math.PI - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * k;
      this.pitch += (0.18 - this.pitch) * k;
    }

    // Zoom: the player's own boom length (wheel, pinch, - / =).
    if (input.zoom) {
      this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(input.zoom * 0.0015), ZOOM_MIN, ZOOM_MAX);
      // Remembered between sessions (once it settles).
      clearTimeout(this.zoomSave);
      this.zoomSave = window.setTimeout(() => progress.setAccess('zoom', this.zoom.toFixed(3)), 800);
    }
    this.zoomNow += (this.zoom - this.zoomNow) * (1 - Math.exp(-dt * 8));
    if (!this.shot) this.lensTarget = LENS.wide;

    // Follow framing: slightly over the right shoulder. The view is the player's; the only thing
    // it does on its own is drift round behind her as she walks (above).
    this.followTarget.set(player.x, player.y + 1.35, player.z);
    const cp = Math.cos(this.pitch);
    const dist = (this.distance + this.speedPull) * this.zoomNow;
    const desired = this.tmpPos.set(
      this.followTarget.x + Math.sin(this.yaw) * cp * dist,
      this.followTarget.y + Math.sin(this.pitch) * dist,
      this.followTarget.z + Math.cos(this.yaw) * cp * dist,
    );
    // Close in, she moves toward the centre of the frame.
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(0.35 * Math.min(1, this.zoomNow));
    desired.add(side);
    const look = this.tmpLook.copy(this.followTarget).add(side.multiplyScalar(0.6));
    this.idleLook = lookEnabled && (Math.abs(input.look.x) + Math.abs(input.look.y) > 0.5) ? 0 : this.idleLook + dt;

    // Don't pass through tree trunks: shorten the boom (fast in, slow out).
    const hit = this.boomHit(this.followTarget, desired);
    this.reach = hit < this.reach ? hit : Math.min(hit, this.reach + dt * 0.8);
    desired.lerpVectors(this.followTarget, desired, this.reach);
    desired.y = Math.max(desired.y, heightAt(desired.x, desired.z) + 0.25);

    const k = this.snapFollow ? 1 : 1 - Math.exp(-dt * 7);
    this.followPos.lerp(desired, k);
    this.followLook.lerp(look, k);
    this.snapFollow = false;

    if (this.blendSpeed !== 0) {
      this.blend = THREE.MathUtils.clamp(this.blend + dt * this.blendSpeed, 0, 1);
      if (this.blend === 0 && this.blendSpeed < 0) { this.shot = null; this.blendSpeed = 0; }
      if (this.blend === 1 && this.blendSpeed > 0) this.blendSpeed = 0;
    }
    const e = this.blend * this.blend * (3 - 2 * this.blend);
    this.cinematic = this.shot ? e : 0;
    this.time += dt;

    const cam = this.camera;
    cam.up.copy(this.shot?.up && e > 0.5 ? this.shot.up : WORLD_UP);
    if (this.shot) {
      cam.position.lerpVectors(this.followPos, this.shot.position, e);
      const l = new THREE.Vector3().lerpVectors(this.followLook, this.shot.target, e);
      cam.lookAt(l);
      const focus = this.shot.focus ?? this.shot.target;
      const fShot = cam.position.distanceTo(focus);
      this.focusDistance = THREE.MathUtils.lerp(this.followPos.distanceTo(player), fShot, e);
      this.focusRange = THREE.MathUtils.lerp(FOLLOW_RANGE, this.shot.range ?? FOLLOW_RANGE, e);
      this.bokeh = THREE.MathUtils.lerp(FOLLOW_BOKEH, this.shot.bokeh ?? FOLLOW_BOKEH, e);
    } else {
      cam.position.copy(this.followPos);
      cam.lookAt(this.followLook);
      this.focusDistance = cam.position.distanceTo(this.followLook);
      this.focusRange = FOLLOW_RANGE;
      this.bokeh = FOLLOW_BOKEH;
    }

    // Handheld: slow, breath-like drift (sums of incommensurate sines), more in shots.
    const amp = HANDHELD * THREE.MathUtils.lerp(FOLLOW_HANDHELD, this.shot?.handheld ?? 1, e) * access.handheldScale;
    if (amp > 0) {
      const t = this.time;
      cam.rotateX(amp * (Math.sin(t * 0.83) * 0.7 + Math.sin(t * 1.91 + 1.3) * 0.3));
      cam.rotateY(amp * (Math.sin(t * 0.61 + 2.1) * 0.7 + Math.sin(t * 1.47 + 0.4) * 0.3));
      cam.rotateZ(amp * 0.5 * Math.sin(t * 0.37 + 0.9));
    }
    if (this.shakeAmp > 1e-4) {
      const t = this.time, a = this.shakeAmp;
      cam.rotateX(a * Math.sin(t * 71) * 0.6 + a * Math.sin(t * 43 + 1) * 0.4);
      cam.rotateY(a * Math.sin(t * 59 + 2) * 0.6 + a * Math.sin(t * 37 + 3) * 0.4);
      this.shakeAmp *= Math.exp(-dt * 7);
    }

    this.lens += (this.lensTarget - this.lens) * (1 - Math.exp(-dt * 3));
    const fov = lensToFov(this.lens, cam.aspect);
    if (Math.abs(fov - cam.fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** Fraction (0..1) of the boom from `from` to `to` that is clear of trunks. */
  private boomHit(from: THREE.Vector3, to: THREE.Vector3) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-6) return 1;
    let t = 1;
    for (const o of this.obstacles) {
      const fx = from.x - o.x, fz = from.z - o.y;
      // |f + d t|^2 = r^2
      const b = fx * dx + fz * dz;
      const c = fx * fx + fz * fz - TRUNK_RADIUS * TRUNK_RADIUS;
      if (c < 0) continue; // she is inside the radius herself: ignore
      const disc = b * b - len2 * c;
      if (disc <= 0 || b > 0) continue;
      const hit = (-b - Math.sqrt(disc)) / len2;
      // Only trunks below the boom's height at that point.
      const y = from.y + (to.y - from.y) * hit - heightAt(o.x, o.y);
      if (hit < t && y < TRUNK_HEIGHT) t = hit;
    }
    return t >= 1 ? 1 : Math.max(0.2, t - 0.12 / Math.sqrt(len2));
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.fov = lensToFov(this.lens, aspect);
    this.camera.updateProjectionMatrix();
  }
}
