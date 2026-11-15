#!/usr/bin/env bash
# Upload images to the `image-assets` pre-release and print markdown to paste into an issue, PR or comment.
# gh has no way to attach an image to an issue or PR from the command line; release assets are plain files
# served by GitHub, need only normal `gh` auth, and open without login on a public repo.
#
#   scripts/gh-image.sh shot.png [more.png ...]          # prints ![shot](https://github.com/…/shot-<stamp>.png)
#   scripts/gh-image.sh -p 12 before.png after.png        # prefix with the issue/PR number: 12-before-<stamp>.png
#   scripts/gh-image.sh -k shot.png                       # keep the local file (default: delete it once uploaded)
#
# #275: a file is deleted locally only after its upload succeeded, so captures stop piling up on the PC.
#
# The release must stay a published pre-release (not a draft): draft assets 404 for anyone not logged in.
#
# #520: a release holds at most 1000 assets. Uploads go to the highest of image-assets, image-assets-2, -3 …;
# when that one cannot take this batch, the next number is created. Old tags are never emptied, so old links
# in issues and PRs keep working.
set -euo pipefail

BASE=image-assets
MAX_ASSETS=1000
prefix=""
keep=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p) prefix="$2-"; shift 2 ;;
    -k) keep=1; shift ;;
    *) break ;;
  esac
done
if [[ $# -eq 0 ]]; then
  echo "usage: scripts/gh-image.sh [-p <issue#>] [-k] image..." >&2
  exit 1
fi

repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# image-assets counts as 1, image-assets-N as N; take the highest that exists
tag_of() { if [[ $1 -eq 1 ]]; then echo "$BASE"; else echo "$BASE-$1"; fi; }
num=1
while IFS= read -r t; do
  if [[ "$t" =~ ^${BASE}-([0-9]+)$ ]] && (( BASH_REMATCH[1] > num )); then num=${BASH_REMATCH[1]}; fi
done < <(gh release list --repo "$repo" --limit 200 --json tagName -q '.[].tagName')
TAG=$(tag_of "$num")
if gh release view "$TAG" --repo "$repo" >/dev/null 2>&1; then
  count=$(gh release view "$TAG" --repo "$repo" --json assets -q '.assets | length')
  if (( count + $# > MAX_ASSETS )); then
    num=$((num + 1))
    TAG=$(tag_of "$num")
  fi
fi
if ! gh release view "$TAG" --repo "$repo" >/dev/null 2>&1; then
  gh release create "$TAG" --repo "$repo" --prerelease --title "$TAG" \
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
  # set -e stopped above if the upload failed, so reaching here means it is on GitHub
  [[ $keep -eq 1 ]] || rm -f -- "$f"
done
