# Grove composition and refuge gate pass

This follows the [opening grove and pool pass](environment-pass.md), carrying the mineral,
weathered industrial palette into the gate and arcade. The gate silhouette and its interactive
hardware remain the focal point; lower, less repetitive undergrowth leaves more space around
the route.

![Matched daylight, masonry detail and overcast gate views](images/gate-approach-pass.jpg)

Left: immediately before this pass, including the previous environment changes. Right: the
updated assets and materials. Each pair uses the same camera, 1600 × 1060 inspection viewport,
2× render resolution, standing pose, weather preset and simulation time. Depth of field is off.
Floating particles and sky fragments may differ between reloads. These are game renders,
resized for the comparison without colour edits.

## Changes

- **Gate masonry:** separate concrete from the mixed iron/mineral shader. The old crust mask
  incorrectly made some stone faces look like rusted metal. Give the masonry small bevels,
  chipped corners, restrained surface erosion, softer mineral variation and a damp base.
- **Ground connection:** replace the raised, evenly spaced paving grid with staggered slabs,
  irregular missing patches and edges buried close to the existing silt surface.
- **Industrial detail:** add damaged supply runs and clamps to the wall, soften iron edges and
  reduce orange rust and surface contrast. Keep the bolt, receiver and power lead legible.
- **Arcade:** add conduit collars and recessed courses along the deck edges. Decks use the
  masonry material, while supporting conduits retain their own mineral/metal treatment.
- **Vegetation:** reduce repeated thorn rings and background scatter, vary height and lean,
  and orient nearby arching growth away from the path. Existing thicket centres stay fixed.
- **Comparison export:** fix upside-down saved frames on WebGL. The live scene already rendered
  correctly; readback now accounts for each backend's row order before adding photo overlays.

## Verification and rendering cost

- Production build/type check and the 30/60/120 Hz movement checks pass.
- Both gate and arcade GLBs validate without errors or warnings. The compressed validator
  reports its meshopt inspection limitation; both browser backends decode the assets.
- High-quality WebGPU and low-quality WebGL2 render without console errors. The only WebGL
  warning announces the deliberately selected fallback backend. Both saved-image orientations
  were checked after the export fix.
- All four gate contact points and its 2.72 m travel are unchanged. Ten slab poses preserve
  moving-part bounds within 3 mm and identical collision boundaries. Closed, jammed and fully
  open states were rendered on both backends; the plug returns to its original contact point.
- All 19 elevated deck sections retain their longitudinal extents and top heights within 3 mm.
  The approach camera transforms and rebuilt mesh positions/normals remain finite.

| Asset / placed geometry | Before | After |
| --- | ---: | ---: |
| Gate GLB | 327,064 bytes / 40,176 triangles | 1,125,396 bytes / 97,852 triangles |
| Arcade GLB | 762,492 bytes / 71,819 triangles | 847,744 bytes / 79,019 triangles |
| High-quality thorns | 203 instances / 1,436,824 triangles | 159 instances / 1,146,236 triangles |
| Low-quality thorns | 107 instances / 761,528 triangles | 77 instances / 535,176 triangles |

The additional masonry geometry costs more per gate; the thorn changes remove about 20% of
placed thorn triangles on high quality and 30% on low. These are geometry counts, not frame-rate
measurements: culling, reflections, shadows and repeated arcade placements affect actual cost.
Lower-powered hardware still needs profiling. This verification covers assets and mechanism
invariants, not a full replay of every narrative sequence.

## Reproduce and rebuild

Run `npm run dev`, open `/?inspect=still&view=artwork&q=high&at=0`, select **Game only**, and run:

```js
__inspection.reset();
game.gate.root.visible = true;
game.gate.lift = 0;
game.gate.jam = 0;
game.gate.restPlug();
game.weather.set('day', 0); // Use 'rain' for the overcast comparison.
game.skyEnv?.markDirty(true);
game.skyEnv?.update(0);
const local = a => game.gate.world(game.player.position.clone().fromArray(a));
game.player.place(local([-.6, 0, 5]), game.gate.approach().yaw);
game.player.update(0, 0, game.input, 0);
__shot(local([2.5, 2.3, 15]).toArray(), local([0, 4, 0]).toArray(), 30);
game.cam.update(0, game.input, game.player.position, false, game.player.yaw, 0);
game.post.uBokeh.value = 0;
__render();
```

The masonry detail uses gate-local camera `[-6.8, 1.25, 5.6]`, target `[-5, 1.6, 0]`, lens 45 mm.
The wider approach uses `[0, 1.7, 24]`, target `[0, 4, 0]`, lens 35 mm.

From the repository root, rebuild with `blender/build_gate.sh` and `blender/build_arches.sh`.
Both scripts stop on Python failures and retain full build logs in `blender/work/`.
