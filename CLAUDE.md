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
- In a Git worktree (Pipeline tasks run in `~/.herdr/worktrees/…`), never run `./install.sh`:
  it replaces the mods every session is running with your unmerged branch, and the last install
  wins. Run the tests and `herdr-app check` instead, on a copy made the way install makes it
  (`rsync -a --copy-links mods/<mod>/ <scratch>/<mod>/`; a mod with symlinked modules fails the
  check in place). Pipeline's After merge command (`./install.sh`, in Settings → Delivery)
  installs the merged state from the main checkout; where it isn't set, say in your report
  that the change still needs an install from the main checkout after merging.
- Mods sharing state use `shared(key)` / `setShared(key, value)`; there is no command to set it
  from outside. To test, drop a throwaway mod that calls it in `init` and open it with
  `herdr-app do tab.new '{"name":"t","mod":"<mod>"}'`, then remove both.
- The Show editor only opens with `props.editor`:
  `herdr-app do tab.new '{"name":"t","mod":"show","props":{"editor":"<item id>"}}'`.
- The dialogs only open as overlays: `changes-modal` with props `{root, on, hasHead, files, index}`
  (files as the panel holds them), `files-modal` with `{root, on, files: [paths], index, marks}`.
  To test one, drop a throwaway mod whose `init` calls `openOverlay({mod, kind: "dialog", width:
  0.9, height: 0.9, props})` then `closeOverlay(props().overlay)`, and run
  `herdr-app do mod.open '{"name":"<mod>"}'` (no tab to clean up). Herdr keeps a mod's old code
  when you rewrite it right away; use a new throwaway name per change.
- Mods whose `mod.json` has `cloned_from`, and `layouts/main-custom.json`, are clones of Herdr's
  shipped mods and layout. The `upstream` branch holds Herdr's originals of them, one commit per
  Herdr version, so `git diff upstream main -- <path>` shows only our changes. When Herdr updates
  (`./install.sh` lists clones behind it), follow `skills/herdr-mods-upgrade/SKILL.md`.
- In a clone, keep Herdr's functions where they are and add ours beside them; edit Herdr's lines
  only where the feature needs it. Merges of new Herdr versions stay clean that way.
- After cloning another shipped mod (with `cloned_from` in its `mod.json`), run `./upgrade.sh`
  once: it records the original on `upstream`.
- Keep `mod.json` and layout JSON key-sorted (`jq -S`), the format `upstream` uses; any other
  formatting makes every merge conflict.
- A mod can't import from another mod's folder or read files there with `fs`. To share a module,
  symlink it into the other mod (install copies with `--copy-links`) and read data with
  `readTextFile`, as `changes-modal/icons.js` does.
- `render.swift` changes recompile automatically on the next save from the editor
  (`~/.cache/herdr-show/render` is rebuilt when the source is newer).
