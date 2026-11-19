#!/usr/bin/env bash
# scripts/keys.sh <this repo's keys.json> <Herdr's keys.json>
# Adds the repo's shortcuts to Herdr's keys.json. A key you already bound in that section stays yours.
set -euo pipefail
ours="$1" mine="$2"
[ -f "$mine" ] || { echo "keys.json: $mine not found; start Herdr once, then install again"; exit 0; }
jq -e . "$mine" >/dev/null 2>&1 || { echo "keys.json: $mine isn't valid JSON; shortcuts not added"; exit 0; }
jq -r --slurpfile ours "$ours" '. as $mine | $ours[0] | to_entries[] | .key as $s | .value | to_entries[]
  | .key as $k | .value as $v | ($mine[$s] // {}) as $have
  | if ($have | has($k) | not) then "keys.json: added \($k) → \($v | tojson) (\($s))"
    elif $have[$k] != $v then "keys.json: kept your \($k) → \($have[$k] | tojson) (\($s)); this repo binds \($v | tojson)"
    else empty end' "$mine"
merged="$(jq --slurpfile ours "$ours" 'reduce ($ours[0] | to_entries[] | .key as $s | .value | to_entries[] | [$s, .key, .value]) as [$s, $k, $v]
  (.; if (.[$s] // {}) | has($k) then . else .[$s][$k] = $v end)' "$mine")"
[ "$merged" = "$(jq . "$mine")" ] || printf '%s\n' "$merged" > "$mine"
