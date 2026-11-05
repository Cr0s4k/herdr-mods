# herdr-mods

My additions to the Herdr app: mods, a layout that wires them in, and the
agent skills that go with them.

```sh
./install.sh           # copy everything into Herdr and switch to the main-custom layout
./install.sh --watch   # keep copying while you edit; Herdr reloads mods live
```

Install copies `mods/*` and `layouts/*` into `~/.config/herdr-app`, links any executable at the
top of a mod folder into `~/.local/bin`, and links each `skills/*` into `~/.claude/skills` (Claude Code) and `~/.agents/skills` (Codex).
`ctrl-shift-l` switches back to Herdr's own layouts.

## Show

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

Needs macOS (Swift toolchain, `sips`) and Python 3.

In Codex, `herdr-show` must run outside the sandbox: approve it when Codex asks, or choose
"don't ask again" for `herdr-show`. Codex's commands don't see the terminal's `HC_TERMINAL_ID`,
so `herdr-show` looks up the one agent working in that project instead.

## Changes in a modal

The Changes panel lists the changed files; clicking one opens its diff in a large dialog
instead of the narrow panel. **Split** shows old and new side by side, **Unified** one column
(`S` toggles, and the choice sticks). ↑/↓ steps through the changed files, Esc closes.

## Pinned spaces

Right-click a space → **Pin to top**. Pinned spaces stay above the rest, with a pin icon and a
line under them. Drag a space above the line to pin it, below to unpin it. Pins are saved
in Herdr's shared state (`space.pinned`), so they survive restarts.

## What's in here

| Path | What it is |
|---|---|
| `mods/show/main.js` | Show: the panel and the markup editor |
| `mods/show/herdr-show` | Show: the command that posts images and saves markups (Python) |
| `mods/show/render.swift` | Show: burns the drawn marks into a PNG; compiled on first use to `~/.cache/herdr-show/render` |
| `mods/changes-modal/` | Herdr's Changes panel, cloned: the panel lists files, the diff opens in a dialog |
| `mods/tabs-show/` | Herdr's tab bar, cloned, with the Show button added |
| `mods/spaces-pin/` | Herdr's Spaces sidebar, cloned, with pinned spaces on top |
| `mods/menu-pin/` | Herdr's right-click menu, cloned, with Pin / Unpin for spaces |
| `layouts/main-custom.json` | Herdr's default layout, cloned, using the mods above (`changes-modal` replaces `changes`) |
| `skills/herdr-show/` | tells Claude and Codex to post images with `herdr-show` and how to handle send-backs |

## Adding a mod

1. Make `mods/<name>/` with `main.js` and `mod.json` (or `herdr-app do mod.clone '{"name":"<shipped mod>","as":"<name>"}'` and move the copy here).
2. If it belongs in the window, point a block in `layouts/main-custom.json` at it.
3. `./install.sh`. A new section here if it's a feature.
