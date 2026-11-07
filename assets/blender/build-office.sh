#!/usr/bin/env bash
# Bake the office and install it into public/models/.
#   BLENDER=/path/to/blender ./build-office.sh [office_bake.py flags...]
set -euo pipefail
cd "$(dirname "$0")"
BLENDER="${BLENDER:-blender}"
OUT="$PWD/out/office"
"$BLENDER" --background --factory-startup --python office_bake.py -- "$OUT" "$@" | grep -E "cycles device|baked|saved|denoise|Error|DONE"
# --prune-attributes false keeps TEXCOORD_0: the glb has no textures (the app binds the atlases),
# so the default prune would drop the UVs as "unused".
pnpm dlx @gltf-transform/cli@4 optimize "$OUT/office.glb" "$OUT/office.opt.glb" \
  --compress meshopt --simplify false --instance false --join false --palette false --texture-compress false \
  --prune-attributes false
mkdir -p ../../public/models
cp "$OUT/office.opt.glb" ../../public/models/office.glb
cp "$OUT"/{room,work,wall_items,lounge}.webp ../../public/models/
ls -la ../../public/models/
