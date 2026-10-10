# Layered ceramic armor

The shipped woman now has **388 overlapping ceramic plates**, fitted over the existing scan.
The September 22 key artwork guides their fractured edges, shallow overlaps and exposed dark
workings. These are closed meshes with beveled rims and undercuts that affect the silhouette and
cast shadows. The original worn shell remains visible between them.

![Matched armor comparison](images/layered-armor.jpg)

The game captures use the same camera, standing pose, daylight, simulation time, viewport and
2× render resolution. Their crops are identical. The source artwork has a different pose and crop.
Open `/?inspect=still&view=artwork&ref=artwork&q=high&at=0` to compare the shipped asset, then use
the sharp front, side and back cameras and walk/run playback to inspect it in motion.

## Geometry and materials

- 55 shoulder/upper-arm plates, 53 torso plates, 146 hip/thigh plates, 51 forearm plates and 83 shin plates.
- One additional skinned mesh/material: `WomanArmor`, tagged with `layeredArmor: true` in glTF extras.
- 37,200 additional triangles; compressed `woman.glb` grows from 4.71 MB to 5.40 MB.
- Plate sizes and alignment vary by body region. Chipped outlines pull back from the existing
  texture's mechanical seams. The shoulder port, neck, hands, soles and joint centers stay clear.
- Each vertex takes up to four normalized skin influences from the underlying surface, including
  the joint helpers and forearm twist. This is surface-following skinning, not independently rigid
  plate articulation. No bones or animation controls are added.
- Vertex colors distinguish ivory faces, chipped bevels and dark undersides. The runtime material
  adds restrained wear and micro-relief, and uses the same lighting and wetness controls as the body.

The plate mesh complements the scan rather than replacing its topology. The reference still has
more varied sculpted fracture shapes and finer mechanical detail; this pass establishes real depth
and overlap while retaining the current character and performance.

## Rebuild

From the repository root, with the finished woman rig already in `blender/work`:

```bash
blender/build_armor.sh
```

Optional arguments are the source `.blend` and destination `.glb`. `BLENDER` can override the
executable path. The script builds a separate `blender/work/armor/woman_armored.blend`, writes a
JSON geometry report, exports and compresses the model, then replaces the runtime GLB only after
those steps succeed. The original `woman_rigged.blend` stays intact. The fixed seed makes repeated
builds from the same source reproduce the same plates.

For a complete rebuild from the tracked scans, use the command in [character-pipeline.md](character-pipeline.md)
with `LAYERED_ARMOR=1`. The child pipeline explicitly uses `LAYERED_ARMOR=0`.

## Validation

- The builder checks closed plates, nondegenerate triangles, finite positions and normalized skin weights.
- A comparison of the old and new GLBs found identical body/head vertex positions and triangle counts,
  preserved bone names, eye metadata and the `eyesClosed` morph.
- `npm run build` and `npm run check:motion` pass, including 30/60/120 Hz locomotion and story poses.
- Browser checks sample the deformed armor in standing, walking, running, turning, kneeling and lying.
  The maximum distance to a sampled vertex's nearest body vertex is 9.3 mm, including the underlying
  mesh's vertex spacing. Front, side and back views and the reference export were also checked.
- Both high-quality WebGPU and the low-quality WebGL2 fallback render the armor without shader
  or runtime errors.
- glTF validation reports no errors. The existing body/head tangent-space warnings remain; the new
  mesh shares the rig's non-root skinned-node warning, already present on both original meshes.
  The compressed validator also reports its usual unsupported Meshopt extension information.

Local verification captures and logs are in `output/playwright/layered-armor/` (ignored by Git).
