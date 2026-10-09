/** CPU-only locomotion diagnostic using the shipped skeleton (no renderer or textures). */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Player } from '../src/player/player';
import { heightAt } from '../src/world/terrain';
import { legPhases, stanceEnd } from '../src/player/animator';
import { MOTIONS, motionInput, type Motion } from '../src/dev/motionScenarios';

// Strip image/material payloads only; preserve the exported geometry, bones and skinning.
const src = readFileSync('public/models/woman.glb');
const jsonLength = src.readUInt32LE(12);
const doc = JSON.parse(src.subarray(20, 20 + jsonLength).toString());
delete doc.images; delete doc.textures; delete doc.samplers; delete doc.materials;
doc.extensionsRequired = doc.extensionsRequired.filter((x: string) => x !== 'EXT_texture_webp');
for (const mesh of doc.meshes) for (const p of mesh.primitives) delete p.material;
const json = Buffer.from(JSON.stringify(doc));
const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
const binary = src.subarray(20 + jsonLength);
const glb = Buffer.alloc(20 + padded.length + binary.length);
glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16);
padded.copy(glb, 20); binary.copy(glb, 20 + padded.length);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

async function fixture() {
  const gltf = await loader.parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  const model = gltf.scene; model.updateMatrixWorld(true);
  const hipsHeight = model.getObjectByName('Hips')!.getWorldPosition(new THREE.Vector3()).y;
  const root = new THREE.Group(), pivot = new THREE.Group();
  pivot.position.y = hipsHeight; model.position.y = -hipsHeight; pivot.add(model); root.add(pivot);
  const p = new Player(new THREE.Scene(), { root, pivot, hipsHeight, fingertip: model.getObjectByName('RightIndexTip')! });
  const soles: { mesh: THREE.SkinnedMesh; indices: number[] }[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const joints = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
    const indices: number[] = [];
    for (let i = 0; i < joints.count; i += 8) {
      let weight = 0;
      for (let k = 0; k < 4; k++) {
        const name = mesh.skeleton.bones[joints.getComponent(i, k)]?.name ?? '';
        if (/^(Left|Right)(Foot|ToeBase)$/.test(name)) weight += weights.getComponent(i, k);
      }
      if (weight > 0.8) indices.push(i);
    }
    if (indices.length) soles.push({ mesh, indices });
  });
  return { p, root, soles };
}

for (const fps of [30, 60, 120]) for (const running of [false, true]) {
  const { p, root, soles } = await fixture();
  p.place(new THREE.Vector3(0, 0, 7), Math.PI); p.controllable = true;
  const input = { move: { x: 0, y: 1 }, running, touch: false } as any;
  let minClearance = Infinity, maxStanceClearance = -Infinity, maxSlip = 0, samples = 0;
  let minHip = Infinity, maxHip = -Infinity, maxKneeDeviation = 0;
  let minSoleClearance = Infinity;
  const last: Record<string, THREE.Vector3> = {};
  for (let i = 0; i < fps * 6; i++) {
    p.update(1 / fps, i / fps, input, 0);
    root.updateMatrixWorld(true);
    const phases = legPhases(p.pose.phase), end = stanceEnd(p.pose.speed, p.pose.run);
    if (i < fps * 2) continue;
    if (i % Math.max(1, Math.round(fps / 15)) === 0) {
      for (const { mesh, indices } of soles) for (const index of indices) {
        const v = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
        minSoleClearance = Math.min(minSoleClearance, v.y - heightAt(v.x, v.z));
      }
    }
    const hip = p.rig.get('Hips').getWorldPosition(new THREE.Vector3()).y - p.position.y;
    minHip = Math.min(minHip, hip); maxHip = Math.max(maxHip, hip);
    for (const side of ['Left', 'Right'] as const) {
      const foot = p.rig.get(`${side}Foot`).getWorldPosition(new THREE.Vector3());
      const knee = p.rig.get(`${side}Leg`).getWorldPosition(new THREE.Vector3());
      const upper = p.rig.get(`${side}UpLeg`).getWorldPosition(new THREE.Vector3());
      const clearance = foot.y - heightAt(foot.x, foot.z) - p.rig.legs.ankle;
      minClearance = Math.min(minClearance, clearance);
      const phase = side === 'Left' ? phases.L : phases.R;
      if (phase > 0.1 && phase < end - 0.12) {
        maxStanceClearance = Math.max(maxStanceClearance, clearance);
        if (last[side]) maxSlip = Math.max(maxSlip, Math.hypot(foot.x - last[side].x, foot.z - last[side].z));
        samples++;
      }
      maxKneeDeviation = Math.max(maxKneeDeviation, Math.abs(knee.x - (upper.x + foot.x) * 0.5));
      last[side] = foot;
    }
  }
  const report = { gait: running ? 'run' : 'walk', fps, minAnkleClearance: +minClearance.toFixed(4),
    maxMidStanceClearance: +maxStanceClearance.toFixed(4), maxMidStanceSlipPerFrame: +maxSlip.toFixed(4),
    minSoleClearance: +minSoleClearance.toFixed(4),
    hipExcursion: +(maxHip - minHip).toFixed(4), maxKneeLateralDeviation: +maxKneeDeviation.toFixed(4), samples };
  console.log(JSON.stringify(report));
  assert(Number.isFinite(maxHip) && samples > 10, 'gait produced finite, observable contacts');
  assert(minClearance > -0.012, `${report.gait}: ankle penetrated the ground`);
  assert(minSoleClearance > -0.02, `${report.gait}: the skinned foot penetrated the terrain by more than 2 cm`);
  assert(maxStanceClearance < 0.025, `${report.gait}: support foot floated above the ground`);
  assert(maxSlip * fps < 0.25, `${report.gait}: planted foot slid faster than 25 cm/s`);
  assert(maxHip - minHip < (running ? 0.11 : 0.08), `${report.gait}: excessive pelvis excursion`);
  // The same skeleton must still support the prologue's non-locomotion poses.
  input.move.y = 0; p.controllable = false;
  for (const pose of [{ kneel: 1, lie: 0 }, { kneel: 0, lie: 1 }, { kneel: 0, lie: 0 }]) {
    Object.assign(p.pose, pose);
    for (let i = 0; i < fps; i++) p.update(1 / fps, 7 + i / fps, input, 0);
    p.root.updateMatrixWorld(true);
    for (const bone of p.rig.bones.values()) {
      assert(bone.matrixWorld.elements.every(Number.isFinite), `invalid ${bone.name} in story pose`);
    }
  }
}

// Transitions used to be invisible here: the steady-gait check discards the first two seconds.
// Track actual skinned soles and world-space foot motion, including the final settled stance.
for (const fps of [30, 60, 120]) for (const mode of ['start-stop', 'walk-run', 'turns', 'slope'] as Motion[]) {
  const { p, root, soles } = await fixture();
  const scenario = MOTIONS[mode];
  p.place(new THREE.Vector3(scenario.start[0], 0, scenario.start[1]), Math.PI);
  p.controllable = true;
  const last = new Map<string, { pos: THREE.Vector3; q: THREE.Quaternion; phase: number }>();
  let minSole = Infinity, maxSlip = 0, maxSpin = 0, maxYawRate = 0, idleDrift = 0, maxFootSpeed = 0;
  let yaw = p.yaw;
  let fastest: unknown;
  for (let i = 0; i < fps * scenario.seconds; i++) {
    const t = i / fps;
    p.update(1 / fps, t, motionInput(mode, t) as any, 0);
    root.updateMatrixWorld(true);
    maxYawRate = Math.max(maxYawRate, Math.abs(Math.atan2(Math.sin(p.yaw - yaw), Math.cos(p.yaw - yaw))) * fps);
    yaw = p.yaw;
    const phase = legPhases(p.pose.phase), end = stanceEnd(p.pose.speed, p.pose.run);
    for (const side of ['Left', 'Right'] as const) {
      const pos = p.rig.get(`${side}Foot`).getWorldPosition(new THREE.Vector3());
      const q = p.rig.get(`${side}Foot`).getWorldQuaternion(new THREE.Quaternion());
      const ph = side === 'Left' ? phase.L : phase.R, prev = last.get(side);
      if (prev) {
        const footSpeed = pos.distanceTo(prev.pos) * fps;
        if (footSpeed > maxFootSpeed) {
          maxFootSpeed = footSpeed;
          fastest = { t: +t.toFixed(3), side, phase: +ph.toFixed(3), previous: +prev.phase.toFixed(3), speed: +p.pose.speed.toFixed(3) };
        }
        const slip = Math.hypot(pos.x - prev.pos.x, pos.z - prev.pos.z) * fps;
        if (ph > 0.12 && ph < end - 0.12 && prev.phase > 0.1 && p.pose.speed > 0.25) {
          maxSlip = Math.max(maxSlip, slip);
          const delta = q.clone().multiply(prev.q.clone().invert());
          const angle = 2 * Math.atan2(delta.y, delta.w);
          maxSpin = Math.max(maxSpin, Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) * fps);
        }
        if (t > scenario.seconds - 0.5 && p.pose.speed < 0.01) idleDrift = Math.max(idleDrift, slip);
      }
      last.set(side, { pos, q, phase: ph });
    }
    if (i % Math.max(1, Math.round(fps / 15)) === 0) for (const { mesh, indices } of soles) for (const index of indices) {
      const v = mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      minSole = Math.min(minSole, v.y - heightAt(v.x, v.z));
    }
    for (const bone of p.rig.bones.values()) assert(bone.matrixWorld.elements.every(Number.isFinite), `${mode}: invalid ${bone.name}`);
  }
  const round = (n: number) => +n.toFixed(4);
  console.log(JSON.stringify({ scenario: mode, fps, minSole: round(minSole), stanceSlipMps: round(maxSlip),
    stanceSpinRadps: round(maxSpin), maxYawRadps: round(maxYawRate), settledDriftMps: round(idleDrift), maxFootMps: round(maxFootSpeed), fastest }));
  if (!process.env.MOTION_REPORT_ONLY) {
    assert(minSole > -0.03, `${mode}: sole penetrated by more than 3 cm`);
    assert(maxYawRate < 6, `${mode}: abrupt body turn`);
    assert(maxSlip < 0.5, `${mode}: support foot slid faster than 50 cm/s`);
    assert(maxSpin < 1.5, `${mode}: planted foot twisted too quickly`);
    assert(idleDrift < 0.015, `${mode}: feet drifted after settling`);
    assert(maxFootSpeed < 10, `${mode}: foot snapped between poses`);
  }
}

for (const fps of [30, 60, 120]) {
  const { p } = await fixture();
  p.place(new THREE.Vector3(0, 0, 7), Math.PI); p.controllable = true;
  const obstacle = new THREE.Vector2(0, 4);
  p.blockers = [{ a: obstacle, b: obstacle, r: 0.5 }];
  for (let i = 0; i < fps * 5; i++) p.update(1 / fps, i / fps, motionInput('walk', i / fps) as any, 0);
  assert(p.position.z >= 4.719, 'walked through blocker');
  assert(p.pose.speed < 0.01, 'walk cycle kept running while blocked');

  p.controllable = false; p.blockers = [];
  let floor = p.position.y;
  p.floorY = () => floor;
  for (let i = 0; i < fps * 2; i++) {
    floor += 0.35 / fps;
    p.update(1 / fps, 5 + i / fps, { move: { x: 0, y: 0 }, running: false } as any, 0);
  }
  for (const side of ['Left', 'Right'] as const) {
    const y = p.rig.get(`${side}Foot`).getWorldPosition(new THREE.Vector3()).y;
    assert(Math.abs(y - floor - p.rig.legs.ankle) < 0.015, 'foot anchor failed to ride the lift');
  }
  // Story alignment moves set position directly, with the walking controller disabled.
  for (let i = 0; i < fps; i++) {
    p.position.x += 0.6 / fps;
    p.update(1 / fps, 7 + i / fps, { move: { x: 0, y: 0 }, running: false } as any, 0);
  }
  for (const side of ['Left', 'Right'] as const) {
    const foot = p.rig.get(`${side}Foot`).getWorldPosition(new THREE.Vector3());
    assert(Math.hypot(foot.x - p.position.x, foot.z - p.position.z) < 0.3, 'idle anchor stayed behind a scripted move');
  }
  console.log(JSON.stringify({ fps, blocker: 'pass', movingFloor: 'pass', scriptedAlignment: 'pass' }));
}
