#!/usr/bin/env bash
# Rebuild chapter V's crossing (conduit, slab, pinch, rubble) -> game/public/models/crossing.glb.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p blender/work
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/scripts/crossing_kit.py -- "$PWD/blender/work/crossing_raw.glb" | grep -E "tris|CROSSING_OK|Error"
(cd game && npx gltf-transform meshopt ../blender/work/crossing_raw.glb public/models/crossing.glb | tail -1)
