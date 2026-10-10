# Landmark trees, roots and rock formations

This pass develops the pool composition and carries the shared tree and rock changes through
the wake clearing and refuge gate approach. The reference remains the September 22 artwork:
dead, mineral-encrusted growth, wet sediment, low fractured outcrops and warm backlight.

![Matched views before and after the geometry pass](images/landmark-geometry-pass.jpg)

These are game renders with matched cameras, daylight, standing pose and simulation time.
Depth of field is disabled. Both columns use the 1600 × 1060 inspection viewport and 1.5×
render resolution; the captures are resized for this sheet, without colour correction.
The left column includes all earlier passes. Floating particles and sky fragments can vary
between reloads.

## What changed

- **Trees:** continuous taper, unequal leading and lateral branches, shorter fine twigs,
  occasional broken ends, subtle longitudinal fluting and fewer projecting thorns. Mineral
  nodules are smaller, and scales attach to substantial bark rather than thin tips.
- **Roots:** five uneven primary roots with curved groundward growth and lower forks. The
  roots merge into the trunk and taper below the soil. Small fragments and fallen twigs
  gather around the three landmark trees.
- **Pool framing:** a leaning tree on the far bank balances the existing trunks on the left.
  It joins the normal trunk collision and geometry-derived camera avoidance systems.
- **Rock formations:** bevelled fracture faces, offset mineral beds, split upper slabs,
  eroded edges and buried fragments replace the rounded shapes of the larger rock variants.
  Seven larger plates in each rubble variant make the gate-side mounds less uniform.
- **Shore composition:** two groups of related low beds sit into the pool banks. Their height
  uses the low side of the terrain beneath them. Flat scattered rocks are resized or omitted
  where their full footprint would intrude into a route or pool interaction area; this fixes
  an overlap exposed by the low-quality inspection.

Existing tree and solid-rock placement seeds remain stable. The additional bank tree adds
one trunk blocker; existing boulder and mound blocker definitions are retained. No story
locations, analytic terrain heights, gate mechanism, water shaders or lighting settings change.
The new geometry is shared by both quality tiers; existing instancing and cell culling remain.

![Root and shoreline geometry at close range](images/landmark-geometry-details.jpg)

## Asset cost

| Kit | Previous triangles | Current triangles | Previous bytes | Current bytes |
| --- | ---: | ---: | ---: | ---: |
| Grove, all 13 variants including distant copies | 208,892 | 202,272 | 1,249,216 | 1,184,988 |
| Rocks, all 16 variants | 36,029 | 40,845 | 538,668 | 618,044 |

These are unique asset triangles, not per-frame rendered totals. One tree instance and small
shore/root deposits are added; the distant tree copies retain their approximately 4,500-triangle
budgets. No textures or rendering passes are added. Lower-powered device performance has not
been benchmarked.

## Verification

- `npm run build` and the existing movement suite at 30/60/120 Hz pass.
- Raw and compressed GLBs validate without errors or warnings. The validator cannot inspect
  the meshopt extension itself; decoded position, normal and colour arrays were also checked
  for finite values, and both browser backends load the assets.
- WebGPU/high and WebGL2/low render the rebuilt kits without asset or shader errors.
- Walk/run segments through the wake, pool-to-mirror lane, gate approach and beside the new
  bank tree pass with the relevant environment blockers restored in the inspection viewer.
  Camera transforms remain finite with the rebuilt geometry footprints. These are local route
  checks, not a full narrative playthrough.
- Actual transformed vertices of exposed flat rocks were checked against both route networks
  and the pool/mirror centres on both quality tiers, in addition to reviewing the captured views.
- Daylight and overcast wide views and root/rock close views were inspected without depth of
  field. The artwork's photographic surface complexity remains a further art target; distant
  architecture and the separate thorn-thicket kit are not rebuilt in this pass.

The rock build now stops on Blender Python errors and keeps its complete log. Both generators
retain their separated bake positions until all AO bakes finish. The rock generator also
refreshes its mesh reference after decimation before painting the exported masks.

## Rebuild and reproduce

From the repository root:

```sh
blender/build_grove.sh
blender/build_rocks.sh
cd game
npm run build
npm run check:motion
```

Open `/?inspect=still&view=artwork&q=high&at=0` and select **Game only**. The pool comparison:

```js
__inspection.reset();
game.gate.root.visible = false;
game.player.place(game.player.position.clone().set(1, 0, -2.6), Math.PI);
game.player.update(0, 0, game.input, 0);
__shot([5, 1.65, 3], [0, 0.5, -5.5], 35);
game.cam.update(0, game.input, game.player.position, false, game.player.yaw, 0);
game.atmos.follow(game.player.position);
game.post.trackSun(game.cam.camera,
  game.atmos.sun.position.clone().sub(game.atmos.sun.target.position).normalize());
game.post.uBokeh.value = 0;
__render();
```

The root close-up uses camera `[-0.8, 0.65, -4.4]`, target `[-3.05, 0.24, -6.9]`, lens 45 mm.
The rock detail uses camera `[-0.3, 0.75, -0.2]`, target `[-2.8, 0.04, -3.8]`, lens 50 mm.
The wake and gate cameras match the [lighting pass](lighting-depth-pass.md).
