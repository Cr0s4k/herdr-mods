#!/usr/bin/env bash
# ./upgrade.sh  merge Herdr's current originals of the cloned mods and layout into main
set -euo pipefail

repo="$(cd "$(dirname "$0")" && pwd)"
app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
cd "$repo"

[ "$(git branch --show-current)" = main ] || { echo "Switch to main first."; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Commit or stash your changes first."; exit 1; }
version="$(herdr-app --version | awk '{print $2}')"

# Writes each clone's shipped original into $1 the way mod.clone/layout.clone would.
snapshot() {
  local dest="$1" m ours shipped f name l
  for m in "$repo"/mods/*/; do
    ours="$(basename "$m")"; shipped="$(jq -r '.cloned_from.name // empty' "$m/mod.json")"
    [ -n "$shipped" ] || continue
    mkdir -p "$dest/mods/$ours"
    for f in "$app/mods/$shipped"/*; do
      name="$(basename "$f")"
      case "$name" in gpui-kit.d.ts|jsconfig.json|mod.json) continue ;; esac
      if [[ "$name" == *.js ]]; then
        sed -e "s#mods/$shipped/#mods/$ours/#g" -e "s#mod: \"$shipped\"#mod: \"$ours\"#g" "$f" > "$dest/mods/$ours/$name"
      else
        cp "$f" "$dest/mods/$ours/$name"
      fi
    done
    jq -S --arg n "$shipped" --arg v "$version" '. + {cloned_from: {name: $n, version: $v}}' "$app/mods/$shipped/mod.json" > "$dest/mods/$ours/mod.json"
  done
  for l in "$repo"/layouts/*.json; do
    shipped="$(jq -r '.cloned_from.name // empty' "$l")"
    [ -n "$shipped" ] || continue
    mkdir -p "$dest/layouts"
    jq -S --arg n "$shipped" --arg v "$version" '. + {cloned_from: {name: $n, version: $v}}' "$app/layouts/$shipped.json" > "$dest/layouts/$(basename "$l")"
  done
}

tree="$(mktemp -d)"
trap 'git worktree remove --force "$tree" 2>/dev/null || rm -rf "$tree"' EXIT
git worktree add -q "$tree" upstream
git -C "$tree" rm -rq --ignore-unmatch mods layouts
snapshot "$tree"
git -C "$tree" add -A
git -C "$tree" diff --cached --quiet || git -C "$tree" commit -q -m "Herdr $version originals of the cloned mods and layout"

if git merge-base --is-ancestor upstream main; then
  echo "Up to date with Herdr $version."
  exit 0
fi

if git merge -q --no-ff upstream -m "Merge Herdr $version originals into the clones"; then
  echo "Merged Herdr $version cleanly. Next: ./install.sh, check Herdr, then git push origin main upstream."
  exit 0
fi

# A clone made from this very version has no base on upstream yet: its add/add conflict resolves to ours.
base="$(git merge-base HEAD MERGE_HEAD)"
for f in $(git diff --name-only --diff-filter=U); do
  git cat-file -e "$base:$f" 2>/dev/null && continue
  meta="$f"; [[ "$f" == mods/* ]] && meta="$(echo "$f" | cut -d/ -f1-2)/mod.json"
  [ "$(git show "HEAD:$meta" | jq -r '.cloned_from.version // empty')" = "$version" ] || continue
  git checkout -q --ours -- "$f" && git add -- "$f"
done

left="$(git diff --name-only --diff-filter=U)"
if [ -z "$left" ]; then
  git commit -q --no-edit
  echo "Merged Herdr $version. Next: ./install.sh, check Herdr, then git push origin main upstream."
  exit 0
fi
echo "Merging Herdr $version left conflicts in:"
echo "$left" | sed 's/^/  /'
echo "Resolve them (skills/herdr-mods-upgrade/SKILL.md says how), then git commit. git merge --abort backs out."
exit 1
