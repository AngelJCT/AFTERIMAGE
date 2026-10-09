#!/usr/bin/env bash
# The child (Part II): raw image-to-3D scan + head scan -> rigged game GLB, through the same
# pipeline as the woman (rig_character.sh) at its 1.65 m working scale; the game scales her
# down. Differences: the scan is decimated first (and baked back as normal detail), her
# fingers are clean in the scan (kept, joints placed anatomically), and her eyes are brown.
set -euo pipefail
cd "$(dirname "$0")/.."
BODY="${1:-3D-assets/child character 3d model.glb}"
HEAD="${2:-3D-assets/child portrait 3d model.glb}"
mkdir -p blender/work/child
echo "0/5 decimate scan"
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/scripts/decimate_scan.py -- \
  "$PWD/$BODY" "$PWD/blender/work/child/child_base.glb" 60000 | grep DECIMATE_OK
WORK=blender/work/child SKIP_FINGERS=1 HAND_SKIN=1 HAND_MODE=anatomic EYE_IRIS=dark EYE_BAND=1.455,1.488 \
  blender/rig_character.sh blender/work/child/child_base.glb game/public/models/child.glb "$BODY" "$HEAD"
