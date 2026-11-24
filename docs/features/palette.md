# Command palette

`cmd-shift-p` on the main-custom layout opens Herdr's command palette with the mods' actions
added, in the same list and searched the same way. **⌘⇧P commands** at the bottom right opens
it too. Herdr's macOS menu item and Herdr's own layouts still open the plain palette.

What it adds:

- **Panel**: [Find file…](files-and-changes.md#find-file), open or close each side panel (Files, Git, Show, Brief, Loops, Skills,
  Watchers, Tasks, Linear), and move the open one into a pane. Panels switched off in Feature
  toggles stay out.
- **Pipeline**: open this space's Pipeline, start or pause it, add a task, merge or approve
  everything waiting, retry failed tasks, go to the next task that needs you, and open its
  Queue, Review, Pull requests, Completed, Activity, Schedule, Plan and Settings. From another
  tab, Pipeline opens first.
- **Review**: Changes + terminal in this tab, and the project on GitHub.
- **Agent**: [Find conversation…](spaces.md#find-conversation), beside Herdr's own agent commands.
- **Space**: a new space from `~/Projects`, hide this space for a while, hidden spaces, Focus
  this space (or All spaces again), Tidy, the Needs you filter, and keyboard focus in the
  sidebar.
- **Tab**, **Agent**, **App**: put the tab away, pin or unpin the focused agent, Feature toggles.

An action bound in `keys.json` shows its key, as Herdr's do: bind the action the palette runs,
such as `"tabs-show.brief"` or `"tabs-show.pipeline-approve"`.

## Where it lives

`mods/palette-plus/` is Herdr's palette (`frame/palette`, which Herdr rewrites on every start
and lets no mod extend), cloned. Our entries are `more()` in `more.js`; `main.js` only adds them
to the list and runs an entry's own `do` when it has one. An entry that targets another mod
(`tabs-show.<command>`, `spaces-pin.<command>`) is listed only while that mod is on screen,
since Herdr delivers mod commands to shown copies only.

- The tab bar (`mods/tabs-show`) takes `pipeline-<command>`: it opens Pipeline, then passes
  `<command>` on once Pipeline is shown.
- The sidebar (`mods/spaces-pin`) takes `tidy` and `needs-you` besides `focus`.
- Each side panel takes `pane` (`bindMoveCommand` in `mods/tabs-show/panel-actions.js`),
  which moves it into a pane with its current state, like its Move to pane button.

`./install.sh` binds `cmd-shift-p` to `mod.open:palette-plus` in the `layout:main-custom`
section of Herdr's `keys.json`, from the repo's `keys.json` through `scripts/keys.sh`. It does
this only when nothing is bound to the palette yet and you haven't bound `cmd-shift-p` in that
section.
