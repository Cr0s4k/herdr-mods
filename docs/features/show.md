# Show

A **Show** panel (top right, next to Files and Changes). Claude or Codex posts screenshots there; you
mark them up, send them back, and the fixed screenshot lands underneath.

```
pricing-card.png          ← the agent posts it
pricing-card.marked.png   ← you draw on it, add a note, "Save & send back"
pricing-card.fixed.png    ← the agent fixes it and posts the new screenshot
```

From any terminal in Herdr (the agent does this itself, via the `herdr-show` skill):

```sh
herdr-show shot.png --title "Landing page v2"   # post an image
herdr-show fixed.png --fixes <id>               # post the fix for a marked-up image
```

In the panel, click an image to mark it up: Pen, Arrow, Circle, Box, Text, numbered Pins,
five colors, ⌘Z to undo, a note field. **Save & send back** pastes the marked image's path,
your note and the `--fixes` command into the agent terminal that posted the original.
Images and their metadata are stored in `~/.config/herdr-app/show/`.
**Clear** removes every image in the current view and its stored copy and metadata. It
respects the space filter: switch to **All** to clear images across all spaces. Original
source files are kept.

Needs macOS (Swift toolchain, `sips`) and Python 3.

In Codex, `herdr-show` must run outside the sandbox: approve it when Codex asks, or choose
"don't ask again" for `herdr-show`. Codex's commands don't see the terminal's `HC_TERMINAL_ID`,
so `herdr-show` looks up the one agent working in that project instead.
