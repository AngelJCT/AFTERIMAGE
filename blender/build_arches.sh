#!/usr/bin/env bash
# Rebuild the refuge arcade -> game/public/models/arches.glb.  Usage: blender/build_arches.sh [triBudget]
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p blender/work
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/scripts/arches_kit.py -- "$PWD/blender/work/arches_raw.glb" "${1:-48000}" | grep -E "tris|ARCHES_OK|Error"
(cd game && npx gltf-transform meshopt ../blender/work/arches_raw.glb public/models/arches.glb | tail -1)
