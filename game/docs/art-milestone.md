# Flooded grove visual milestone

The opening grove is the first repeatable visual benchmark against the September 22 key artwork.
Open the dev server at:

`/?inspect=still&view=artwork&ref=artwork&light=day&q=high&at=0`

The **Artwork · grove** camera uses a 65 mm lens, a three-quarter angle, restrained depth of field,
the actual wake location and the shipped daylight. The full world stays visible. It uses the same
character, materials, vegetation and post-processing as gameplay. Other inspection cameras remain
sharp for evaluating silhouettes and movement. On low quality, this camera also stays sharp.

![Committed baseline, updated game and source artwork](images/art-milestone.jpg)

The before and after captures use the same 1440 × 1100 viewport at 2× render resolution, camera transform, standing pose,
daylight and simulation time. The baseline comes from the initial Git commit. Particle placement
can differ across reloads. The source artwork is a visual target, not a pixel-perfect pose match.

## Shipped changes

- **Hair:** preserve grey strand contrast instead of lifting it to white. The spatially smoothed
  hair mask also includes the warm, dark fringe. Add 260 tapered flyaway strands, attached to the
  animated Head bone and responding to the character's existing hair motion. This adds one mesh
  with 10,920 triangles; it does not alter the 65-bone skeleton or the facial morphs.
- **Ceramic:** derive shell boundaries from the existing texture, with a 1.2 mm maximum geometric
  lift, welded at UV seams and faded out above the soles. Match those boundaries with normal relief,
  filtered fine cracks, and separate shell/metal roughness. Reduce the broad colour fill and cyan
  emission so surface shading and localized accents remain visible.
- **Grove:** rebuild the real GLB with smoother branch sweeps, smaller thorns and less aggressive
  decimation of distant trees. Use paler mineral crust, quieter rust, and thinner reed blades.
  Add small, nonblocking pebbles around the wake clearing. The compressed grove grows from
  1.02 MB to 1.32 MB.
- **Light:** accumulate light shafts with view distance rather than applying their full brightness
  across nearby faces and surfaces. Reduce the gain of defocused highlight discs.

Rebuild the grove with `blender/build_grove.sh`; the normal 18,000-triangle budget argument is unchanged.
The hair detail and shallow shell relief are generated deterministically at load time, so rerigging
the existing source does not discard them. The subsequent [layered armor pass](layered-armor.md)
adds geometry during the Blender build. Human characters keep their skin/cloth material treatment.

## Verification and remaining limits

Build/type check and the 30/60/120 Hz motion suite pass. The grove export validates with no errors
or warnings (both before compression and after). Browser checks cover reference export, mobile
framing, finite shell/strand geometry, and hair attachment during walk, run, turns and lying.
The high-quality WebGPU path and low-quality WebGL2 fallback both render without shader errors.

This first milestone retained the scan's main hair clumps and broad armor shapes. The subsequent
[layered armor pass](layered-armor.md) adds overlapping plates; a fully authored hair groom remains
outside these passes. Use the sharp portrait and front views as well as the cinematic frame when
evaluating the assets.
