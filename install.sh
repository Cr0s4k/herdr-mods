#!/usr/bin/env bash
# ./install.sh          copy into Herdr once
# ./install.sh --watch  keep copying on every save (Herdr reloads the mod live)
set -euo pipefail

repo="$(cd "$(dirname "$0")" && pwd)"
app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
layout=main-custom
mods=("$repo"/mods/*)

copy() {
  rsync "$@" --copy-links --exclude gpui-kit.d.ts --exclude jsconfig.json "${mods[@]}" "$app/mods/"
  rsync "$@" "$repo"/layouts/*.json "$app/layouts/"
}

check() {
  for m in "${mods[@]}"; do herdr-app check "$app/mods/$(basename "$m")"; done
}

behind() {
  local now f v
  now="$(herdr-app --version | awk '{print $2}')"
  for f in "$repo"/mods/*/mod.json "$repo"/layouts/*.json; do
    v="$(jq -r '.cloned_from.version // empty' "$f")"
    [ -z "$v" ] || [ "$v" = "$now" ] || echo "  ${f#"$repo"/} is from Herdr $v, Herdr is $now"
  done
}

mkdir -p "$app/mods" "$app/layouts" "$HOME/.local/bin" "$HOME/.claude/skills" "$HOME/.agents/skills"
copy -a
for m in "${mods[@]}"; do
  for f in "$m"/*; do
    [ -f "$f" ] && [ -x "$f" ] && ln -sf "$app/mods/$(basename "$m")/$(basename "$f")" "$HOME/.local/bin/$(basename "$f")"
  done
done
for s in "$repo"/skills/*; do
  for dir in "$HOME/.claude/skills" "$HOME/.agents/skills"; do
    dest="$dir/$(basename "$s")"
    [ -L "$dest" ] || rm -rf "$dest"
    ln -sfn "$s" "$dest"
  done
done
check
stale="$(behind)"
[ -z "$stale" ] || printf 'Clones behind Herdr:\n%s\nRun ./upgrade.sh, or /herdr-mods-upgrade in Claude.\n' "$stale"

if [ "${1:-}" = "--watch" ]; then
  echo "Watching $repo (ctrl-c to stop)"
  while sleep 1; do
    changed="$(copy -ai --dry-run)"
    if [ -n "$changed" ]; then
      copy -a
      echo "$(date +%H:%M:%S) synced"; echo "$changed" | sed 's/^/  /'
      check || true
    fi
  done
else
  [ "$(herdr-app status 2>/dev/null | jq -r '.layout // empty' 2>/dev/null)" = "$layout" ] || herdr-app do layout.switch "{\"name\":\"$layout\"}" >/dev/null || true
  echo "Installed. Herdr is on the $layout layout; ctrl-shift-l switches layouts."
fi
