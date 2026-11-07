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

## Skills

**Skills** in the top toolbar opens a searchable inventory for the working folder and
machine. **Available here** combines discovered project and personal skills with skills
from plugins enabled in local configuration. **Personal library** shows personal,
managed, built-in and cached plugin skills, including disabled or unverified copies.
Filter either view by **All agents**, **Codex** or **Claude**. Plugin and built-in groups
start collapsed; searching also searches inside them.

Claude's `skills/synced/` cache is classified from its sync manifest: Anthropic-provided
skills appear under **Built-in skills**, plugin-provided skills under **Plugin skills**,
and other synced skills under **Account skills**. They are separate from authored
personal skills. Unlisted cached files remain unverified in Personal library. Synced
skills use the full `/anthropic-skills:<name>` invocation to avoid local-name collisions.

Skills linked to the same file appear once, with both agent labels when applicable.
Different files with the same name stay separate. Open a skill to read its Markdown,
inspect its original source and discovery locations, or copy its path or agent-specific
invocation. Copying never sends text to a terminal. **Move to pane** keeps the filters and
search and binds the view to that tab.

The inventory reads `.agents/skills`, `.codex/skills`, and `.claude/skills` from the
working folder and its repository ancestors, plus personal skills under `~/.agents`,
`$CODEX_HOME` (default `~/.codex`) and `$CLAUDE_CONFIG_DIR` (default `~/.claude`). It also
reads Claude's legacy commands and plugin registry, Codex's plugin cache and skill
configuration, Codex's on-disk built-ins, and `/etc/codex/skills` when present.
The reader runs on the selected space's machine, using Python 3, and refreshes every
15 seconds or manually. The folder follows terminal focus; a moved pane stays in its tab.

This is **filesystem discovery, not a running agent's loaded-skills list**. Per-session
options, trust, managed policies, account state and agent versions can change what loads.
Cached Codex plugins without confirmed enablement, or with multiple cached versions,
appear only in Personal library as unverified. Claude's built-ins that have no local
manifest are not indexed. A plain repository `skills/` folder contains source files and
does not itself install those skills for either agent.

## Linear

**Linear** in the toolbar opens your tickets beside the terminals. Choose **My tickets**,
**Unassigned**, or **All**, search titles and descriptions, and filter by a Linear project.
The project selection is remembered per space. Closed tickets start hidden; **Include done**
shows them. Results load 50 at a time, with **Load more tickets** for the next page. The
footer distinguishes visible tickets from loaded results. Refresh runs every minute while
browsing; failed refreshes keep the last results and show the error.

Open a ticket to read its full Markdown description or open it in Linear. Linear's collapsible
description sections start closed; click their heading to expand or collapse them. Nested
sections toggle independently, and agent handoffs always include the full description.
**Assign to agent…**
shows the working folder and machine, installed agents for a new session, and idle agents
already in that exact folder and space. Add optional instructions, then **Start agent with
ticket** or **Send task to agent**. The task includes the description, link, priority,
project and recorded blockers. A new session opens in a tab named after the ticket; sending
to an existing agent rechecks its folder and idle state. **Copy task** is also available.
These actions hand work to a Herdr agent; they do not change the ticket's Linear assignee
or status. **Move to pane** preserves the current filters and binds the view to that tab.

For parallel work, choose **Select tickets**, click the tickets you want, then **Launch N…**.
**Select shown** selects only the currently visible, loaded results; selections survive
searches and filters in the same space. Review the destination, starting commit, agent and
recorded blockers, add optional shared instructions, and choose **Launch N agents**.
Remove dependent tickets from the review if they should wait: the launcher starts all
selected tickets and does not schedule dependencies.

Each ticket gets a new branch and Git worktree under `~/.herdr/worktrees/` on the destination
machine, starting at the same reviewed commit. A selected subfolder is preserved. Uncommitted
changes stay in the source checkout; they are not copied into worktrees. Each agent opens in
a worktree space with a ticket-named tab, leaving your current view selected. Ordinary
single-ticket handoffs above still use the selected folder.

**Launches** shows per-ticket startup progress and returns to each opened agent. Closing
the panel does not stop launch preparation: its worker belongs to the `main-custom`
toolbar. **Stop remaining launches** leaves existing agents and worktrees in place.
**Retry failed** retries definite failures only, reusing a worktree when one was already
created. An unconfirmed start or app reload is marked **Check workspace** and is never
automatically replayed; **Allow new launch** releases that ticket after you check that
it has no agent running. Active launches and live sessions, including parked terminals,
prevent duplicate launches from another panel. Worktrees are retained for review, and
changes are never merged automatically. The newest 20 finished launch records and all
active records are kept in Herdr's shared state.

The reader reuses an existing Claude Code Linear MCP login from its credential file or the
standard macOS keychain entry. Claude continues to manage that login: if it expires, reconnect
with Claude's `/mcp`. Herdr does not copy, refresh, or modify Claude's credentials. For a
separate connection, use the header's **Linear connection** settings button, then **Connect
with API key**. A local terminal asks privately for a key with Read permission, validates it,
and saves it with owner-only permissions at `~/.config/herdr-app/linear/credentials.json`.
Return to the panel and refresh. The same setup is available with `herdr-linear connect`.
The reader prefers `LINEAR_API_KEY`, then its saved key, then Claude's login.

Linear access uses the [official MCP server](https://linear.app/docs/mcp), with only read
operations, and Python 3's standard library. Ticket access and credentials stay on this
computer; a selected remote machine is only the destination for an agent handoff.

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

## Since you left

The **Brief** toolbar button opens a persistent handoff for the current space. Its
count shows unread results and requests for input. **Mark as read** clears that view; **History**
keeps reviewed updates available. Opening a space or focusing an agent does not
mark its brief read. Each space has its own read receipts, even when several
spaces share a project folder.

While Herdr is open on `main-custom`, the toolbar records requests for input
across spaces. Finishing a turn no longer creates an update. Existing finished-turn
notices and routine reports whose title and opening sentence announce a commit or
push are kept in **History**, without adding to the unread count. Reports with
questions, caveats or reported failures remain in the main feed. The initial agent state
is a baseline; activity while the app is closed is not reconstructed.

For substantive results, Codex and Claude can leave a handoff using the installed
`herdr-brief` skill and command:

```sh
herdr-brief post --title "Hide quiet spaces" \
  --summary "Hide a space until a time you choose." \
  --change "Terminals keep running; restore early from Hidden spaces." \
  --test "All sidebar tests passed; checked hiding and early restore in the app."
```

Briefs show a short title and a one-sentence summary. **Read more** expands
optional practical changes. Questions stay visible under
**Needs your answer**. Use `--caveat` for important failures or limitations; these
stay visible under **Keep in mind**. Validation stays in the saved record and is
not displayed in the panel. Older briefs without caveats still load normally. The installed
skill asks for plain-language outcomes and skips routine commit, push and status notices. The optional flags
repeat. **Open conversation** (or **Reply to agent**) returns to
the handoff's exact live terminal in its original space. Handoffs are routed by
terminal identity, with a unique working agent in the exact task folder as a
fallback; ambiguous matches fail instead of using the focused space. The command
uses local `herdr-app` and `hc` access. Existing agents may need to load the new
skill before they start posting richer handoffs.

The panel can **Move to pane** like the other panels. A moved brief remains bound
to its tab's space. Shared activity and read receipts survive restarts. Handoffs
are stored atomically under `~/.config/herdr-app/brief/items/`; the panel loads the
newest 500 handoffs and retains the last 500 observed events across spaces. It
refreshes handoffs every ten seconds, keeps previous results on errors, and never
reads terminal transcripts or treats a status indicator as a test result.

## Spaces and agents

The sidebar **+** offers **New space** for the usual terminal, or **From a project…**
to search the folders in `~/Projects`. Choose a project to create a local space with
the default terminal on the left and **Changes + terminal** on the right. Both
terminals start in the project folder, and focus stays in the left terminal.
Use ↑/↓ and Enter to choose; Esc closes the picker. **Refresh projects** rereads the
folder list. Reading the list requires Python 3, like the other local readers.

The sidebar is one tree: agents appear under their space, with subtle connecting
lines. Click a space to select it, or its chevron to expand or collapse its children
without changing focus. Click an agent to focus its pane. Worktree spaces remain
under their checkout and start collapsed; subagents start collapsed too, and clicking
a subagent opens its live preview. Expansion choices survive restarts.

Status indicators appear on agent rows. **Needs you** filters the tree to agents
waiting for input, revealing their ancestors without changing saved expansion choices.
Turn the filter off to return to all spaces. It also reveals matching agents inside
collapsed machine groups. Agent pins stay at the top of their own space. Agent keyboard
shortcuts follow the tree order, including agents in folded branches. The narrow sidebar
keeps every space accessible, with an expand button at the bottom.

Hover a space and click the focus icon beside its pin, or right-click and choose
**Focus this space**, to show only its agents in the sidebar. Its name stays visible
above the list. **All spaces** returns to the full
tree with its folds, filter and scroll position preserved. A small count beside
the back button appears when agents in other spaces need you. Focus stays on the
chosen space as agents finish or focus moves elsewhere; clicking its name shows
that space again. Closing the space returns the sidebar to the full tree.

Hover a space and click the hide icon just before the pin, or right-click →
**Hide space until…**. Choose 30 minutes, 1 hour, 4 hours, tomorrow at 09:00,
or a custom local date and time. The space and its agents leave the sidebar
until then; terminals keep running. **Hidden spaces** at the bottom lets you
show one early. Deadlines, pins and positions survive restarts. Hiding a checkout
leaves its other worktree spaces visible.

### Pinned spaces

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
| `mods/review-pane/` | Changes inside a normal pane, sharing the existing view through a symlink |
| `mods/files-pane/`, `mods/show-pane/`, `mods/loops-pane/` | Normal pane versions of the existing panels, sharing their views through symlinks |
| `mods/tabs-show/panel-actions.js` | Shared Move to pane action and keyboard-focus handling |
| `mods/pane-titles/` | Herdr's pane header, cloned, with a readable Changes title for review panes |
| `mods/tabs-show/` | Herdr's tab bar, cloned, with Show and Loops buttons added |
| `mods/loops/` | Codex and Claude goals and scheduled loops panel, with Python readers |
| `mods/skills/`, `mods/skills-pane/` | Skills inventory and reader, with shared-file deduplication, scope and agent filters, and a normal pane view |
| `mods/brief/`, `mods/brief-pane/` | Since you left: per-space activity, persistent handoffs, unread history and pane view |
| `skills/herdr-brief/` | tells agents how to post results, validation and open questions using `herdr-brief` |
| `mods/spaces-pin/` | Unified Spaces and Agents tree, with pinned spaces, agent statuses and a Needs you filter |
| `mods/space-new/` | Space creation menu and searchable `~/Projects` picker, sharing the Changes + terminal layout |
| `mods/menu-pin/` | Herdr's right-click menu, cloned, with Hide, Pin / Unpin and Focus this space |
| `mods/space-hide/` | Timed hiding, custom local deadlines and early restoration of spaces |
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
