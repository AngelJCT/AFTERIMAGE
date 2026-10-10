#!/usr/bin/env bash
# Rebuild the grove tree kit -> game/public/models/grove.glb. Usage: blender/build_grove.sh [trisPerTree]
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p blender/work
PYTHONUNBUFFERED=1 /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P blender/scripts/grove_kit.py -- "$PWD/blender/work/grove_raw.glb" "${1:-18000}" | tee blender/work/grove-build.log | grep --line-buffered -E "tris|GROVE_OK"
(cd game && npx gltf-transform meshopt ../blender/work/grove_raw.glb public/models/grove.glb | tail -1)
