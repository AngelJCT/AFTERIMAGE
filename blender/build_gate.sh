#!/usr/bin/env bash
# Rebuild the refuge gate (Part II) -> game/public/models/gate.glb.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p blender/work
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P blender/scripts/gate_kit.py -- "$PWD/blender/work/gate_raw.glb" | tee blender/work/gate-build.log | grep --line-buffered -E "tris|GATE_OK|Error|rror"
(cd game && npx gltf-transform meshopt ../blender/work/gate_raw.glb public/models/gate.glb | tail -1)
