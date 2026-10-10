#!/usr/bin/env bash
# Tripo quad GLB -> rigged, game-ready GLB.
# Usage: blender/rig_character.sh <quads.glb> [out.glb] [highpoly.glb|-] [head.glb]
# highpoly: its surface detail is baked into the body normal map.
# head: a separate head scan replaces the body's head (fitted, simplified, skinned).
# LAYERED_ARMOR=1 adds the woman's ceramic plates after the rig/head are finished.
set -euo pipefail
cd "$(dirname "$0")/.."
IN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
OUT="${2:-game/public/models/woman.glb}"
HI="${3:-}"; [ "$HI" = "-" ] && HI=""
HEAD="${4:-}"
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
PY=/Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13
W="${WORK:-blender/work}"   # per-character working folder (WORK=blender/work/child)
mkdir -p "$W"
echo "1/5 prepare mesh";  "$BLENDER" -b --factory-startup -P blender/scripts/prep_mesh.py -- "$IN" "$PWD/$W/woman_prep.blend" "$PWD/$W/woman_prep.npz" | grep PREP_OK
if [ -n "$HI" ]; then
  echo "   + baking high-poly detail"; "$BLENDER" -b -P blender/scripts/bake_hi_normals.py -- "$PWD/$W/woman_prep.blend" "$(cd "$(dirname "$HI")" && pwd)/$(basename "$HI")" "$PWD/$W/normal_detail.png" 4096 | grep -E "ALIGN|BAKE_OK"
fi
echo "2/5 body joints";   "$PY" blender/scripts/landmarks.py "$W/woman_prep.npz" "$W/joints.json" > /dev/null
echo "3/5 finger joints"; "$PY" blender/scripts/fingers.py "$W/woman_prep.npz" "$W/joints.json" | tail -1
echo "4/5 skeleton + weights"; "$BLENDER" -b -P blender/scripts/build_rig.py -- "$PWD/$W/woman_prep.blend" "$PWD/$W/joints.json" "$PWD/$W/woman_rigged.blend" | grep -E "port at|proxy weighted|RIG_OK"
echo "   + joint helpers"; "$BLENDER" -b -P blender/scripts/add_helpers.py -- "$PWD/$W/woman_rigged.blend" | grep HELPERS_OK
echo "   + forearm twist"; "$BLENDER" -b -P blender/scripts/add_twist.py -- "$PWD/$W/woman_rigged.blend" | grep TWIST_OK
# Fused scan fingers are rebuilt as separate tubes; a scan with clean fingers keeps its own
# (SKIP_FINGERS=1, the child).
if [ -z "${SKIP_FINGERS:-}" ]; then
  echo "   + separate fingers"; "$BLENDER" -b -P blender/scripts/separate_fingers.py -- "$PWD/$W/woman_rigged.blend" | grep -E "rebuilt|FINGERS_OK"
fi
if [ -n "$HEAD" ]; then
  HEADABS="$(cd "$(dirname "$HEAD")" && pwd)/$(basename "$HEAD")"
  echo "   + swapping head"
  "$BLENDER" -b --factory-startup -P blender/scripts/dump_verts.py -- "$HEADABS" "$PWD/$W/head_pts.npy" | grep DUMP
  "$BLENDER" -b --factory-startup -P blender/scripts/register_head.py -- "$W/woman_prep.npz" "$W/head_pts.npy" "$W/head_xform.json" | grep -E "^icp"
  "$BLENDER" -b -P blender/scripts/swap_head.py -- "$PWD/$W/woman_rigged.blend" "$HEADABS" "$PWD/$W/head_xform.json" "$PWD/$W" 55000 | grep -E "head low|SWAP_OK"
  "$BLENDER" -b -P blender/scripts/eye_data.py -- "$PWD/$W/woman_rigged.blend" | grep -E "^L |^R |EYES_OK|shape key|EYELIDS_OK"
fi
EXPORT_SOURCE="$PWD/$W/woman_rigged.blend"
if [ "${LAYERED_ARMOR:-0}" = 1 ]; then
  echo "   + layered ceramic"
  "$BLENDER" -b -P blender/scripts/layered_armor.py -- "$EXPORT_SOURCE" "$PWD/$W/woman_armored.blend" | grep ARMOR_OK
  EXPORT_SOURCE="$PWD/$W/woman_armored.blend"
fi
echo "5/5 export";        "$BLENDER" -b -P blender/scripts/export_game.py -- "$EXPORT_SOURCE" "$PWD/$OUT.tmp.glb" 2048 | grep EXPORT_OK
(cd game && npx gltf-transform meshopt "../$OUT.tmp.glb" "../$OUT" >/dev/null) && rm "$OUT.tmp.glb"
ls -la "$OUT"
