# Character pipeline: image-to-3D → Blender → game

For runtime motion checks and matched artwork views, use the [movement and reference study guide](movement-reference.md).

## Automated rig (current)

```bash
blender/rig_character.sh 3D-assets/afterimage-quads.glb game/public/models/woman.glb \
  3D-assets/afterimage-triangles-2m.glb 3D-assets/afterimage-head-triangles.glb
```

**The fourth argument is the head scan.** It replaces the body's head:
- The scan is fitted onto the old head (scaled ICP) and cut at the neck, inside the feather collar that hides the join.
- It's simplified from 1M to 55k triangles, with most of that budget kept on the eyes, nose and mouth.
- Its full-resolution detail is baked into a normal map, and it's skinned by copying the body's weights.

It ships as a second skinned mesh, `WomanHead`, with its own 4K→2K texture, on the same skeleton. The full run takes about 45 s. Pass `-` as the third argument to skip the high-poly body bake.

The third argument is optional. If you pass the 2M high-poly export, its surface relief is baked into the body normal map, which sharpens the ceramic plates. The head, hair, hands and shoulder port keep Tripo's own map, because the two models differ by about 3 mm there and that shows as doubled edges. The run takes about 25 s.

1. `prep_mesh.py`: bakes transforms, scales to 1.65 m, welds UV-seam duplicates and rebuilds quads (45.5k).
2. `landmarks.py`: finds body joints from the mesh shape (crotch gap, neck width, ankle, arm cross-sections).
3. `fingers.py`: fingertips are the farthest points from the wrist measured along the surface; each finger is traced back from its tip.
4. `build_rig.py`: builds the 55-bone skeleton (contract below). It adds the `LeftShoulderPort` socket where the texture turns cyan, and weights the mesh by solving bone-heat on a watertight voxel proxy at 100× scale, then transferring the result. Hair above the jaw follows only the head.
   - `add_helpers.py`: adds half-rotation helper bones at the shoulders, elbows, hips and knees (`LeftArmHelper`, and so on). It moves the skin in each joint's blend band onto the helper. The game turns each helper half as far as its joint, so bent joints keep their volume instead of pinching.
   - `eye_data.py` (runs after the head swap): finds the painted eyes on the head texture (blue iris, pale sclera) and stores their openings as glTF extras. It also adds an `eyesClosed` shape key that smooths the sculpted iris dome into a lid. The game paints a skin-coloured lid with a lash edge over each eye and drives the shape key with it, for idle blinks and the "I closed my eyes" beat.
   - `add_twist.py`: a `<Side>ForeArmTwist` bone from mid-forearm to the wrist takes the distal forearm skin on a smooth ramp; the game turns it by 60% of the hand's roll about the forearm (swing-twist split), so wrist turns don't candy-wrap.
   - `separate_fingers.py`: the scan's index–pinky were fused by webbing to mid-finger. Their bones are rebuilt with anatomical proportions (knuckles evenly spaced, slight fan, natural rest curl; tip detection on the fused mesh had left them crooked and short), the fused geometry past the knuckles is removed and the palm capped, and each finger is regenerated as a tapered oval tube with knuckle bulges and a rounded tip, sunk into the palm like a ceramic joint. Texture carries over by casting rays from the old finger's axis onto the scan's surface (per face, so faces never straddle two atlas islands); each finger is weighted to its own bones. The thumb keeps its original geometry.
   - Fingers are posed in the game, not baked: `src/player/hands.ts` measures each finger's curl axis at load time (finger direction × palm normal) and curls the three joints in character space, so it works whatever the bone rolls are.
5. `export_game.py`: exports a GLB with 2K WebP textures, extras and morph targets (without morph normals, which shaded the lids wrong), then compresses it with meshopt.

To polish the face further, edit the texture or the mesh of `3D-assets/afterimage-head-triangles.glb` and re-run the script. The joints and the head fit are re-computed on every run.

This covers the woman first and the child after her. The game already has a stand-in body that uses the same bones, so once a real character matches this contract it drops in.

## 1. Before generating: make a clean input image

Image-to-3D tools (Tripo, Hunyuan3D, Meshy) turn whatever is in the picture into geometry and texture. The current key art is lit from behind, has a contrapposto pose and curled fingers. That leads to lighting baked into the texture, fingers fused together, and armpits merged with the torso. Generate a turnaround sheet first:

- **A-pose:** arms about 45° down, palms facing down, fingers straight and slightly spread, feet shoulder-width apart, looking straight ahead, neutral expression.
- **Flat, even light**, with no rim light or haze, on a plain mid-grey background.
- **Views:** front, side and back. Use the tool's multi-view mode when it has one (Tripo, Hunyuan3D 2.x and Meshy all do).
- Use `ChatGPT Image Sep 22, 2026, 01_37_40 PM.png` for body proportions and the portrait for the face.
- **Hair:** generate it as its own piece if the tool allows, or plan to redo it as hair cards. Scanned hair shades poorly in real time.
- **Leave out small emissive details:** the shoulder port, the cyan neck fibers and the cheek fissure are added in Blender (see §3) so they get their own materials.

## 2. Cleanup in Blender (5.2 is installed)

1. Import the GLB and set **1 unit = 1 m**. Height is about 1.65 m, feet at the origin, facing **−Y** in Blender (the glTF exporter turns that into +Z, which the game expects).
2. **Retopologise.** AI meshes are dense triangle soup and bend badly. Rebuild with quads and edge loops at the shoulders, elbows, wrists, every knuckle, the hips, knees and ankles. Budget: **20–30k triangles** for the body, 5–8k for hair cards.
   - Free: *Remesh → QuadriFlow* (built in), or Instant Meshes.
   - Paid and better: Quad Remesher.
3. **Bake** from the high-poly original onto the low-poly mesh, in Cycles with *Selected to Active* and a cage:
   - Base Color and Normal.
   - A packed **ORM-style mask**: R = plate mask (ivory ceramic 1, charcoal joint gap 0), G = AO, B = roughness.

   The plate mask lets the game shader handle glaze, chipping and the charcoal gaps the same way the placeholder does.

## 3. Rig contract (what the game reads)

The game finds bones **by name**, so the orientation of the rig doesn't matter. The IK solver works from world positions. Names are Mixamo-style; a `mixamorig:` prefix is stripped automatically.

```
Hips
 ├─ Spine ─ Spine1 ─ Spine2
 │           ├─ Neck ─ Head
 │           ├─ LeftShoulder  ─ LeftArm  ─ LeftForeArm  ─ LeftHand  ─ fingers
 │           └─ RightShoulder ─ RightArm ─ RightForeArm ─ RightHand ─ fingers
 ├─ LeftUpLeg  ─ LeftLeg  ─ LeftFoot  ─ LeftToeBase
 └─ RightUpLeg ─ RightLeg ─ RightFoot ─ RightToeBase
```

Required additions for this story:

| Item | Why |
|---|---|
| **3-joint fingers on both hands** (`RightHandIndex1..3` etc.), separate (not webbed) | The hand is the main "character" of the game |
| **`RightIndexTip`** end bone or empty | Exact point of contact with water, cloth and the other hand |
| **`LeftShoulderPort`** empty, parented to `LeftArm`, facing outward | Where the cable plugs in during Part II; the cyan ring sits here (**anatomical LEFT**) |
| **Forearm twist bone** (can be deform-only) | Stops the ceramic plates from twisting like a candy wrapper at the wrist |
| Shape keys: `blink`, `eyesClosed`, `jawOpen`, `browTense`, `lookDown` | S14 and S17 carry the performance in the eyes and mouth |
| Separate meshes or materials: port ring, neck fibers | They glow cyan and pulse from code |
| Cheek fissure under the **anatomical left eye**, as texture or decal | Continuity lock from the storyboard |

**How to build it:**

- **Rigify** (built in): add a Human meta-rig, line it up, generate, apply *Automatic Weights*, then fix the weights at the shoulders and fingers. Export **only the DEF- bones** and rename them to the contract above.
- Mixamo's auto-rig also produces the contract names, but its finger and shoulder weights are rough on hard-shell bodies.

Once you have the retopologised mesh, I can script most of this with Blender Python, running headless (`Blender -b -P script.py`): generating the meta-rig and the rig, weighting, renaming bones, adding the sockets, and exporting.

## 4. Animations to prepare

These can be Mixamo clips retargeted by name, or hand-keyed. Reaching and touching are **IK in code**, so they need no clips.

- **Part I:** idle breathing, slow walk, walk, walk in shallow water (heavier), curled lying pose, lying → kneel → stand, kneel down and hold, look around.
- **Part II:**
  - catch the falling beam (reflex)
  - run holding a small hand
  - brace against the gate (held pose plus a strain loop)
  - kneel beside the pillar
  - collapse into the curl
  - pick up the cloth and turn

## 5. Export

- Use **glTF binary (.glb)**. Enable *+Y up*, *Apply Modifiers* and *Skinning*, and include only the deform bones.
- Compress with `gltf-transform`: `meshopt` for geometry and `etc1s`/`uastc` → **KTX2** for textures. Aim for 2K textures on desktop and 1K on mobile.
- Put files in `game/public/models/`. The game loads them with `GLTFLoader` and `MeshoptDecoder` (`src/player/character.ts`); textures are WebP for now, with KTX2 still to come. `?body=placeholder` forces the stand-in.

## The child

`blender/rig_child.sh` builds `game/public/models/child.glb` from `3D-assets/child character 3d model.glb` (the raw scan, about 2M triangles) and `3D-assets/child portrait 3d model.glb` (the head). It is the woman's pipeline at the same 1.65 m working scale; the game scales her to 1.26 m (`loadCharacter(url, _, { kind: 'human', scale: 1.26 / 1.65, name: 'child' })`).

What differs, all switched by the wrapper:
- **Decimate first** (`decimate_scan.py`, 60k triangles). The scan is baked back as her normal detail.
- **Joints.** `landmarks.py` takes the narrowest section when a hood and a bob hide the neck. It keeps the ankle inside the boot and ignores boot soles when finding the fingertips.
- **Fingers.** The scan's own fingers are clean, so they are kept (`SKIP_FINGERS`). Her finger joints are placed anatomically from the wrist, fingertip and measured palm (`HAND_MODE=anatomic`, skin-only region `HAND_SKIN`), and bone heat binds the real fingers.
- **Weights.** The heat proxy keeps only its largest solid (`build_rig.py`); loose hair and lining shells made the solve fail everywhere.
- **Eyes.** They are brown (`EYE_IRIS=dark`, `EYE_BAND` below the fringe).
- **Material.** `kind: 'human'` uses skin and cloth only: no metal, no clearcoat, no cyan emission (the blue paint on her coat isn't a light). She has her own blink and wet uniforms.

Still to do for Part II: the sleeve strip that tears in S20. It will be a cloth piece at her left cuff, the same `OchreCloth` that later hangs on the bolt.
