#!/usr/bin/env bash
# ./video/render.sh   check and render the composition, then write docs/herdr-mods.mp4
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
docs="$here/../docs"
poster_at="${POSTER_AT:-9.6}"

cd "$here/composition"
npm run --silent check
npm run --silent render -- --quality delivery --video-frame-format png --output "$here/render.mp4"

ffmpeg -y -loglevel error -ss "$poster_at" -i "$here/render.mp4" -frames:v 1 -q:v 2 "$here/poster.jpg"
# Players and chat apps show frame 0 as the thumbnail, so frame 0 becomes the poster.
ffmpeg -y -loglevel error -i "$here/render.mp4" -i "$here/poster.jpg" \
  -filter_complex "[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]" -map "[v]" -map "0:a?" \
  -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -c:a copy -movflags +faststart "$docs/herdr-mods.mp4"
rm -f "$here/render.mp4" "$here/poster.jpg"
ls -lh "$docs/herdr-mods.mp4" | awk '{print $5, $9}'
