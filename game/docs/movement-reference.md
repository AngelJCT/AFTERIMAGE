# Movement and reference studies

Run `npm run dev`, then open:

- Proportions: `http://localhost:5180/?inspect=still&view=front&ref=front&clear=1&q=high`
- Walk/run transition: `http://localhost:5180/?inspect=walk-run&view=side&at=3.5&clear=1&q=high`
- Turning: `http://localhost:5180/?inspect=turns&view=three-quarter&at=5.75&clear=1&q=high`
- Portrait/materials: `http://localhost:5180/?inspect=portrait&ref=artwork&light=day&q=high`

The viewer does not run the story, expose its skip shortcut, or save checkpoints/settings. Source images are served from an explicit allowlist in the local Vite server. They are not copied into the production game. **Open image** uses a local browser object URL and does not upload the file.

## Comparing a change

1. Choose a movement, camera, light and reference. **Clear foreground** removes foliage and props while keeping the actual ground, water and lighting; it makes foot contact easier to judge.
2. Pause at a useful moment. Scrubbing replays the same input sequence at exactly 60 Hz, from the beginning. The previous/next buttons move one frame. Playback stops at the end of each study so the final stance can be inspected.
3. Use **Overlay** to line up the silhouette with scale and horizontal/vertical controls. The source keeps its aspect ratio. A front A-pose reference and a relaxed standing pose will differ at the arms; compare the head, torso and limb proportions first.
4. **Copy view link** records the movement, time, camera, lighting, reference, layout and overlay alignment. Reopen the link before an after-capture. Local custom images must be selected again. Use the same viewport size and quality tier for a fair comparison.
5. **Save comparison** downloads a labelled side-by-side PNG with the unwarped source, plus a clean game JPEG in `.shots/`. Saving holds the exact pose and does not consume a simulation frame. `&label=before` / `&label=after` names the clean files. The overlay registration is a viewing aid; it is not baked into the PNG pair.

**Save stride** is available for Walk and Run. It warms up the gait, advances to the next heel strike, then saves 24 frames of one stride in `.shots/`. `&frames=8` through `&frames=60` controls sampling; `&label=name` names the sequence. These are actual simulation poses without resetting the stride phase underneath planted feet.

The camera is fixed relative to the route, so a turning character rotates within the shot. Body framing fits the entire character; portrait uses 85 mm. Grain, autofocus blur, camera shake, random blinks and adaptive resolution are disabled for these studies. **Artwork · grove** uses 65 mm and a fixed, restrained depth of field on high quality; the other views stay sharp. See the [visual milestone](art-milestone.md) for its matched reference and asset changes. The shaders use game time during inspection. Environmental particles are not a pixel-exact baseline across page reloads; use the rig, framing and light as the comparison anchors.

## Motion checks

`npm run check:motion` uses the shipped GLB and the same input sequences as the viewer (`src/dev/motionScenarios.ts`). It covers 30/60/120 Hz walking, running, start/stop, walk/run transitions, right-angle turns and reversals, uneven terrain, blockers, lifts and direct story alignment. It checks deformed soles, support-foot slip/twist, maximum ankle travel, pelvis motion, rest drift and finite story poses.

The movement controller brakes into sharp changes of direction and caps body turning speed. Walk/run blending drives the pose, cadence and contact interval together. Feet retain their landing direction through stance; their support strength no longer fades with walking speed. Recovery travel is bounded during a changed stride, and idle feet settle at their latest position instead of jumping back to the preceding heel strike. Moving-floor anchors follow the platform's height. Both story falls use elapsed time instead of a 60 Hz gravity increment.

In the browser, inspect knee volume, toe roll, hip/shoulder counter-rotation, starts after a long rest and the final planted stance. The numerical checks catch continuity/contact regressions; they do not establish that a performance matches the film.
