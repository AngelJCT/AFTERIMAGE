#!/usr/bin/env bash
# Rebuild the rock kit -> game/public/models/rocks.glb.  Usage: blender/build_rocks.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p blender/work
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/scripts/rock_kit.py -- "$PWD/blender/work/rocks_raw.glb" | grep -E "tris|ROCKS_OK|Error"
(cd game && npx gltf-transform meshopt ../blender/work/rocks_raw.glb public/models/rocks.glb | tail -1)
