#!/usr/bin/env bash
# Upload images to the `image-assets` pre-release and print markdown to paste into an issue, PR or comment.
# gh has no way to attach an image to an issue or PR from the command line; release assets are plain files
# served by GitHub, need only normal `gh` auth, and open without login on a public repo.
#
#   scripts/gh-image.sh shot.png [more.png ...]          # prints ![shot](https://github.com/…/shot-<stamp>.png)
#   scripts/gh-image.sh -p 12 before.png after.png        # prefix with the issue/PR number: 12-before-<stamp>.png
#
# The release must stay a published pre-release (not a draft): draft assets 404 for anyone not logged in.
set -euo pipefail

TAG=image-assets
prefix=""
if [[ "${1:-}" == "-p" ]]; then
  prefix="$2-"
  shift 2
fi
if [[ $# -eq 0 ]]; then
  echo "usage: scripts/gh-image.sh [-p <issue#>] image..." >&2
  exit 1
fi

repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
if ! gh release view "$TAG" --repo "$repo" >/dev/null 2>&1; then
  gh release create "$TAG" --repo "$repo" --prerelease --title "image-assets" \
    --notes "이슈·PR에 붙이는 이미지 보관용. 배포 릴리스가 아님. 올리기: scripts/gh-image.sh" >/dev/null
fi

stamp=$(date +%Y%m%d-%H%M%S)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for f in "$@"; do
  [[ -f "$f" ]] || { echo "없는 파일: $f" >&2; exit 1; }
  base=$(basename "$f")
  name="${base%.*}"
  ext="${base##*.}"
  # asset names: ASCII only, no spaces, unique per upload so links never change underneath an old comment
  safe=$(printf '%s' "$name" | tr -c 'A-Za-z0-9._-' '-' | sed 's/--*/-/g; s/^-//; s/-$//')
  [[ -n "$safe" ]] || safe=image
  ext=$(printf '%s' "$ext" | tr 'A-Z' 'a-z')
  out="${prefix}${safe}-${stamp}.${ext}"
  cp "$f" "$tmp/$out"
  gh release upload "$TAG" "$tmp/$out" --repo "$repo" >/dev/null
  echo "![${name}](https://github.com/${repo}/releases/download/${TAG}/${out})"
done
