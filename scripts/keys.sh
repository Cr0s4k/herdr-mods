#!/usr/bin/env bash
# scripts/keys.sh <this repo's keys.json> <Herdr's keys.json>
# Adds the repo's shortcuts to Herdr's keys.json. A key you already bound in that section stays yours,
# and an action you already gave any key gets no second one.
# Never creates the file: any edit makes it the person's, which ends Herdr's updates to its defaults.
set -euo pipefail
ours="$1" mine="$2"
[ -f "$mine" ] || { echo "keys.json: $mine not found; start Herdr once, then install again"; exit 0; }
jq -e . "$mine" >/dev/null 2>&1 || { echo "keys.json: $mine isn't valid JSON; shortcuts not added"; exit 0; }
plan='. as $mine | [$mine[] | objects | .[] | strings] as $actions | $ours[0] | to_entries[] | .key as $s | .value | to_entries[]
  | .key as $k | .value as $v | ($mine[$s] // {}) as $have
  | if ($actions | index($v)) then empty
    elif ($have | has($k) | not) then {add: [$s, $k, $v]}
    else {kept: [$s, $k, $v, $have[$k]]} end'
jq -r --slurpfile ours "$ours" "$plan"' | if .add then "keys.json: added \(.add[1]) → \(.add[2] | tojson) (\(.add[0]))"
  else "keys.json: kept your \(.kept[1]) → \(.kept[3] | tojson) (\(.kept[0])); this repo binds \(.kept[2] | tojson)" end' "$mine"
merged="$(jq --slurpfile ours "$ours" 'reduce ('"$plan"' | .add // empty) as [$s, $k, $v] (.; .[$s][$k] = $v)' "$mine")"
[ "$merged" = "$(jq . "$mine")" ] || printf '%s\n' "$merged" > "$mine"
