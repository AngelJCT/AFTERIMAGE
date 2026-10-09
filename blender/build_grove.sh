#!/usr/bin/env bash
# Rebuild the grove tree kit -> game/public/models/grove.glb (~80 s).  Usage: blender/build_grove.sh [trisPerTree]
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p blender/work
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/scripts/grove_kit.py -- "$PWD/blender/work/grove_raw.glb" "${1:-18000}" | grep -E "tris|GROVE_OK"
(cd game && npx gltf-transform meshopt ../blender/work/grove_raw.glb public/models/grove.glb | tail -1)
