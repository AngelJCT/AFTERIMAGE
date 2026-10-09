#!/usr/bin/env bash
# Rebuild the off-route landmarks (fallen giant, conduit ruins) -> game/public/models/landmarks.glb.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p blender/work
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/scripts/landmarks_kit.py -- "$PWD/blender/work/landmarks_raw.glb" | grep -E "tris|LANDMARKS_OK|Error"
(cd game && npx gltf-transform meshopt ../blender/work/landmarks_raw.glb public/models/landmarks.glb | tail -1)
