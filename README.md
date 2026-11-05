# herdr-show

A **Show** panel for the Herdr app (top right, next to Files and Changes). Claude posts
screenshots there; you mark them up, send them back, and the fixed screenshot lands
underneath.

```
pricing-card.png          ← Claude posts it
pricing-card.marked.png   ← you draw on it, add a note, "Save & send back"
pricing-card.fixed.png    ← Claude fixes it and posts the new screenshot
```

## Install

```sh
./install.sh
```

This copies the mods and layout into `~/.config/herdr-app`, links the `herdr-show` command
into `~/.local/bin`, installs the Claude skill, and switches Herdr to the `main-show` layout
(`ctrl-shift-l` switches back). The live copies are what Herdr runs: after editing here,
run `./install.sh` again.

## Use

From any terminal in Herdr (Claude does this itself, via the skill):

```sh
herdr-show shot.png --title "Landing page v2"   # post an image
herdr-show fixed.png --fixes <id>               # post the fix for a marked-up image
```

In the panel, click an image to mark it up: Pen, Arrow, Circle, Box, Text, numbered Pins,
five colors, ⌘Z to undo, a note field. **Save & send back** pastes the marked image's path,
your note and the `--fixes` command into the Claude terminal that posted the original.

## Pinned spaces

Right-click a space → **Pin to top**. Pinned spaces stay above the rest, with a pin icon and a
line under them. Drag a space above the line to pin it, below to unpin it. Pins are saved
in Herdr's shared state (`space.pinned`), so they survive restarts.

## What's in here

| Path | What it is |
|---|---|
| `mods/show/main.js` | the panel and the markup editor (a Herdr mod) |
| `mods/show/herdr-show` | the command that posts images and saves markups (Python) |
| `mods/show/render.swift` | burns the drawn marks into a PNG; compiled on first use to `~/.cache/herdr-show/render` |
| `mods/tabs-show/` | Herdr's tab bar, cloned, with the Show button added |
| `mods/spaces-pin/` | Herdr's Spaces sidebar, cloned, with pinned spaces on top |
| `mods/menu-pin/` | Herdr's right-click menu, cloned, with Pin / Unpin for spaces |
| `layouts/main-show.json` | Herdr's default layout, cloned, with the Show panel slot and `spaces-pin` |
| `skill/SKILL.md` | tells Claude to post images with `herdr-show` and how to handle send-backs |

Images and their metadata are stored in `~/.config/herdr-app/show/`.

Needs macOS (Swift toolchain, `sips`), Python 3 and the Herdr app.
