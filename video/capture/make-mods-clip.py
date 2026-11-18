#!/usr/bin/env python3
"""Turns a record-mods.py run into the video's mods footage, each moment at a fixed second.

    make-mods-clip.py <run folder> <mods.mp4>

Clip seconds the composition relies on:

    0.0   the Show panel opens          3.6   the Changes panel     6.2   the Files panel
    0.5   a screenshot is posted        4.3   a diff in the dialog  6.8   a file in the dialog
    1.6   the marked-up copy            5.9   the dialog closes     8.4   the dialog closes
    2.7   the fix arrives
    8.4   Since you left, with a handoff 10.8  the watcher is set   11.3  its toast
                                                                    13.6  end

Also writes <mods>.jpg, the first frame.
"""
import json
import sys
from pathlib import Path

from importlib import import_module

write = import_module("make-clip").write

MOMENTS = [("show", 0.0), ("show-posted", 0.5), ("show-marked", 1.6), ("show-fixed", 2.7),
           ("changes", 3.6), ("changes-dialog", 4.3), ("changes-closed", 5.9),
           ("files", 6.2), ("files-dialog", 6.8), ("files-closed", 8.4),
           ("brief", 8.4), ("watch", 10.8), ("watch-fired", 11.3), ("end", 13.6)]


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    run, out = Path(sys.argv[1]), Path(sys.argv[2])
    frames = json.loads((run / "frames.json").read_text())
    when = {event["kind"]: event["t"] for event in json.loads((run / "events.json").read_text())}
    missing = [kind for kind, _ in MOMENTS if kind not in when]
    if missing:
        sys.exit(f"The run is incomplete: no {', '.join(missing)}.")
    pairs = [(when[kind], clip) for kind, clip in MOMENTS]
    for (before, _), (after, _) in zip(pairs, pairs[1:]):
        if after < before:
            sys.exit("The run's moments are out of order; record it again.")
    write(run, frames, pairs, MOMENTS[-1][1], out)


if __name__ == "__main__":
    main()
