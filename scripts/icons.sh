#!/usr/bin/env bash
# Vendors Material Icon Theme (MIT) into mods/files-modal/icons. Bump the version and rerun to update.
set -euo pipefail
version=5.40.0
repo="$(cd "$(dirname "$0")/.." && pwd)"
dest="$repo/mods/files-modal/icons"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

(cd "$tmp" && npm pack "material-icon-theme@$version" --silent >/dev/null && tar xzf "material-icon-theme-$version.tgz")
rm -rf "$dest"
mkdir -p "$dest"
cp "$tmp"/package/icons/*.svg "$dest/"
cp "$tmp/package/LICENSE" "$dest/LICENSE"

python3 -I - "$tmp/package/dist/material-icons.json" "$dest/index.json" "$version" <<'EOF'
import json, os, sys
src, out, version = sys.argv[1:]
m = json.load(open(src))
stem = {k: os.path.basename(v["iconPath"])[:-4] for k, v in m["iconDefinitions"].items()}
maps = ("fileExtensions", "fileNames", "folderNames", "folderNamesExpanded")
pick = lambda d: {k: stem[v] for k, v in d.items() if v in stem}
data = {"version": version, **{k: stem[m[k]] for k in ("file", "folder", "folderExpanded")}, **{k: pick(m.get(k, {})) for k in maps}}
data["light"] = {k: pick(m.get("light", {}).get(k, {})) for k in maps}
json.dump(data, open(out, "w"), separators=(",", ":"))
EOF
echo "Material Icon Theme $version: $(ls "$dest"/*.svg | wc -l | tr -d ' ') icons in $dest"
