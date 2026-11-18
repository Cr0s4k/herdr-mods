#!/usr/bin/env python3
"""Turns a recorded run into the video's footage: the same moments, always at the same times.

    make-clip.py <run folder> <footage.mp4>

The run is retimed so each moment lands at a fixed second of the clip, however long the agents
took. The composition's captions, camera moves and sounds rely on these times (clip seconds):

    0.61 1.15 1.70 2.24   the four tasks join the queue
    3.2                   Start is pressed and the planner orders the work
    5.2                   the first agent is working
    8.6                   the first check or review
    14.0                  the last task has merged
    15.6                  end

Also writes <footage>.jpg, the first frame, which the composition shows behind its opening.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ADDED = [0.61, 1.15, 1.70, 2.24]
STARTED, WORKING, CHECKED, MERGED, END = 3.2, 5.2, 8.6, 14.0, 15.6
FPS = 30


def anchors(events, last):
    times = lambda *kinds: [event["t"] for event in events if event["kind"] in kinds]
    added, started, working, checked, merged = times("added"), times("started"), times("working"), times("testing", "review"), times("done")
    if len(added) != len(ADDED) or not (started and working and checked and merged):
        sys.exit("The run is incomplete: it needs four added tasks, a start, a working agent, a check or review, and a merge.")
    pairs = [(max(0, added[0] - 1.5), 0), *zip(added, ADDED), (started[0], STARTED), (min(working), WORKING),
             (min(checked), CHECKED), (max(merged), MERGED), (min(last, max(merged) + 4), END)]
    for (before, _), (after, _) in zip(pairs, pairs[1:]):
        if after < before:
            sys.exit("The run's moments are out of order; record it again.")
    return pairs


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    run, out = Path(sys.argv[1]), Path(sys.argv[2])
    frames = json.loads((run / "frames.json").read_text())
    pairs = anchors(json.loads((run / "events.json").read_text()), frames[-1]["t"])

    def source(t):
        for (real, clip), (next_real, next_clip) in zip(pairs, pairs[1:]):
            if t <= next_clip:
                return real + (t - clip) / (next_clip - clip) * (next_real - real)
        return pairs[-1][0]

    picks, at = [], 0
    for n in range(round(END * FPS)):
        wanted = source(n / FPS)
        while at + 1 < len(frames) and frames[at + 1]["t"] <= wanted:
            at += 1
        picks.append(frames[at]["file"])

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as listing:
        for name in picks:
            listing.write(f"file '{run / 'frames' / name}'\nduration {1 / FPS}\n")
    out.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = ["ffmpeg", "-y", "-loglevel", "error"]
    subprocess.run([*ffmpeg, "-f", "concat", "-safe", "0", "-i", listing.name, "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                    "-r", str(FPS), "-c:v", "libx264", "-crf", "17", "-preset", "slow", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", str(out)], check=True)
    subprocess.run([*ffmpeg, "-i", str(run / "frames" / picks[0]), "-q:v", "3", str(out.with_suffix(".jpg"))], check=True)
    Path(listing.name).unlink()
    print(f"{out}: {END}s from {pairs[-1][0] - pairs[0][0]:.0f}s of recording, {len(set(picks))} different frames")


if __name__ == "__main__":
    main()
