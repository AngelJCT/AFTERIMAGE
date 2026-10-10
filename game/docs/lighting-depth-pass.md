# Opening route: light, atmospheric depth and materials

This pass follows the [refuge gate and composition pass](gate-approach-pass.md). It keeps the
warm backlight and mineral palette of the key artwork, with cooler shaded surfaces and clearer
separation between nearby objects, the middle distance and the far arcade.

![Matched wake, pool and gate views before and after](images/lighting-depth-pass.jpg)

The left column is the working tree immediately before this pass. Each pair uses the same
1600 × 1060 inspection viewport, 1.5× render resolution, camera, character placement, weather
preset and simulation time. Depth of field and grain are off. Rain and dust particles can
differ between reloads. The images are resized game captures without colour edits.

## What changed

- **Atmosphere:** delay distance fog from 7 to 9 m and lower its base density from 0.019 to
  0.016. Low mist now builds between 5 and 32 m in broken, drifting banks, with a lower height
  ceiling. Nearby feet, roots and shallow sediment retain more contrast.
- **Light separation:** narrow the broad sun glow, lower shaft intensity, cool the diffuse sky
  fill and reduce the grade's yellow transfer into shadows. Daylight stays warm; overcast uses
  brighter diffuse illumination with a weaker directional light.
- **Weather consistency:** the sun disc, forward-scattered glow, screen-space shafts and
  procedural ground/water glints share a direct-sun multiplier. Previously they retained
  daylight strength under rain. The gate's roof bounce and character bounce also respond to
  the available light.
- **Surface balance:** make wet silt darker and less glossy; reduce the ordinary water's
  reflection cap and sparkle. Bark has a quieter, rougher mineral surface. Masonry receives
  less environment reflection and cinematic fill than iron, keeping ceramic, concrete,
  metal and vegetation more distinct. The mirror pool's special reflection blend remains.
- **Contact shading:** add subtle short-range GTAO on high quality, with a 22 cm radius,
  16 samples and a 34% maximum contribution. It fades out from 12 to 38 m. The existing shadow
  maps use a smaller bias to improve attachment at roots and feet.
- **Story continuity:** share atmospheric defaults with the mirror-memory reveal. Its mist
  now blends from 0.32 to 0.18 and fog from 0.016 to 0.014, instead of restoring the older haze.

These shared shaders and lighting also affect later areas. Geometry, collision layout,
animation, interaction positions and touch-ripple propagation were not changed in this pass.

## Validation and cost

- Production build/type check and the 30/60/120 Hz movement suite pass.
- High-quality WebGPU, high-quality WebGL2 and low-quality WebGL2 render without console
  errors. The fallback's only warning identifies its deliberately selected backend.
- Three 3-second walk/run segments at the clearing, pool and gate were checked using the
  normal follow camera on WebGPU/high and WebGL2/low. Positions, speed and camera transforms
  remain finite. Gameplay views were checked with depth of field off.
- Day, rain, late afternoon, night and storm presets render correctly. Direct-sun strength
  blends monotonically from 1 in daylight to about 0.00152 in rain. The story mist reveal was
  checked at its start, midpoint and end.
- Close contact shading was reviewed enabled/disabled, alongside matched route views.

High quality adds one full-resolution R32F depth-copy pass, one half-resolution GTAO pass and
two half-resolution bilateral blur passes. The depth copy allows depth gathering with the
existing 4× MSAA scene on WebGPU; nearest sampling avoids smoothing object boundaries. Both
sharp and depth-of-field output use the same contact result. Low quality omits all four passes
and retains shadow maps and baked asset occlusion. No mesh or texture assets were enlarged.

A local serialized render-and-GPU-completion check took roughly 15 ms for the tested close
view at a 1280 × 900 inspection viewport and 1× render resolution. This is a sanity measurement,
not a gameplay frame-rate claim or a benchmark for other hardware. Full narrative replay and
lower-powered device profiling remain separate checks.

## Reproduce a view

Run `npm run dev`, open `/?inspect=still&view=artwork&q=high&at=0`, select **Game only**, then run:

```js
__inspection.reset();
game.gate.root.visible = false;
game.weather.set('day', 0); // 'rain' for overcast
game.skyEnv.markDirty(true);
game.skyEnv.update(0);
game.player.place(game.player.position.clone().set(0, 0, 7), Math.PI);
game.player.update(0, 0, game.input, 0);
__shot([4, 1.4, 14], [-2, 2, -7], 35);
game.cam.update(0, game.input, game.player.position, false, game.player.yaw, 0);
game.atmos.follow(game.player.position);
game.post.trackSun(game.cam.camera,
  game.atmos.sun.position.clone().sub(game.atmos.sun.target.position).normalize());
game.post.uBokeh.value = 0;
__render();
```

The pool uses camera `[5, 1.65, 3]`, target `[0, 0.5, -5.5]`, lens 35 mm and character
position `[1, 0, -2.6]`. The gate uses the gate-local setup in the
[previous pass](gate-approach-pass.md#reproduce-and-rebuild).
`game.post.uContact.value = 0` disables contact shading's visual contribution for comparison;
restore it to `0.34` afterward. This debug adjustment does not remove its GPU passes.
