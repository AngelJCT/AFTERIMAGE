#!/usr/bin/env bash
# Add layered ceramic to the finished woman rig; keep the source .blend intact.
# Usage: blender/build_armor.sh [rigged.blend] [out.glb]
set -euo pipefail
cd "$(dirname "$0")/.."
SOURCE="${1:-blender/work/woman_rigged.blend}"
OUT="${2:-game/public/models/woman.glb}"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
WORK_DIR="blender/work/armor"
mkdir -p "$WORK_DIR"
"$BLENDER" -b -t 4 -P blender/scripts/layered_armor.py -- "$SOURCE" "$WORK_DIR/woman_armored.blend"
"$BLENDER" -b -t 4 -P blender/scripts/export_game.py -- "$WORK_DIR/woman_armored.blend" "$WORK_DIR/woman_raw.glb" 2048
game/node_modules/.bin/gltf-transform meshopt "$WORK_DIR/woman_raw.glb" "$WORK_DIR/woman_compressed.glb"
# Only replace the shipped asset after both build and compression succeed.
cp "$WORK_DIR/woman_compressed.glb" "$OUT"
