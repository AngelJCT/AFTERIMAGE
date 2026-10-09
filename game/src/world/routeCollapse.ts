import * as THREE from 'three/webgpu';
import { color, uv, length, smoothstep } from 'three/tsl';

interface Piece {
  pivot: THREE.Group;
  x0: number; x1: number;           // extent along the arcade (its local x)
  rest: THREE.Vector3;              // pivot position at rest (parent space)
  state: 'solid' | 'shaking' | 'falling' | 'down';
  t: number;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
}

interface Mote { sp: THREE.Sprite; v: THREE.Vector3; life: number; size: number; stone: boolean }

const _w = new THREE.Vector3();

/**
 * The elevated route giving way (the search): the arcade's deck pieces (deck_00 … from
 * blender/scripts/arches_kit.py) fall one after another as a collapse front passes along the
 * arcade toward −x. Each sags and shakes for a moment, sheds grit, then drops, tumbles and
 * comes to rest below as rubble. `solidAt` says whether there is still deck under a point;
 * `reset` puts everything back (a rewound attempt).
 */
export class RouteCollapse {
  readonly root: THREE.Object3D;
  /** World height of the ground under the arcade (where pieces come to rest). */
  groundY = 0;
  onBreak?: (worldPos: THREE.Vector3) => void;
  onLand?: (worldPos: THREE.Vector3) => void;
  private pieces: Piece[] = [];
  private motes: Mote[] = [];

  constructor(arches: THREE.Object3D, scene: THREE.Scene) {
    this.root = arches;
    arches.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(arches.matrixWorld).invert();
    const nodes: THREE.Mesh[] = [];
    arches.traverse((o) => { if (/^deck_\d\d$/.test(o.name) && (o as THREE.Mesh).isMesh) nodes.push(o as THREE.Mesh); });
    for (const node of nodes) {
      // Its extent along the arcade (meshopt keeps a scaled space on the node), and its centre
      // in its parent's space.
      node.geometry.computeBoundingBox();
      const box = node.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, node.matrixWorld));
      node.updateMatrix();
      const centre = node.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(node.matrix);
      // Re-seat it under a pivot at its centre, so it can tilt and tumble about itself.
      const pivot = new THREE.Group();
      pivot.name = `${node.name}_pivot`;
      pivot.position.copy(centre);
      node.parent!.add(pivot);
      node.matrixAutoUpdate = false;
      node.matrix.premultiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
      pivot.add(node);
      this.pieces.push({ pivot, x0: box.min.x, x1: box.max.x, rest: centre.clone(), state: 'solid', t: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
    this.pieces.sort((a, b) => a.x0 - b.x0);

    // Grit (soft, pale) and stones (small, dark) shed from the breaks.
    const soft = smoothstep(0.5, 0.15, length(uv().sub(0.5)));
    const grit = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    grit.colorNode = color(0.42, 0.39, 0.35);
    grit.opacityNode = soft.mul(0.55);
    const stone = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
    stone.colorNode = color(0.12, 0.11, 0.1);
    stone.opacityNode = smoothstep(0.5, 0.35, length(uv().sub(0.5)));
    for (let i = 0; i < 96; i++) {
      const isStone = i % 3 === 0;
      const sp = new THREE.Sprite(isStone ? stone : grit);
      sp.visible = false;
      sp.renderOrder = 4;
      scene.add(sp);
      this.motes.push({ sp, v: new THREE.Vector3(), life: 0, size: 0, stone: isStone });
    }
  }

  get count() { return this.pieces.length; }

  /** The piece under arcade-local x, if any. */
  private at(x: number) { return this.pieces.find((q) => x >= q.x0 - 0.05 && x <= q.x1 + 0.05); }

  /** Whether deck is still under arcade-local x (a shaking piece still holds). */
  solidAt(x: number) {
    const p = this.at(x);
    return !!p && (p.state === 'solid' || p.state === 'shaking');
  }

  /** How far the piece under x has sagged (m), for her feet to follow. */
  sagAt(x: number) {
    const p = this.at(x);
    if (!p || p.state !== 'shaking') return 0;
    return 0.08 * Math.min(1, p.t / 0.45);
  }

  /** Arcade-local x of a world point. */
  along(world: THREE.Vector3) { return this.root.worldToLocal(_w.copy(world)).x; }

  /** Grit and stones from around a point: `up` throws them out (a landing), else they rain. */
  private shed(at: THREE.Vector3, grit: number, stones: number, up = false) {
    for (const m of this.motes) {
      if (m.life > 0) continue;
      if (m.stone ? stones-- <= 0 : grit-- <= 0) continue;
      m.life = 1;
      m.sp.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 2.6, -0.25 - Math.random() * 0.2, (Math.random() - 0.5) * 2.2));
      if (up) m.v.set((Math.random() - 0.5) * 3, 0.5 + Math.random() * 1.4, (Math.random() - 0.5) * 3);
      else m.v.set((Math.random() - 0.5) * 0.5, m.stone ? -0.5 : -0.15 - Math.random() * 0.3, (Math.random() - 0.5) * 0.5);
      m.size = m.stone ? 0.05 + Math.random() * 0.07 : (up ? 0.6 : 0.2) + Math.random() * 0.4;
      if (grit <= 0 && stones <= 0) return;
    }
  }

  /** Where the collapse began (arcade-local x): pieces wholly beyond it stay up. */
  origin = Infinity;

  /** Advance: pieces whose far end the front has passed (it moves toward −x) give way. */
  update(dt: number, front: number, stopAt = -Infinity) {
    for (const p of this.pieces) {
      if (p.state === 'solid' && front < p.x1 - 0.4 && p.x1 > stopAt && p.x0 < this.origin) {
        p.state = 'shaking'; p.t = 0;
        const w = p.pivot.parent!.localToWorld(p.rest.clone());
        this.shed(w, 6, 3);
        this.onBreak?.(w);
      }
      if (p.state === 'shaking') {
        p.t += dt;
        const k = Math.min(1, p.t / 0.45);
        p.pivot.position.copy(p.rest).add(new THREE.Vector3((Math.random() - 0.5) * 0.05 * k, -0.08 * k, (Math.random() - 0.5) * 0.05 * k));
        p.pivot.rotation.set(0.04 * k * Math.sin(p.t * 40), 0, 0.03 * k);
        if (Math.random() < dt * 10) this.shed(p.pivot.getWorldPosition(_w), 1, 0);
        if (p.t > 0.45) {
          p.state = 'falling'; p.t = 0;
          p.vel.set((Math.random() - 0.5) * 0.6, -0.5, (Math.random() - 0.5) * 1.2);
          p.spin.set((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.4);
          this.shed(p.pivot.getWorldPosition(_w), 8, 5);
        }
      } else if (p.state === 'falling') {
        p.t += dt;
        p.vel.y -= 9.8 * dt;
        p.pivot.position.addScaledVector(p.vel, dt);
        p.pivot.rotation.x += p.spin.x * dt; p.pivot.rotation.y += p.spin.y * dt; p.pivot.rotation.z += p.spin.z * dt;
        // It comes to rest on the ground below as rubble.
        if (p.pivot.getWorldPosition(_w).y < this.groundY + 0.3 || p.t > 5) {
          p.state = 'down';
          const at = _w.clone();
          at.y = this.groundY + 0.4;
          this.shed(at, 10, 0, true);
          this.onLand?.(at);
        }
      }
    }
    this.drift(dt);
  }

  private drift(dt: number) {
    for (const m of this.motes) {
      if (m.life <= 0) { m.sp.visible = false; continue; }
      m.life -= dt / (m.stone ? 2.4 : 3.2);
      if (m.stone) m.v.y -= 9.8 * dt;
      else { m.v.multiplyScalar(Math.exp(-dt * 1.3)); m.v.y -= 0.12 * dt; }
      m.sp.position.addScaledVector(m.v, dt);
      if (m.stone && m.sp.position.y < this.groundY) m.life = 0;
      m.sp.visible = m.life > 0;
      const grow = m.stone ? 1 : 1 + (1 - m.life) * 1.5;
      m.sp.scale.setScalar(m.size * grow * Math.min(1, m.life * 3));
    }
  }

  /** Put every piece back (a rewound attempt). */
  reset() {
    for (const p of this.pieces) {
      p.state = 'solid'; p.t = 0;
      p.pivot.position.copy(p.rest);
      p.pivot.rotation.set(0, 0, 0);
    }
    for (const m of this.motes) { m.life = 0; m.sp.visible = false; }
  }
}
