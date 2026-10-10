# Opening grove and pool environment pass

This pass follows the [layered armor study](layered-armor.md). The visual target remains the
September 22 key artwork: warm backlight, pale mineral surfaces, darker wet sediment and quiet
shallow reflections. These images show the actual game, with depth of field disabled to expose
the geometry and surface detail.

![Matched grove, shoreline and ground views before and after](images/environment-pass.jpg)

The left column is the working tree immediately before this environment pass, including the
earlier character and grove improvements. The right column is the updated environment. Both
use the same 1600 × 1060 inspection viewport, 2× render resolution, cameras, daylight, standing
pose and simulation time. Floating particles and sky fragments can differ between reloads.

## Changes

- **Ground:** mix silty runnels, localized cracked clay, salt and iron stains. Reduce the uniform
  cellular pattern, harsh grain and broad wet glare. Filter crack colour at distance and keep
  soil glints fixed in world space. Increase terrain subdivisions for smoother water intersections.
- **Shore:** add seeded, partially buried pebble and mineral-flake deposits, arranged along
  terrain contours. There are 68 deposits / 1,102 pieces on high quality and 34 / 540 on low.
  The wake clearing and pool interaction centres remain clear; these details add no blockers.
- **Water:** fix the depth map's units and interpolate signed terrain height across the waterline.
  Sample texel centres and use higher-resolution maps. Shelter the opening pool from wind chop,
  soften the shallow edge, reduce glare and mineral scum, and animate glint facets continuously.
  Touch ripples still use their original amplitudes and propagation.
- **Trees:** fuse substantial branch junctions before adding fine twigs; soften the old knuckles
  and add tapered roots that disappear into the soil. Rebuild mineral and AO masks. Bark has
  gentler relief, lighter mineral deposits and a damp base.
- **Lighting:** retain warm directional light and haze, with a cooler sky fill, less olive colour
  transfer and tighter shadow contact. Shared materials and lighting also affect later areas.

The analytic `heightAt` surface, story locations and tree placement seeds are unchanged.
Camera avoidance is still generated from the rebuilt trees' geometry.

## Reproduce the views

Run `npm run dev`, open `/?inspect=still&view=artwork&ref=artwork&q=high&at=0`, choose **Game only**,
then use the developer console. For the wide grove:

```js
__inspection.reset();
__shot([4, 1.4, 14], [-2, 2, -7], 35);
game.cam.update(0, game.input, game.player.position, false, game.player.yaw, 0);
game.post.uBokeh.value = 0;
__render();
```

The shoreline uses position `[2, 0.75, -0.5]`, target `[0, 0, -5.5]`, lens 40 mm;
the ground view uses `[2.9, 0.8, 8.8]`, target `[0.5, 0, 6]`, lens 45 mm.
The pool reverse view uses `[-3, 1.2, -1.5]`, target `[1.4, 0.1, -5.5]`, lens 40 mm.
Rebuild the tree asset from the repository root with `blender/build_grove.sh`.
The build now caches normals before displacement and stops on Python errors rather than
compressing a stale export. Its full log is saved in `blender/work/grove-build.log`.

## Verification and cost

- Production build/type check and the 30/60/120 Hz movement suite pass.
- Raw and compressed grove exports validate with no errors or warnings. The compressed validator
  reports that it cannot inspect the meshopt extension; both browser backends load it successfully.
- High-quality WebGPU and low-quality WebGL2 render without shader errors. Day, late afternoon,
  overcast and night were checked, along with several phases of a touch ripple.
- Across 28,277 shallow-ground samples, maximum height-map interpolation error is 2.35 mm on
  high quality and 3.82 mm on low. Sediment transforms are finite, deterministic and embedded.
- The compressed grove changes from 1,315,668 to 1,249,216 bytes. Its 13 mesh variants total
  208,892 triangles, up from 199,835. Terrain increases from 96,800 to 204,800 triangles on high,
  and 33,800 to 64,800 on low. Small deposits are instanced, culled in cells and excluded from
  reflections; high quality includes their cast shadows. Depth maps use 4 MiB / 1 MiB.

This improves the procedural environment; it does not replace the distant architecture or every
background prop with authored assets. The sharp wide views still expose repetition in the thorn
undergrowth and simple rock silhouettes. Frame-rate budgets on lower-powered hardware remain
to be profiled.
