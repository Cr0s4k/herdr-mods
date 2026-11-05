#!/usr/bin/env bash
# ./install.sh          copy into Herdr once
# ./install.sh --watch  keep copying on every save (Herdr reloads the mod live)
set -euo pipefail

repo="$(cd "$(dirname "$0")" && pwd)"
app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

sync() {
  rsync -a --exclude gpui-kit.d.ts --exclude jsconfig.json "$repo/mods/show" "$repo/mods/tabs-show" "$app/mods/"
  rsync -a "$repo/layouts/main-show.json" "$app/layouts/"
}

mkdir -p "$app/mods" "$app/layouts" "$HOME/.local/bin" "$HOME/.claude/skills"
chmod +x "$repo/mods/show/herdr-show"
sync
ln -sf "$app/mods/show/herdr-show" "$HOME/.local/bin/herdr-show"
[ -L "$HOME/.claude/skills/herdr-show" ] || rm -rf "$HOME/.claude/skills/herdr-show"
ln -sfn "$repo/skill" "$HOME/.claude/skills/herdr-show"
herdr-app check "$app/mods/show"
herdr-app check "$app/mods/tabs-show"

if [ "${1:-}" = "--watch" ]; then
  echo "Watching $repo (ctrl-c to stop)"
  while sleep 1; do
    changed="$(rsync -ai --dry-run --exclude gpui-kit.d.ts --exclude jsconfig.json "$repo/mods/show" "$repo/mods/tabs-show" "$app/mods/"; rsync -ai --dry-run "$repo/layouts/main-show.json" "$app/layouts/")"
    if [ -n "$changed" ]; then
      sync
      echo "$(date +%H:%M:%S) synced"; echo "$changed" | sed 's/^/  /'
      herdr-app check "$app/mods/show" || true
    fi
  done
else
  herdr-app do layout.switch '{"name":"main-show"}' >/dev/null || true
  echo "Installed. Show is in the tab bar; ctrl-shift-l switches layouts."
fi
