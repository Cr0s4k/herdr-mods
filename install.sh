#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "$0")" && pwd)"
app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

mkdir -p "$app/mods" "$app/layouts" "$HOME/.local/bin" "$HOME/.claude/skills/herdr-show"
cp -R "$repo/mods/show" "$repo/mods/tabs-show" "$app/mods/"
cp "$repo/layouts/main-show.json" "$app/layouts/"
chmod +x "$app/mods/show/herdr-show"
ln -sf "$app/mods/show/herdr-show" "$HOME/.local/bin/herdr-show"
cp "$repo/skill/SKILL.md" "$HOME/.claude/skills/herdr-show/SKILL.md"

herdr-app check "$app/mods/show"
herdr-app check "$app/mods/tabs-show"
herdr-app do layout.switch '{"name":"main-show"}' >/dev/null || true
echo "Installed. Show is in the tab bar; ctrl-shift-l switches layouts."
