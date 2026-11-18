# herdr-mods

Mods for [Herdr](https://herdr.dev), the terminal app for running coding agents side by side:
a task pipeline, panels for screenshots, tickets, goals and watchers, a sidebar that shows
agents under their spaces, and the agent skills that go with them.

This is an unofficial, personal setup, shared as is. It isn't affiliated with Herdr. It
follows the newest Herdr release (0.1.16 at the time of writing) and is used daily on macOS
only; read [Things to know](#things-to-know) before installing. Take the whole thing, or copy
the mods you like.

https://github.com/user-attachments/assets/1c97a315-838d-42fa-90b8-b539f15e33da

Real runs, sped up, on a throwaway repository: Pipeline first, then a few seconds of each panel. Click it for the version with sound.

## What you get

| Feature | What it does | Guide |
|---|---|---|
| **Pipeline** | Queue tasks, typed or from Plane and Linear tickets. Each one gets its own Git worktree and agent (Claude Code, Codex or OpenCode), is checked, then waits for your review and merges or opens a pull request. Includes a planner, usage-limit holds, a schedule and a demo mode. | [pipeline.md](docs/features/pipeline.md) |
| **Show** | Agents post screenshots to a panel; you draw on them and send them back. | [show.md](docs/features/show.md) |
| **Files and Changes** | Files and diffs open in a large dialog, with push and pull counts, image previews and Material file icons. Any panel can move into a normal pane. | [files-and-changes.md](docs/features/files-and-changes.md) |
| **Tasks** | Plane and Linear tickets beside your terminals, with handoff to an agent or a batch launch into worktrees. | [tasks.md](docs/features/tasks.md) |
| **Spaces and agents** | One sidebar tree of spaces, their agents and terminals, with pins, a Needs you filter, focus, timed hiding, Tidy and keyboard control. | [spaces.md](docs/features/spaces.md) |
| **Since you left** | A per-space feed of what agents finished and what they need from you. | [brief.md](docs/features/brief.md) |
| **Watchers** | Get told when a pull request is reviewed, checked or merged, or when a shell command succeeds. | [watchers.md](docs/features/watchers.md) |
| **Loops** | Lists Codex, Claude and OpenCode `/goal` goals and Claude's scheduled `/loop` tasks. | [loops.md](docs/features/loops.md) |
| **Skills** | A searchable inventory of the agent skills available in a folder and on the machine. | [skills.md](docs/features/skills.md) |
| **Tab bar** | A GitHub button for the current project, and on/off switches for most of the above. | [tab-bar.md](docs/features/tab-bar.md) |

## Install

You need Herdr with its `herdr-app` command, macOS, Git, Python 3 and `jq`. Some features need
more:

- pull requests and Watchers: GitHub's `gh`, signed in
- Show: the Swift toolchain (Xcode command line tools)
- highlighted diffs: [`bat`](https://github.com/sharkdp/bat)

```sh
git clone https://github.com/Cr0s4k/herdr-mods.git
cd herdr-mods
./install.sh           # copy everything into Herdr and switch to the main-custom layout
./install.sh --watch   # keep copying while you edit; Herdr reloads mods live
```

Install does three things:

- copies `mods/*` and `layouts/*` into `~/.config/herdr-app`, replacing mods of the same name
  that are already there
- links any executable at the top of a mod folder (`herdr-show`, `herdr-watch`,
  `herdr-pipeline`, …) into `~/.local/bin`
- links each `skills/*` into `~/.claude/skills` (Claude Code) and `~/.agents/skills` (Codex)

`ctrl-shift-l` switches back to Herdr's own layouts at any time. To remove everything, switch
layout, then delete those copies and links.

## Things to know

**Credentials.** Nothing here sends data anywhere except the services you connect, and there
is no telemetry. Three features read credentials on your machine:

- **Pipeline's usage limits** read Claude Code's own login from the macOS keychain (or
  `~/.claude/.credentials.json`) and send it only to Anthropic's usage endpoint, which is
  undocumented and may change. The token is kept in memory and never written anywhere.
- **Linear** reuses Claude Code's Linear MCP login when there is one, read from the same
  places and sent only to Linear's MCP server. You can give it its own API key instead, saved
  with owner-only permissions in `~/.config/herdr-app/linear/credentials.json`.
- **Plane** saves your instance URL and access token with owner-only permissions in
  `~/.config/herdr-app/plane/credentials.json`.

Loops, Skills and Pipeline's token counts also read your agents' local session files
(Claude Code, Codex, OpenCode), read-only.

**Agents act on your repositories.** Live Pipeline starts real agents, creates worktrees and
branches, and merges or pushes when you approve (or by itself, if you turn that on). Try the
demo first: Pipeline's Settings, General, **Try a demo**.

## Working on it

Herdr runs a copy, so edit the files here and let `./install.sh --watch` copy them over.
Tests need no setup:

```sh
node --test tests/*.test.mjs
python3 -m pytest tests
```

[docs/pipeline.md](docs/pipeline.md) explains Pipeline's code. [CLAUDE.md](CLAUDE.md) holds
the working notes agents follow in this repository; they are useful to people too.

## What is in here

| Path | What it is |
|---|---|
| `mods/show/main.js` | Show: the panel and the markup editor |
| `mods/show/herdr-show` | Show: the command that posts images and saves markups (Python) |
| `mods/show/render.swift` | Show: burns the drawn marks into a PNG; compiled on first use to `~/.cache/herdr-show/render` |
| `mods/files-modal/` | Herdr's Files panel, cloned: the panel is the tree, a file opens in a dialog |
| `mods/files-modal/icons.js` | File and folder icon lookup, shared with Changes (`mods/changes-modal/icons.js` is a symlink; install copies it) |
| `scripts/icons.sh` | Downloads Material Icon Theme into `mods/files-modal/icons/` at a pinned version |
| `mods/changes-modal/` | Herdr's Changes panel, cloned: the panel lists files, the diff opens in a dialog |
| `mods/review-pane/` | Changes inside a normal pane, sharing the existing view through a symlink |
| `mods/files-pane/`, `mods/show-pane/`, `mods/loops-pane/` | Normal pane versions of the existing panels, sharing their views through symlinks |
| `mods/tabs-show/panel-actions.js` | Shared Move to pane action and keyboard-focus handling |
| `mods/pane-titles/` | Herdr's pane header, cloned, with a readable Changes title for review panes |
| `mods/tabs-show/` | Herdr's tab bar, cloned, with Show and Loops buttons added |
| `mods/loops/` | Codex, Claude and OpenCode goals and scheduled loops panel, with Python readers |
| `mods/skills/`, `mods/skills-pane/` | Skills inventory and reader, with shared-file deduplication, scope and agent filters, and a normal pane view |
| `mods/brief/`, `mods/brief-pane/` | Since you left: per-space activity, persistent handoffs, unread history and pane view |
| `mods/watchers/`, `mods/watchers-pane/` | Watchers: the panel, the checker running in the tab bar (`watchers-tracker.js`), the `herdr-watch` command (Python) and a pane view |
| `skills/herdr-watch/` | tells agents how to set a watcher with `herdr-watch` instead of polling |
| `skills/herdr-brief/` | tells agents how to post results, validation and open questions using `herdr-brief` |
| `mods/spaces-pin/` | Unified Spaces and Agents tree, with pinned spaces, agent statuses and a Needs you filter |
| `mods/space-new/` | Space creation menu and searchable `~/Projects` picker, sharing the Changes + terminal layout |
| `mods/menu-pin/` | Herdr's right-click menu, cloned, with Hide, Pin / Unpin and Focus this space |
| `mods/toggles/` | Feature toggles popup, opened from the tab bar; it sizes itself to its rows (`mods/tabs-show/toggles.js` is a symlink) |
| `mods/space-hide/` | Timed hiding, custom local deadlines and early restoration of spaces |
| `mods/workspace-status-git/` | Herdr's bottom status bar, cloned, with commits to push and pull beside the branch |
| `mods/changes-modal/sync.js` | Reads the branch's ahead/behind counts, shared with the status bar and review pane through symlinks |
| `mods/workspace-chrome-minimal/` | Herdr's sidebar header, cloned, without the logo and name; keeps Search and the sidebar toggle |
| `layouts/main-custom.json` | Herdr's default layout, cloned, using the mods above (`files-modal` and `changes-modal` replace `files` and `changes`) |
| `skills/herdr-show/` | tells Claude and Codex to post images with `herdr-show` and how to handle send-backs |
| `upgrade.sh` | merges a new Herdr version's originals into the clones (see Upgrading with Herdr) |
| `video/` | The README's video: scripts that record a real Pipeline run and the other mods on a throwaway repository, and the Hyperframes composition that turns them into `docs/herdr-mods.mp4` and `docs/herdr-mods.gif` |
| `skills/herdr-mods-video/` | `/herdr-mods-video`: re-records and re-renders that video |
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
3. `./install.sh`. For a feature, add a guide in `docs/features/` and a row in the table above.
4. For a clone: sort its `mod.json` (`jq -S`), commit, then `./upgrade.sh` records Herdr's original on `upstream`.

## Licence

Apache 2.0, the licence Herdr's own mods carry; see [LICENSE](LICENSE). [NOTICE](NOTICE) lists what
comes from Herdr and from Material Icon Theme.
