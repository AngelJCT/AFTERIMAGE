#!/usr/bin/env bash
# Rebuild the path debris (bone, scrap, chips) -> game/public/models/debris.glb.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p blender/work
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/scripts/debris_kit.py -- "$PWD/blender/work/debris_raw.glb" 2>&1 | grep -E "tris|DEBRIS_OK|rror" || true
(cd game && npx gltf-transform meshopt ../blender/work/debris_raw.glb public/models/debris.glb | tail -1)
