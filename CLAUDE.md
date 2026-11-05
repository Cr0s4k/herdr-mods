# herdr-mods

Additions to the Herdr app: mods, the `main-custom` layout that wires them in, and Claude
skills. See README.md for the features.

## This repo is the source; Herdr runs a copy

Herdr loads mods from `~/.config/herdr-app/mods/`. Edit files **here**, never the copies there:
`./install.sh` (or a running `./install.sh --watch`) overwrites them.

Symlinking the mod folders into `~/.config/herdr-app` does not work: Herdr neither hot-reloads
through the link nor loads the mod's own SVG icons. That is why install copies.

Install picks everything up by folder: every `mods/*`, `layouts/*.json` and `skills/*`, and any
executable at the top of a mod folder goes into `~/.local/bin`. A new mod needs no script edits.

## Working on it

- API truth: `~/.config/herdr-app/AGENTS.md`, `herdr.d.ts`, `gpui-kit.d.ts` (Herdr rewrites the
  `.d.ts` files into each mod folder; they're gitignored here).
- After every change: `./install.sh`; it runs `herdr-app check` on every mod. Then confirm
  `herdr-app status` shows no errors. `herdr-app shot out.png` screenshots the window.
- Mods sharing state use `shared(key)` / `setShared(key, value)`; there is no command to set it
  from outside. To test, drop a throwaway mod that calls it in `init` and open it with
  `herdr-app do tab.new '{"name":"t","mod":"<mod>"}'`, then remove both.
- The Show editor only opens with `props.editor`:
  `herdr-app do tab.new '{"name":"t","mod":"show","props":{"editor":"<item id>"}}'`.
- The Changes diff dialog only opens as an overlay with props `{root, on, hasHead, files, index}`.
  To test it, drop a throwaway mod whose `init` calls `openOverlay({mod: "changes-modal", kind:
  "dialog", width: 0.9, height: 0.9, props})` then `closeOverlay(props().overlay)`, and run
  `herdr-app do mod.open '{"name":"<mod>"}'` (no tab to clean up).
- `mods/tabs-show`, `mods/spaces-pin`, `mods/menu-pin`, `mods/changes-modal` and
  `layouts/main-custom.json` are clones of Herdr's shipped `tabs`, `spaces`, `menu`, `changes` and
  `main`. When Herdr updates those, the clones don't follow; re-clone and re-apply the changes
  (`git diff` against a fresh clone shows them).
- `render.swift` changes recompile automatically on the next save from the editor
  (`~/.cache/herdr-show/render` is rebuilt when the source is newer).
