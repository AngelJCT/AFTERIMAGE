#!/usr/bin/env bash
# Rebuild the thorn vines (creepers, arches, tangles) -> game/public/models/thorns.glb.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p blender/work
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/scripts/thorns_kit.py -- "$PWD/blender/work/thorns_raw.glb" 2>&1 | grep -E "tris|THORNS_OK|rror" || true
(cd game && npx gltf-transform meshopt ../blender/work/thorns_raw.glb public/models/thorns.glb | tail -1)
