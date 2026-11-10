#!/usr/bin/env bash
# Bake the office and install it into public/models/.
#   BLENDER=/path/to/blender ./build-office.sh [office_bake.py flags...]
set -euo pipefail
cd "$(dirname "$0")"
BLENDER="${BLENDER:-blender}"
OUT="$PWD/out/office"
# the SECRET stamp's lettering (#67): Galmuri11 Bold, the app's UI font (SIL OFL), fetched once, not kept in the repo
FONT="$PWD/out/fonts/Galmuri11-Bold.ttf"
[ -f "$FONT" ] || curl -sSfL --create-dirs -o "$FONT" https://cdn.jsdelivr.net/npm/galmuri@2.40.3/dist/Galmuri11-Bold.ttf
"$BLENDER" --background --factory-startup --python office_bake.py -- "$OUT" "$@" | grep -E "cycles device|baked|saved|denoise|Error|DONE"
# --prune-attributes false keeps TEXCOORD_0: the glb has no textures (the app binds the atlases),
# so the default prune would drop the UVs as "unused". --flatten false --prune false keep the empty nodes
# (nav_* waypoints, surface_* slots): flattening dropped them; the nodes are already flat in the export.
pnpm dlx @gltf-transform/cli@4 optimize "$OUT/office.glb" "$OUT/office.opt.glb" \
  --compress meshopt --simplify false --instance false --join false --palette false --texture-compress false \
  --prune-attributes false --flatten false --prune false
mkdir -p ../../public/models
cp "$OUT/office.opt.glb" ../../public/models/office.glb
cp "$OUT"/{room,floor,walls_nw,walls_se,work,wall_items,lounge,lounge2,desk_props}.webp ../../public/models/
# the 512 px stand-ins the first screen shows while the close-up atlases load (#280)
node ../../scripts/atlas-lo.mjs ../../public/models
ls -la ../../public/models/
