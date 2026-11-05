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
**Clear** removes every image in the current view and its stored copy and metadata. It
respects the space filter: switch to **All** to clear images across all spaces. Original
source files are kept.

Needs macOS (Swift toolchain, `sips`) and Python 3.

In Codex, `herdr-show` must run outside the sandbox: approve it when Codex asks, or choose
"don't ask again" for `herdr-show`. Codex's commands don't see the terminal's `HC_TERMINAL_ID`,
so `herdr-show` looks up the one agent working in that project instead.

## Files and Changes in a dialog

The Files and Changes panels only list; clicking a file opens it in a large dialog instead of
the narrow panel. ↑/↓ steps through the listed files, Esc closes.

- **Files** shows the file with syntax highlighting (Herdr's code view).
  Use **Collapse all folders** in its header to close every expanded folder at once.
- **Changes** shows the diff, **Split** (old and new side by side) or **Unified** (`S` toggles,
  and the choice sticks). Diffs are syntax-highlighted with [`bat`](https://github.com/sharkdp/bat)
  when it's installed (`brew install bat`), in the theme's terminal colors; without it they're plain.
- Both use VS Code's [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme)
  file and folder icons (MIT, vendored in `mods/files-modal/icons/`; `scripts/icons.sh` updates them).

## Loops

The **Loops** tab beside Show lists local **Codex and Claude `/goal` goals** and **Claude
scheduled `/loop` tasks**, labeled by source. It refreshes every ten seconds, with a manual refresh button. Codex goals show
status, tokens used (and budget when set), and working time. Budget usage is not a measure
of task completion.

**This space** follows the space's live terminal folders; **All projects** includes saved
goals and schedules from other local projects. **History** includes completed, failed,
cleared, cancelled, ended, expired, and inactive entries. The **Codex** and **Claude**
header buttons independently toggle each source; both start enabled. Claude includes
goals and scheduled tasks. Counts follow the selected sources. All filters are remembered.
**Open session** opens the exact Codex thread with
`codex resume` in a new tab. From a remote space it opens a local space instead.

Claude goals come from structured `goal_status` attachments in local session transcripts
under `$CLAUDE_CONFIG_DIR/projects` (default `~/.claude/projects`). **Saved goal** means the
last recorded goal is unresolved; it does not prove that Claude is still running. Token
spend, elapsed time, and evaluated turns appear when recorded, usually when the goal ends.
Clearing a goal is distinct from completing it. **Copy session ID** copies its exact session
ID. The panel never runs the Claude CLI, including when refreshing or clicking a Claude row.

Claude schedules come from confirmed `CronCreate`, `CronDelete`, `CronList`, and
`ScheduleWakeup` results and `session_cron_carry` snapshots in those same transcripts.
The panel also reads `.claude/scheduled_tasks.json` in known project folders (including
local Herdr spaces) and their parents. Project files are authoritative for durable tasks;
copied schedules belonging to another project are marked inactive. Both recurring and
one-shot cron tasks and self-paced wakeups appear with their prompt and schedule.

**Saved schedule** describes the last recorded state, not a running session. **Recorded
run** is the time Claude saved, including its scheduler offset; the panel does not invent
a live next-run time. **Run time passed** leaves execution unconfirmed. Confirmed
cancellations are distinct from tasks that ended with no outcome recorded. Recurring
tasks past Claude's seven-day lifetime appear as **Expired**; Claude may fire them one
final time before removal. Permanent project schedules do not expire. A project task
without a session ID offers **Copy task ID** instead.

The reader uses Python 3's SQLite support to read Codex's local `goals_*.sqlite` and
`state_*.sqlite` databases under `$CODEX_HOME` (default `~/.codex`). It never updates goal
state, Claude transcripts, or project schedule files. These are internal files: incompatible formats show an error
instead of silently showing an empty list. Each source refreshes independently; if one
fails, its previous entries stay visible with an error while the other sources update.
Cloud/Desktop schedules, Monitor-based loops without scheduler records, and remote goals
are not included.

## Pinned spaces

Hover a space and click its pin to pin it to the top. Pinned spaces always show the pin;
click it again to unpin. You can also right-click → **Pin to top**, or drag a space above
the line to pin it, below to unpin it. Pinned spaces stay above the rest, with a line under them. Pins are saved
in Herdr's shared state (`space.pinned`), so they survive restarts.

## What's in here

| Path | What it is |
|---|---|
| `mods/show/main.js` | Show: the panel and the markup editor |
| `mods/show/herdr-show` | Show: the command that posts images and saves markups (Python) |
| `mods/show/render.swift` | Show: burns the drawn marks into a PNG; compiled on first use to `~/.cache/herdr-show/render` |
| `mods/files-modal/` | Herdr's Files panel, cloned: the panel is the tree, a file opens in a dialog |
| `mods/files-modal/icons.js` | File and folder icon lookup, shared with Changes (`mods/changes-modal/icons.js` is a symlink; install copies it) |
| `scripts/icons.sh` | Downloads Material Icon Theme into `mods/files-modal/icons/` at a pinned version |
| `mods/changes-modal/` | Herdr's Changes panel, cloned: the panel lists files, the diff opens in a dialog |
| `mods/tabs-show/` | Herdr's tab bar, cloned, with Show and Loops buttons added |
| `mods/loops/` | Codex and Claude goals and scheduled loops panel, with Python readers |
| `mods/spaces-pin/` | Herdr's Spaces sidebar, cloned, with pinned spaces on top |
| `mods/menu-pin/` | Herdr's right-click menu, cloned, with Pin / Unpin for spaces |
| `mods/workspace-chrome-minimal/` | Herdr's sidebar header, cloned, without the logo and name; keeps Search and the sidebar toggle |
| `layouts/main-custom.json` | Herdr's default layout, cloned, using the mods above (`files-modal` and `changes-modal` replace `files` and `changes`) |
| `skills/herdr-show/` | tells Claude and Codex to post images with `herdr-show` and how to handle send-backs |
| `upgrade.sh` | merges a new Herdr version's originals into the clones (see Upgrading with Herdr) |
| `skills/herdr-mods-upgrade/` | `/herdr-mods-upgrade`: runs `upgrade.sh`, resolves conflicts, checks the result in Herdr |
| `upstream` branch | Herdr's originals of every clone, one commit per Herdr version |

## Upgrading with Herdr

Clones don't follow Herdr's updates by themselves. The `upstream` branch keeps Herdr's original of
every clone, one commit per Herdr version, so git can merge Herdr's changes into ours.

When Herdr updates, `./install.sh` lists the clones that are behind. Then:

```sh
./upgrade.sh                       # snapshot Herdr's new originals onto upstream, merge into main
git push origin main upstream
```

Conflicts are left for you, or run `/herdr-mods-upgrade` in Claude to resolve and verify them.
`git diff upstream main -- <path>` shows what a clone changes from Herdr's original.

## Adding a mod

1. Make `mods/<name>/` with `main.js` and `mod.json` (or `herdr-app do mod.clone '{"name":"<shipped mod>","as":"<name>"}'` and move the copy here).
2. If it belongs in the window, point a block in `layouts/main-custom.json` at it.
3. `./install.sh`. A new section here if it's a feature.
4. For a clone: sort its `mod.json` (`jq -S`), commit, then `./upgrade.sh` records Herdr's original on `upstream`.
