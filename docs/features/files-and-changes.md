# Files and Changes in a dialog

The Files and Changes panels only list; clicking a file opens it in a large dialog instead of
the narrow panel. ↑/↓ steps through the listed files, Esc closes.

- **Files** shows the file with syntax highlighting (Herdr's code view).
  Use **Collapse all folders** in its header to close every expanded folder at once.
- **Changes** shows the diff, **Split** (old and new side by side) or **Unified** (`S` toggles,
  and the choice sticks). Diffs are syntax-highlighted with [`bat`](https://github.com/sharkdp/bat)
  when it's installed (`brew install bat`), in the theme's terminal colors; without it they're plain.
- Images (PNG, JPEG, GIF, WebP, BMP, ICO, AVIF, TIFF) show as pictures: in Files on their own,
  in Changes as **Before** (`HEAD`) and **After** (working copy) side by side, like GitHub. SVGs
  stay text. Local folders only; the copies Herdr needs to load them live in
  `~/.config/herdr-app/data/image-preview/` and are deleted after a day.
- The bottom of **Changes** shows the branch and, like VS Code, how many commits are waiting:
  **↑N Push** for local commits not yet pushed, **↓N Pull** for commits on the remote you don't
  have. It fetches when the folder changes and every 3 minutes (**↻** fetches now). A branch
  with no upstream shows **Publish** (`git push -u origin HEAD`). Pull runs plain `git pull`, so
  your `pull.rebase` setting applies; failures show in red above the bar.
  The bottom status bar shows the same counts beside the space's branch (`main ↑2 ↓1`), only when
  there is something to push or pull. Click **↓N** to pull or **↑N** to push; a failure shows in
  red beside them for a few seconds. It checks every 10 seconds and fetches every 3 minutes.
- Both use VS Code's [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme)
  file and folder icons (MIT, vendored in `mods/files-modal/icons/`; `scripts/icons.sh` updates them).

## Find file

**⇧⌘N** (or the magnifier in the Files header) searches the focused pane's project by file name,
like VS Code's Go to File. Letters match in order with gaps between them, so `fmain` finds
`files-modal/main.js`; a space separates words that all have to match. Matches in the file name,
at the start of a word and in a run rank first. With nothing typed, it lists the files you
opened from it recently, then the changed ones (marked M, A or U like in Files).

↑/↓ picks, Enter opens the file in the same dialog as Files, where ↑/↓ then
steps through the other matches. Esc closes.

- It searches the whole Git repository the pane is in: tracked and untracked files, without
  ignored ones. Outside Git it searches the pane's folder, skipping hidden folders and
  `node_modules`. Very large projects are cut at about 60,000 paths, and the popup says so.
- The matching runs inside the mod, in the style of [fzf](https://github.com/junegunn/fzf),
  so nothing needs installing and it works on spaces on other machines.
- Install adds the key to `global` in `~/.config/herdr-app/keys.json`, so it works in every
  layout, and never replaces a key you set there. To use another key, bind it to
  `mod.open:find-file` and set `"cmd-shift-n"` to something else; the Files button's tooltip
  shows whichever key you chose.

**Changes + terminal** is a separate action beside the Files, Changes, Show and Loops side-panel
toggles. It opens Changes as a normal pane on the right, with a normal terminal pane below
it, starting at equal height. Once open, the action becomes **Focus changes** and returns
to that pane without creating another terminal or closing your chosen side panel.
Pane navigation, swapping, dragging, splitting, zooming and closing use Herdr's usual
shortcuts and controls. The arrangement belongs to its tab and Herdr remembers it.
**Changes** toggles the normal side panel, just like Files, Show and Loops. It works
independently of the review panes, so either view is available when you want it.

Files, Changes, Show and Loops each have a **Move to pane** icon in their side-panel header.
It opens that view as a normal pane in the current tab, then hides the side panel. New panes
keep the current folder expansion, commit draft or filters. If that view already has a pane
in the tab, the action focuses it and keeps its existing state. These panes support the usual
navigation, drag, split, zoom and close controls. Use the toolbar toggle whenever you want
the side panel again. Moving a panel does not start a terminal; **Changes + terminal**
remains the shortcut for the paired layout.
