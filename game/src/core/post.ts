import * as THREE from 'three/webgpu';
import {
  pass, uniform, Fn, vec3, vec4, float, mix, smoothstep, length, screenUV, luminance, color, max, abs,
  renderOutput, texture3D, rtt, vec2, int, sin, exp, time, mx_worley_noise_vec2, mx_fractal_noise_float,
  texture, If, floor, fract, dot, sqrt, hash, step, min, getViewPosition, uniform as u2, screenSize,
} from 'three/tsl';
import { TERRAIN_SIZE } from '../world/terrain';
import { ghost } from './ghost';
import { dof } from 'three/examples/jsm/tsl/display/DepthOfFieldNode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { film } from 'three/examples/jsm/tsl/display/FilmNode.js';
import { godrays } from 'three/examples/jsm/tsl/display/GodraysNode.js';
import { bilateralBlur } from 'three/examples/jsm/tsl/display/BilateralBlurNode.js';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { lut3D } from 'three/examples/jsm/tsl/display/Lut3DNode.js';
import { radialBlur } from 'three/examples/jsm/tsl/display/radialBlur.js';
import { Quality } from './quality';
import { PALETTE } from './palette';
import { buildGradeLut } from './grade';
import { uDirectSun } from '../world/atmosphere';

/**
 * Look chain: scene + light shafts -> depth of field -> warm bloom (cheap halation)
 * -> tone shaping -> tone map -> film-matched LUT -> grain.
 */
export function createPost(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, q: Quality,
  sun?: THREE.DirectionalLight) {
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false; // tone map ourselves so the LUT works display-referred
  const scenePass = pass(scene, camera, { samples: q.tier === 'high' ? 4 : 0 });
  const sceneColor = scenePass.getTextureNode('output');
  // Small-scale contact shading grounds feet, roots and loose masonry. Reconstruct normals
  // from the existing depth buffer: no extra scene render or normal attachment. Low quality
  // keeps the existing shadow maps and baked AO without the contact-shading passes.
  const uContact = uniform(0.34);
  let contact: ReturnType<typeof ao> | null = null;
  let sceneLit: any = sceneColor;
  if (q.tier === 'high') {
    // GTAO gathers adjacent depth samples, which WebGPU cannot do on an MSAA texture.
    // Copy depth to a single-sample R32F target, keeping depth precision and scene MSAA.
    const contactDepth = rtt(vec4(scenePass.getTextureNode('depth').r), null, null,
      { type: THREE.FloatType, format: THREE.RedFormat, depthBuffer: false });
    contactDepth.value.minFilter = contactDepth.value.magFilter = THREE.NearestFilter;
    // Three supports reconstructing normals when null; its current typings omit that case.
    contact = ao(contactDepth, null as any, camera);
    contact.resolutionScale = 0.5;
    contact.radius.value = 0.22;
    contact.thickness.value = 0.18;
    contact.samples.value = 16;
    const soft: any = bilateralBlur(contact.getTextureNode(), vec2(1), 2, 0.15);
    const near = smoothstep(38.0, 12.0, scenePass.getViewZNode().negate());
    sceneLit = vec4(vec3(sceneColor.rgb).mul(mix(float(1), soft.r, uContact.mul(near))), sceneColor.a);
  }
  /**
   * What she perceives rather than sees (the grove's trail of small steps): its own layer,
   * over everything and not hidden by it, faint with her eyes open and clear behind her lids.
   */
  const memoryScene = new THREE.Scene();
  const memory = pass(memoryScene, camera).getTextureNode('output');

  const uFocus = uniform(3.0);
  const uFocusRange = uniform(1.1);
  const uBokeh = uniform(q.dof ? 7.0 : 0);
  const uGrain = uniform(0.035);
  const uVignette = uniform(0.35);
  /** 0 = eyes open, 1 = closed: lids meet, only glow (port, light through the lids) remains. */
  const uEyesClosed = uniform(0);

  const uRays = uniform(q.rays ? 0.6 : 0.0);
  /** Sun position in screen UV, and how much the camera faces it (0..1); set each frame. */
  const uSunUV = uniform(new THREE.Vector2(0.5, 0.2));
  const uSunFacing = uniform(0);
  const uShafts = uniform(1.0);
  /** Bokeh discs (cutscenes): brightness above which a point opens into a disc, and their gain. */
  const uBokehLo = uniform(3.5), uBokehGain = uniform(0.85);
  /** Shaft shaping: the sun-core mask's range, the streaks' gain, the marched rays' floor. */
  const uMaskLo = uniform(2.5), uMaskHi = uniform(6.0), uShaftGain = uniform(1.15), uRayLo = uniform(0.2);
  const uGrade = uniform(1.0);
  /** Memory echo seen through closed lids: screen uv (x, y) and strength (z). */
  const uEcho = uniform(new THREE.Vector3(0.5, 0.5, 0));
  /** 0..1: afterimage ghosting — what moves leaves a fading trace (running, memory, cost). */
  const uAfter = uniform(0);
  /** Accessibility: scales the afterimage trails and the drain fracture (core/access.ts). */
  const uFx = uniform(1);
  /** Photo mode: saturation and tint of the graded image. */
  const uSat = uniform(1);
  const uTint = uniform(new THREE.Color(1, 1, 1));
  /** 0..1: the cost of her power — fractures spread across the view and colour drains out. */
  const uDrain = uniform(0);
  const uDrainRaw = uDrain;
  /**
   * A colour flood (after Control's red rooms): for a few seconds at a peak the whole frame goes
   * to one colour, shadows dark in it and lights bright. uFloodK is how far (0..1).
   */
  const uFlood = uniform(new THREE.Color(0x4fd8ff));
  const uFloodK = uniform(0);
  /** 0..1: how much warmth the found afterimages have brought back (ochre in the light). */
  const uWarm = uniform(0);
  /**
   * Exposure before tone mapping and how much of the S-curve applies, base saturation (before
   * the LUT) and the olive lift in the shadows. Matched against the reference boards and the
   * films' frames (median brightness, darkest and brightest 5%, saturation): real blacks under
   * the haze, mid-tones lower, colour a little richer.
   */
  const uExposure = uniform(0.6);
  const uContrast = uniform(1.1);
  const uSatBase = uniform(0.86);
  const uLift = uniform(0.005);
  let knownTimer = 0;

  // Everything that doesn't depend on the picture so far is built once and shared by both
  // chains below.
  // Light shafts: raymarched through the sun's shadow map, so gaps between branches cast beams.
  // Added after depth of field (they are soft already) and before bloom (so they glow).
  let rays: any = null;
  let shaftRays: any = null;
  // Off: marched through a shadow map that covers only ~32 m round her, they came out as an
  // even glow rather than beams (everything past the map counts as lit air), for a 48-step pass.
  // The beams come from the screen-space shafts below. Set MARCHED_RAYS to try them again.
  const MARCHED_RAYS = false;
  if (MARCHED_RAYS && q.rays && sun) {
    rays = godrays(scenePass.getTextureNode('depth'), camera as THREE.PerspectiveCamera, sun);
    rays.raymarchSteps.value = 48;
    rays.density.value = 0.55;
    rays.maxDensity.value = 0.42;
    rays.distanceAttenuation.value = 1.4;
    const soft: any = bilateralBlur(rays.getTextureNode());
    // Only the strongest of it: lit air between shadowed air reads as beams; an even fill of
    // it is just more haze.
    shaftRays = smoothstep(uRayLo, uRayLo.add(0.45), float(soft.r)).mul(uRays).mul(1.6);
  }

  // Sun shafts: the open sky round the sun, cut by trunks and branches, drawn out radially from
  // it into beams.
  const viewZ = scenePass.getViewZNode();
  // What casts the beams: how much open sky shows round the sun (not how bright it is), so
  // every trunk and branch against it leaves a dark gap that the radial blur draws out into a
  // shadow between beams. Weighted toward the sun, and toward its hot core.
  const skyMask = Fn(() => {
    const far = smoothstep(25.0, 70.0, viewZ.negate());
    const d = length(screenUV.sub(uSunUV).mul(vec2(1.6, 1.0)));
    const around = exp(d.mul(d).mul(-6.0));
    const core = smoothstep(uMaskLo, uMaskHi, luminance(vec3(sceneColor.rgb)));
    return vec4(vec3(far.mul(around).mul(core.mul(0.6).add(0.4))), 1.0);
  })();
  // (Both at reduced resolution: the shafts are soft, and the blur is many taps per pixel.)
  const maskTex = rtt(skyMask, null, null, { resolutionScale: 0.5 });
  const shaftsBlur: any = radialBlur(maskTex, {
    center: uSunUV, weight: float(0.9), decay: float(0.975), count: int(q.tier === 'high' ? 56 : 28), exposure: float(4.0),
  });
  const shafts: any = rtt(vec4(vec3(float(shaftsBlur.r)), 1.0), null, null, { resolutionScale: 0.33 });
  // The same, tiny: its smooth falloff. Beams are what stands above it (lit air between the
  // shadows of trunks and branches); the falloff itself is only a little glow.
  const shaftsLow: any = rtt(vec4(vec3(float(shafts.r)), 1.0), null, null, { resolutionScale: 0.04 });

  const PAINTERLY = false;
  const uPaint = uniform(PAINTERLY ? 1 : 0);

  // The world exists where she remembers. Toward the edges of what she knows the picture comes
  // apart into shards anchored in the world (Voronoi cells about two metres across): they shift
  // and turn a little, crack along their edges where the light catches, and here and there are
  // missing, opening onto a pale void. Places she has been stay whole (the `known` map), and it
  // all reassembles as she comes near. The sky is left alone.
  const KNOWN_RES = 128;
  const knownData = new Uint8Array(KNOWN_RES * KNOWN_RES * 4);
  const knownTex = new THREE.DataTexture(knownData, KNOWN_RES, KNOWN_RES, THREE.RGBAFormat);
  knownTex.magFilter = THREE.LinearFilter; knownTex.minFilter = THREE.LinearFilter;
  knownTex.needsUpdate = true;
  const uFrag = uniform(1);
  const uHer = uniform(new THREE.Vector3());
  const uProjInv = u2(new THREE.Matrix4());
  const uCamWorld = u2(new THREE.Matrix4());
  const lut = buildGradeLut();
  const lutTex = texture3D(lut);

  /**
   * The look chain on the scene pass. Built twice: with depth of field (cutscene shots that ask
   * for shallow focus) and without (play keeps the landscape sharp, and the blur's passes cost
   * most of a millisecond even at zero). Each frame renders whichever is needed (render()).
   */
  const chain = (withDof: boolean) => {
    let c: any = sceneLit;
    if (withDof) {
      c = dof(sceneLit, scenePass.getViewZNode(), uFocus, uFocusRange, uBokeh);
      // Bokeh: out of focus, the brightest points (sun glitter on water and wet ground, the
      // port's glow) open into soft even discs, as through the films' lenses. The blur above
      // only smears them. Bright, defocused points at quarter resolution, gathered over a disc
      // of 32 taps whose size follows the shot's blur.
      const vz = scenePass.getViewZNode();
      const bright: any = rtt(Fn(() => {
        const col = vec3(sceneColor.rgb);
        const lum = luminance(col);
        const coc = smoothstep(0.6, 1.6, abs(vz.negate().sub(uFocus)).div(max(uFocusRange, 0.05)));
        // Surfaces only (not the sun's disc in the sky), and only true glints: the mirrored sky
        // on the water is capped well below them.
        const surface = smoothstep(160.0, 90.0, vz.negate());
        return vec4(col.mul(max(lum.sub(uBokehLo), 0.0).div(max(lum, 1e-3))).mul(coc).mul(surface), 1.0);
      })(), null, null, { resolutionScale: 0.25 });
      const discs: any = rtt(Fn(() => {
        const sum = vec3(0).toVar();
        const radius = vec2(uBokeh.mul(2.4)).div(screenSize);
        for (let k = 0; k < 32; k++) {
          const a = k * 2.39996, rr = Math.sqrt((k + 0.5) / 32);
          sum.addAssign(vec3(bright.sample(screenUV.add(vec2(Math.cos(a) * rr, Math.sin(a) * rr).mul(radius))).rgb));
        }
        return vec4(sum.div(32.0), 1.0);
      })(), null, null, { resolutionScale: 0.25 });
      c = vec4(vec3(c.rgb).add(vec3(discs.rgb).mul(uBokehGain)), 1.0);
    }
    if (shaftRays) c = vec4(vec3(c.rgb).add(color(PALETTE.sun).mul(shaftRays)), 1.0);
    // Beams show against what's near and darker, not added onto the bright sky as a veil; the
    // blur's own smooth falloff is pressed down so the gaps between beams stay dark.
    const beams = max(float(shafts.r).sub(float(shaftsLow.r).mul(0.85)), 0.0).mul(3.0).add(float(shafts.r).mul(0.12));
    // Scattering accumulates through air. Applying the full shaft at the lens washed the
    // face, hair and ceramic into the same beige, even though their fog starts farther away.
    const airPath = smoothstep(1.5, 14.0, viewZ.negate());
    const overNear = airPath.mul(float(1).sub(smoothstep(30.0, 110.0, viewZ.negate()).mul(0.75)));
    c = vec4(vec3(c.rgb).add(color(PALETTE.sun).mul(beams.mul(uShafts).mul(uSunFacing).mul(uShaftGain).mul(uDirectSun).mul(overNear))), 1.0);

    // Painterly distance: far off, the picture flattens into strokes (a small Kuwahara filter: of
    // four overlapping sectors round each pixel, take the mean of the calmest), so the distance
    // reads as painted rather than rendered. Near her it's left alone; the sky too.
    // Off: it softened the landscape the world is built to show. Left out of the graph entirely
    // (it costs two passes even at zero); set PAINTERLY to try it again.
    if (PAINTERLY) {
      const src: any = rtt(c);
      // The filter runs at half resolution (its strokes are broad anyway) and is blended in at full
      // resolution by distance, so near her nothing is softened.
      const strokes: any = rtt(Fn(() => {
        const base = vec3(src.rgb).toVar();
        const vz = viewZ.negate();
        const k = smoothstep(14.0, 60.0, vz).mul(step(vz, 260.0)).mul(uPaint).toVar();
        If(k.greaterThan(0.02), () => {
          const px = vec2(1).div(screenSize).mul(k.mul(0.7).add(0.4));
          const bestVar = float(1e9).toVar(), bestMean = vec3(0).toVar();
          for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const sum = vec3(0).toVar(), sq = vec3(0).toVar();
            for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) {
              const s = vec3(src.sample(screenUV.add(vec2(i * sx, j * sy).mul(px))).rgb);
              sum.addAssign(s); sq.addAssign(s.mul(s));
            }
            const mean = sum.div(9.0);
            const v = sq.div(9.0).sub(mean.mul(mean));
            const vv = v.x.add(v.y).add(v.z);
            If(vv.lessThan(bestVar), () => { bestVar.assign(vv); bestMean.assign(mean); });
          }
          base.assign(bestMean);
        });
        return vec4(base, 1.0);
      })(), null, null, { resolutionScale: 0.5 });
      const painted = Fn(() => {
        const vz = viewZ.negate();
        const k = smoothstep(14.0, 60.0, vz).mul(step(vz, 260.0)).mul(uPaint);
        return vec4(mix(vec3(src.rgb), vec3(strokes.rgb), k.mul(0.9)), 1.0);
      })();
      c = painted;
    }

    {
      const cTex: any = rtt(c);
      const depth = scenePass.getTextureNode('depth');
      const fragmented = Fn(() => {
        const base = vec3(cTex.rgb).toVar();
        const vz = viewZ.negate();
        const view = getViewPosition(screenUV, depth, uProjInv);
        const world = uCamWorld.mul(vec4(view, 1.0)).xyz;
        const dist = length(world.xz.sub(uHer.xz));
        const known = texture(knownTex, world.xz.div(TERRAIN_SIZE).add(0.5)).r;
        // Only the land comes apart: what hangs high in the sky (her echoes, the inverted world) has
        // its own way of breaking.
        // Only far off (beyond about 70 m, fully by 150 m): the landscape round her stays whole and sharp.
        const f = smoothstep(70.0, 150.0, dist).mul(float(1).sub(known.mul(0.8))).mul(step(vz, 260.0)).mul(smoothstep(30.0, 14.0, world.y.sub(uHer.y))).mul(uFrag).toVar();
        If(f.greaterThan(0.002), () => {
          // Voronoi in world space: the nearest and second-nearest seeds, and the nearest cell.
          // Shards grow with distance: a few big pieces far off, not a scatter of chips.
          const p = world.mul(float(0.5).div(dist.mul(0.035).add(1.0)));
          const ip = floor(p), fp = fract(p);
          const best = float(8).toVar(), second = float(8).toVar(), id = vec3(0).toVar();
          const seed = (q: any, k: number) => hash(q.x.add(1000).add(q.y.add(1000).mul(2311)).add(q.z.add(1000).mul(5717)).add(k * 7919));
          for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
            const cell = ip.add(vec3(x, y, z));
            const r = vec3(x, y, z).add(vec3(seed(cell, 1), seed(cell, 2), seed(cell, 3))).sub(fp);
            const d = dot(r, r);
            If(d.lessThan(best), () => { second.assign(best); best.assign(d); id.assign(cell); })
              .ElseIf(d.lessThan(second), () => { second.assign(d); });
          }
          const edge = sqrt(second).sub(sqrt(best));
          const r1 = seed(id, 4), r2 = seed(id, 5), r3 = seed(id, 6);
          // Each shard drifts a little out of place, slowly, more the further gone it is.
          const drift = vec2(r1.sub(0.5), r2.sub(0.5)).mul(0.05).add(vec2(sin(time.mul(0.31).add(r3.mul(6.28))), sin(time.mul(0.23).add(r1.mul(6.28)))).mul(0.006)).mul(f);
          // A shard only shows what lies at its own depth or beyond: where the shifted sample lands
          // on something much nearer (her, the thorns at her side), it stays put, so nothing in the
          // foreground is copied into the distance.
          const suv = screenUV.add(drift);
          const sz = getViewPosition(suv, depth.sample(suv).r, uProjInv).z.negate();
          const keep = smoothstep(vz.mul(0.6), vz.mul(0.85), sz);
          const shard = vec3(mix(cTex.rgb, cTex.sample(suv).rgb, keep)).mul(float(1).add(r3.sub(0.5).mul(0.12).mul(f)));
          const voidCol = color(PALETTE.haze).mul(1.08);
          const missing = step(r3, f.mul(0.32).sub(0.06));
          const crack = smoothstep(f.mul(0.05).add(0.004), 0.0, edge);
          const lit = mix(shard, voidCol, missing);
          base.assign(mix(base, lit, smoothstep(0.0, 0.15, f)));
          // The broken edges catch the light, pale and a little cool.
          base.assign(base.add(vec3(0.9, 0.95, 1.0).mul(crack.mul(f).mul(0.35))));
        });
        return vec4(base, 1.0);
      })();
      c = fragmented;
    }

    // Afterimages: the frame blended over its own recent past, warmed a little (a trace on the eye).
    {
      const after = uAfter.mul(uFx);
      const trail: any = ghost(c, after.mul(0.88));
      const tex = trail.getTextureNode();
      c = vec4(mix(vec3(c.rgb), vec3(tex.rgb).mul(vec3(1.04, 0.97, 0.9)), after.mul(0.85)), 1.0);
    }

    const b = bloom(c, 0.25, 0.4, 2.0);

    const graded = Fn(() => {
      const col = vec3(c.rgb).add(vec3(b.rgb).mul(vec3(1.0, 0.86, 0.7))).toVar();
      // Restrain saturation, keep localized cyan alive.
      const lum = luminance(col);
      col.assign(mix(vec3(lum), col, uSatBase));
      // Bright warm light (a dusk sun on skin) loses a little colour as it climbs, as film does,
      // so it glows gold rather than burning orange.
      col.assign(mix(col, vec3(luminance(col)), smoothstep(0.35, 1.6, luminance(col)).mul(0.22)));
      // Lift shadows toward olive.
      const lift = color(PALETTE.hazeDeep).mul(uLift);
      col.assign(col.add(lift.mul(float(1).sub(smoothstep(0.0, 0.25, lum)))));
      // Exposure, then an S-curve around mid-grey (pre-tonemap, log-ish): holds darks in the haze.
      col.assign(col.mul(uExposure));
      const k = col.div(col.add(0.18)).toVar();
      const curved = k.mul(k).mul(float(3).sub(k.mul(2)));
      col.assign(mix(col, curved.mul(0.18).div(float(1.0001).sub(curved)), uContrast));
      // Soft vignette.
      const d = length(screenUV.sub(0.5).mul(vec3(1.25, 1.0, 0).xy));
      col.assign(col.mul(mix(float(1), float(1).sub(uVignette), smoothstep(0.35, 0.95, d))));
      // Eyelids: an opening band that narrows to nothing; glow bleeds through, warmed like skin.
      const open = float(1).sub(uEyesClosed);
      const half = open.mul(0.65).sub(0.03);
      const lids = smoothstep(half.add(open.mul(0.12).add(0.02)), half, abs(screenUV.y.sub(0.5)));
      const through = vec3(b.rgb).mul(vec3(1.0, 0.72, 0.62)).mul(uEyesClosed.mul(1.3));
      col.assign(col.mul(lids).add(through));
      // Through closed lids: a warm afterimage of light where a memory waits (edge-clamped when
      // it's behind her), breathing slowly.
      const ed = length(screenUV.sub(vec3(uEcho.x, uEcho.y, 0).xy).mul(vec3(1.6, 1.0, 0).xy));
      const breath = sin(time.mul(1.3)).mul(0.2).add(0.8);
      const echo = exp(ed.mul(ed).mul(-9.0)).mul(0.5).add(exp(ed.mul(ed).mul(-60.0)).mul(0.5));
      col.assign(col.add(vec3(1.0, 0.66, 0.34).mul(echo).mul(uEcho.z).mul(uEyesClosed).mul(breath).mul(0.45)));
      col.assign(col.add(vec3(memory.rgb).mul(mix(float(0.55), float(1.5), uEyesClosed))));
      // The cost of her power: colour drains toward grey and hairline fractures spread in from the
      // edges of the view, lit faintly cyan (what she is spending), a little further each moment.
      {
        const uDrain = uDrainRaw.mul(uFx);
        const p = screenUV.sub(0.5).mul(vec2(1.78, 1.0));
        const warp = mx_fractal_noise_float(vec3(p.mul(3.0), 0.5), 2, 2, 0.5).mul(0.06);
        const cells = mx_worley_noise_vec2(p.mul(6.0).add(warp));
        const fine = mx_worley_noise_vec2(p.mul(15.0).add(warp.mul(2)));
        // Only some cell edges crack, in broken runs, with finer splinters off them.
        const runs = smoothstep(0.05, 0.45, mx_fractal_noise_float(vec3(p.mul(2.6), 3.1), 3, 2, 0.5));
        const splinter = smoothstep(0.025, 0.0, fine.y.sub(fine.x)).mul(smoothstep(0.35, 0.7, mx_fractal_noise_float(vec3(p.mul(5.0), 7.7), 2, 2, 0.5)));
        const edge = max(smoothstep(0.03, 0.0, cells.y.sub(cells.x)).mul(runs), splinter.mul(0.6));
        const reach = smoothstep(float(1.05).sub(uDrain.mul(0.9)), float(1.25).sub(uDrain.mul(0.9)), length(p).add(warp));
        const crack = edge.mul(reach).mul(uDrain);
        const grey = vec3(luminance(col)).mul(vec3(0.95, 0.97, 1.0));
        col.assign(mix(col, grey, uDrain.mul(0.75)));
        col.assign(col.mul(float(1).sub(crack.mul(0.6))).add(vec3(0.62, 0.86, 1.0).mul(crack.mul(0.22))));
      }
      {
        const l = luminance(col);
        const fc = uFlood as any;
        const flooded = mix(fc.mul(0.06), fc.mul(1.25), smoothstep(0.02, 0.85, l));
        col.assign(mix(col, flooded, uFloodK.mul(uFx)));
      }
      // Warmth returned by what she has remembered: a little ochre in the light.
      const warmMask = smoothstep(0.08, 0.7, luminance(col));
      col.assign(col.mul(mix(vec3(1), vec3(1.07, 1.0, 0.88), warmMask.mul(uWarm))));
      // Photo mode's look: saturation and a tint (1 and white otherwise).
      col.assign(mix(vec3(luminance(col)), col, uSat).mul(uTint));
      return vec4(max(col, vec3(0)), 1.0);
    })();

    // Tone map + sRGB, then the film-matched grade (a LUT built from measured statistics).
    // Explicit: the pipeline disables renderer tone mapping while it runs.
    const display = renderOutput(graded, THREE.AgXToneMapping, THREE.SRGBColorSpace);
    const gradedDisplay = lut3D(display, lutTex, lut.image.width, uGrade);
    return film(gradedDisplay, uGrain);
  };
  pipeline.outputNode = chain(q.dof);
  const sharp = q.dof ? new THREE.RenderPipeline(renderer) : null;
  if (sharp) {
    sharp.outputColorTransform = false;
    sharp.outputNode = chain(false);
  }

  return {
    pipeline,
    memoryScene,
    uFocus, uFocusRange, uBokeh, uGrain, uVignette, uEyesClosed, uRays, uGrade, rays, uShafts, uEcho, uWarm, uAfter, uDrain, uFx, uSat, uTint, uContact, contact,
    uFrag, uPaint, uFlood, uFloodK, uExposure, uContrast, uSatBase, uLift, uMaskLo, uMaskHi, uShaftGain, uRayLo, uBokehLo, uBokehGain,
    /**
     * Each frame: where she is, the camera's matrices for the fragments, and the known map (the
     * places she has been stay whole: a slow stamp round her).
     */
    updateFragments(cam: THREE.PerspectiveCamera, her: THREE.Vector3, dt: number) {
      uProjInv.value.copy(cam.projectionMatrixInverse);
      uCamWorld.value.copy(cam.matrixWorld);
      uHer.value.copy(her);
      knownTimer -= dt;
      if (knownTimer > 0) return;
      knownTimer = 0.3;
      const cx = (her.x / TERRAIN_SIZE + 0.5) * KNOWN_RES, cz = (her.z / TERRAIN_SIZE + 0.5) * KNOWN_RES;
      const R = (14 / TERRAIN_SIZE) * KNOWN_RES;
      let changed = false;
      for (let j = Math.max(0, Math.floor(cz - R)); j <= Math.min(KNOWN_RES - 1, Math.ceil(cz + R)); j++) {
        for (let i = Math.max(0, Math.floor(cx - R)); i <= Math.min(KNOWN_RES - 1, Math.ceil(cx + R)); i++) {
          const d = Math.hypot(i - cx, j - cz) / R;
          if (d >= 1) continue;
          const k = (j * KNOWN_RES + i) * 4;
          const v = Math.round(255 * Math.min(1, (1 - d) * 1.6));
          if (v > knownData[k]) { knownData[k] = v; changed = true; }
        }
      }
      if (changed) knownTex.needsUpdate = true;
    },
    /** Call each frame before render: where the sun sits on screen. */
    trackSun(cam: THREE.Camera, sunDir: THREE.Vector3) {
      const p = cam.getWorldPosition(new THREE.Vector3()).addScaledVector(sunDir, 1000).project(cam);
      uSunUV.value.set(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
      const fwd = cam.getWorldDirection(new THREE.Vector3());
      // Full strength looking into the sun, gone once it's well off screen.
      uSunFacing.value = THREE.MathUtils.smoothstep(fwd.dot(sunDir), 0.15, 0.75);
    },
    render() {
      (sharp && uBokeh.value < 0.01 ? sharp : pipeline).render();
    },
    /** Compile both chains (at load, so the first cutscene doesn't hitch). */
    warm() {
      pipeline.render();
      sharp?.render();
    },
  };
}
