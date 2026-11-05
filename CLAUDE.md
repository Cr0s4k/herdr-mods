# herdr-show

A Herdr app mod: the Show panel, its markup editor, and the `herdr-show` command. See README.md.

## This repo is the source; Herdr runs a copy

Herdr loads mods from `~/.config/herdr-app/mods/`. Edit files **here**, never the copies there:
`./install.sh` (or a running `./install.sh --watch`) overwrites them.

Symlinking the mod folders into `~/.config/herdr-app` does not work: Herdr neither hot-reloads
through the link nor loads the mod's own SVG icons. That is why install copies.

## Working on it

- API truth: `~/.config/herdr-app/AGENTS.md`, `herdr.d.ts`, `gpui-kit.d.ts` (Herdr rewrites the
  `.d.ts` files into each mod folder; they're gitignored here).
- After every change: `./install.sh` then confirm `herdr-app check ~/.config/herdr-app/mods/show`
  passes and `herdr-app status` shows no errors. `herdr-app shot out.png` screenshots the window.
- `check` doesn't run the editor (it only opens with `props.editor`). To see it:
  `herdr-app do tab.new '{"name":"t","mod":"show","props":{"editor":"<item id>"}}'`, then close that tab.
- `mods/tabs-show` and `layouts/main-show.json` are clones of Herdr's shipped `tabs` and `main`.
  When Herdr updates those, the clones don't follow; re-clone and re-apply the Show button/slot.
- `render.swift` changes recompile automatically on the next save from the editor
  (`~/.cache/herdr-show/render` is rebuilt when the source is newer).
