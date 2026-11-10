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

**GitHub** in the tab bar opens the current project in a new Firefox tab. It follows the
focused terminal's folder, including subfolders and worktrees, and reads HTTPS or SSH
GitHub remotes. It prefers `origin`, then the first GitHub fetch remote. Remote spaces
read Git on their machine and open Firefox on this computer. Firefox must be installed.

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

## Companion

A detailed pixel-art **Companion from fan art** stands above the sidebar footer. He raises
the sword when a new agent appears or starts a turn, then cuts down a zombie
when an agent finishes a turn. The zombie dissolves into pixels. This follows live
Codex, Claude and other agent reports across spaces; the caption also highlights
agents waiting for your input. A finished turn is a celebration of activity, not a claim that its task succeeded.

Click Companion to spar with a zombie. The small pause button stops animations and remembers
your choice. macOS Reduce Motion also keeps him still. He rests between events and while the window is inactive. Parallel events
are grouped into short sequences, and reloading never replays old activity. The narrow
sidebar keeps a compact view of the whole fight. The expanded view leaves room for
full-length sword swings while keeping his face, armor and cape readable. Narrowing the sidebar
reduces both the scene and its footer height. Animations use native image playback.

For a show/hide shortcut, bind `ctrl-a g` to `layout.toggle:companion` in the
`layout:main-custom` section of your Herdr `keys.json`. Press **Ctrl+A**, release,
then **G**. Hiding Companion gives the space back to the sidebar; Herdr remembers his
visibility separately from the animation pause setting.

The reference-led sprite sheets, fixed blade layer and exact imagegen prompts are in `mods/companion/art/`.
Rebuild the playback assets with `python3 mods/companion/build_sprites.py` (Python 3 and
`ffmpeg`); the checked-in sprites need no build step or extra runtime dependency.

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

## Pipeline

**Pipeline** in the top toolbar opens a visual task pipeline for the current project in its
own tab. The header switches between **Simulation** (example tasks and pretend agents) and
**Live** (real coding agents on your repository).

### Live

Live runs real agents on the project's Git repository, one isolated worktree and branch per
task, so parallel agents never touch each other or your checkout.

1. Type a task into **New task** and press Enter. Click it to add details for the agent;
   the title and details are its first message. Or bring tickets from **Plane** (P), the
   project linked to this repository in the Tasks panel: pick open tickets and **Queue**
   them, or **Watch a state** (say Ready) so tickets in it join the queue by themselves within
   a minute, each one once. A Plane task keeps the ticket's key (HMOD-12), priority and
   description, and the inspector links back to it. Pipeline only reads Plane; ticket status
   and assignee stay in your Plane workflow, and agents are told not to change them.
   **Linear** (L) works the same way, with the connection the Linear panel uses: choose My
   tickets, Unassigned or All tickets and optionally a Linear project, then pick tickets (up
   to 10 at a time) or watch a state. States are merged by name across the teams of the listed
   tickets, and a watch needs My tickets or a project, so a workspace-wide state can't flood
   the queue. Linear's list shortens descriptions, so Pipeline reads each ticket in full
   before it is queued.
2. **Start pipeline** (Space). For each queued task, up to the parallel limit (2 by
   default), Pipeline makes a worktree from your current commit under `~/.herdr/worktrees`
   and opens the agent as a tab named after the task in the space you started from, so it
   appears under that space in the sidebar. The agent is the first installed one Herdr knows
   (Claude Code, Codex…); pick another with the agent button. For Claude Code and Codex,
   Settings also sets the **Model** (Claude's aliases such as opus, the models Codex lists in
   its `models_cache.json`, or any model name typed in) and **Effort**, passed as launch
   flags; **Default** leaves the agent's own setting. The agent button and each task's
   inspector show what it started with.
3. The card follows the agent: **Working**, **Needs you** when it waits for you (click
   **Answer** to jump to its terminal, or message it from the task's inspector), and **Ready
   for review** when it finishes. A new worktree first asks whether to trust the folder:
   click **Trust** on the card, or turn on **Trust new worktrees automatically** in
   Settings.
4. With a **Check before review** command in Settings (Pipeline suggests one it recognises,
   such as `npm test`, `make check` or `python3 -m pytest`), a finished agent's worktree is
   checked first: the card shows **Running checks**, and passing work moves to review marked
   **Checks passed**. A failure goes back to its agent with the end of the output, up to two
   times, and is checked again when it finishes; after that (or with **Failures wait for
   you**) the task stops as **Checks failed** with the output and **Fix**, **Review anyway**
   and **Run checks again**. Checks run in the worktree with your environment, for up to 10
   minutes, beside merges and launches rather than in front of them.
5. Review the change summary in the inspector, send feedback if it needs another pass, then
   **Merge** (or **Merge N tasks**, Y). Merging commits anything the agent left, rebases its
   branch onto the branch your project folder is on and fast-forwards, so history stays
   linear. It refuses, and keeps the task in review with the reason, while your folder has
   uncommitted changes or the branch conflicts. Afterwards the agent's tab closes and its
   worktree and branch are removed. **Discard** (asked twice) stops the agent and deletes the
   worktree and branch.

   Turn on **Merge automatically** (Settings, Delivery) to skip the approval: work that
   finishes with passing checks (or with no check set) merges straight away. Work you sent
   on with **Review anyway**, and a merge that was refused, still wait for you.

   To review on GitHub instead, set **Delivery** to **Open a pull request** in Settings. The
   approve action becomes **Open PR**: Pipeline commits anything the agent left, pushes the
   branch to `origin` and runs `gh pr create` into the branch the worktree started from, with
   the task details, the ticket link and the check result in the description (a Plane or
   Linear task's PR is titled with its key). The card then moves to its own **Pull requests**
   section under Review, with a link. Pipeline asks GitHub once a minute what the PR waits for and
   puts the most pressing reason on the card: **Draft**, **Conflicts with main**, **Checks failing · 2**,
   **Changes requested**, **Checks running**, **Waiting for review**, **Behind main**, **Blocked by
   branch rules** or **Ready to merge**. Its inspector lists checks (naming the failing ones), review and
   merge state. The task finishes when the PR is merged (then cleans up as above), or returns to
   review if the PR is closed. Needs `gh`, signed in, and a GitHub
   `origin`. An interrupted push or PR is safe to repeat: an open PR is reused. Turn on
   **Open pull requests automatically** to skip the approval: work that finishes with passing
   checks (or with no check set) is pushed straight away, and you review it on GitHub.

Agents run in herdr-core, so they keep going when the Pipeline tab or Herdr is closed; the
tab-bar tracker catches up when Herdr opens. A start that Herdr can't confirm after a
restart is never repeated: the task stops with a note to check before retrying. Live needs
Python 3 and Git where the project lives, and a project folder (open Pipeline from a
space).

### Schedule

The clock on the right half of the **Start pipeline** button opens the schedule, which sets a daily **Start at** and **Pause intake at** time (22:00, 7:30
or 9pm), in Live and Simulation. When a time comes round, Pipeline does what the Start or
Pause button does: a pause stops new work entering, and agents already working keep going.
Either time can be left empty. Starting or pausing by hand still works; the schedule acts
again at its next time. A time that already passed when you save it waits until tomorrow.
The clock shows the next time that changes anything: beside Start pipeline the next start,
beside Pause intake the next pause.
Times are the computer's local time and need Herdr open; if Herdr was closed, the latest
missed time applies when it opens.

### Simulation

The simulation uses example tasks and repositories: it does not start agents, update Plane
or Linear, create PRs, or change Git repositories.

Type a task into **New task** and press Enter; it joins the queue at once, with its
repositories guessed from the title (change them in the task's inspector while it waits).
The field keeps focus, so you can type several in a row. **Examples** adds tasks from the
example backlog: pick some, **Add all**, or **Generate 6 more examples**. **Watch column**
continuously feeds the same queue; its **Move example task** button simulates a new board
arrival.

**Start pipeline** (Space) sends work to the planner at the centre. Tasks appear as comets
on its orbit, launch into the work slots around it, and particles stream along the busy
paths while a stage bar fills. Checked work docks in **Review**: approve a task with the
**Approve** button on its card, or everything at once with **Approve N tasks** in the status
strip (Y). Merged tasks become stars in the completed constellation. Dependencies wait
for their prerequisite changes to merge, and the plan above the planner says why anything
waits. Failed checks get **Retry** on the card or **Retry N failed** (R).

Some example tasks stop halfway through implementing to ask you a question, the way a real
agent waits for input: the card shows **Needs you** and keeps its slot, the toolbar's
**Pipeline** button shows **Needs you N**, and a toast appears unless Pipeline already has
focus (click it to open Pipeline). **Answer** on the card, **Answer N questions** in the
status strip, or Q opens the question; pick an option (or press its number) or type your
own answer, and the task resumes where it stopped and the next question opens. Settings
has **Simulate a question** to make the next working task ask. Real agents will appear in
the sidebar on their own; this only simulates that moment.

Keys, with the scene focused: Space start/pause, N new task, A examples (in Live: P for
Plane, L for Linear), Q answer (in Live: the next agent that needs you), Y approve all (in Live: merge all), R retry failed,
S speed, Esc close. The bolt button runs the simulation at 1×, 2× or 4×.
**PR approval** in the status strip switches to **Auto-merge** (merge after checks); in Live,
that is **Merge automatically** in Settings.
Settings has the parallel limit (1–6), the outstanding PR limit, a failed-check scenario,
the animation toggle and **Reset example pipeline**. **Quota** simulates exhaustion and
replenishment with a configurable reserve. System Reduce Motion is respected, and motion
stops while Herdr isn't the active window.

The tab-bar tracker keeps simulations progressing while their view is closed. It writes
the shared state only when a stage changes, so an idle or waiting pipeline costs nothing.
State is saved per project folder and machine, and resumes without fast-forwarding while
Herdr was closed. The agreed design and what comes next are in
[docs/pipeline.md](docs/pipeline.md).

## Tasks and Plane

**Tasks** in the toolbar opens a Plane backlog beside your terminals. Connect your
self-hosted instance, then choose the Plane project for the working
repository. A local repository's subfolders and Git worktrees share its project mapping.
Remote mappings belong to the exact folder on that machine. Each instance and workspace
has separate mappings. **Unlink** removes the mapping without changing anything in Plane.

Choose **My tickets**, **Unassigned**, or **All**, search task identifiers, titles and
descriptions, and use **Include done** to show completed or cancelled tasks. The Plane v1
API does not filter these list requests, so the adapter checks actual rows: it reads up to
three pages of 100 tasks per request, stopping earlier after at least 50 matches or the
last page. **Load more tickets** continues from the next unchecked page. A sparse search
can require several loads; an empty partial result says to keep searching. Projects use
the same bounded pagination. Refresh runs every minute while browsing and keeps the last
results when a request fails.

**New task** captures a title, description and priority directly into the linked Plane
project. Descriptions are saved as escaped rich text; existing Plane rich text is converted
to Markdown for reading and agent handoffs. A save with an uncertain result is not retried:
open the project in Plane to check whether the task was created. Starting an agent does
not change Plane status or assignee.

Open a task to read its full description, open it in Plane, copy the agent task, or
**Assign to agent…**. Start a new agent or send the task to an idle agent in the same
folder. For isolated work, **Select tickets → Launch N…** reviews the destination,
starting commit and agent before creating one `plane/` branch and Git worktree per task.
The shared launcher and its retry safeguards work as described below for Linear.
**Move to pane** preserves the filters and selection. Finish or leave task capture before
moving the panel.

The Tasks connection settings open a local terminal for your instance URL, workspace slug
and personal access token. The same setup is available with `herdr-plane connect`.
Credentials are saved with owner-only permissions in
`~/.config/herdr-app/plane/credentials.json`; mappings are in `plane/projects.json`.
`PLANE_BASE_URL`, `PLANE_WORKSPACE` and `PLANE_API_KEY` override the corresponding saved
values. Credentials and API requests stay on this computer when the agent destination
is remote. Python 3 and access to the Plane instance are required; private Tailscale
addresses require an active connection. The adapter uses the public Plane v1 REST API.

This integration supports backlog capture and manual launches. Durable scheduled agent
runs and a phone scheduling page are follow-up work; Plane's planning dates do not
automatically launch agents.

## Linear

**Open Linear** in **Tasks → connection settings** opens your tickets beside the terminals. Choose **My tickets**,
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

### Keyboard

**Ctrl-A E** (or moving left past the first pane) puts the keyboard in the sidebar, with an
accent outline on the current row. **↑ ↓** (or **J K**), **Home** and **End** move through
spaces and their agents; **→ ←** unfold and fold a space, and **←** on an agent goes back to
its space. **Enter** shows the space or focuses the agent. On a space, **P** pins it, **F**
focuses it, **H** hides it and **M** opens its menu; **N** adds a space. **Esc** leaves focus
mode, then the sidebar. A long list doesn't scroll to the cursor on its own yet.

## Feature toggles

The switch icon in the tab bar, after GitHub, opens **Features**: on/off switches for parts
of the mods. Everything is on until you switch it off, and changes apply at once.

- **Commit message box**: the message field and Commit button at the bottom of Changes.
- **Push and pull**: the branch bar with ahead/behind counts and Push/Pull in Changes.
- **Loops**: the Loops button in the tab bar and its side panel.
- **Skills**: the Skills button in the tab bar and its side panel.
- **Needs you**: the filter button at the top of the Spaces sidebar. Off, the sidebar always
  shows every space.
- **Companion**: the companion at the bottom of the sidebar. This one switches Herdr's own
  visibility of his block, so it stays in step with the `layout.toggle:companion` shortcut.

Switches live in Herdr's shared state (`features`), so they survive restarts. To add one,
add a row to `FEATURES` in `mods/toggles/main.js` and check
`shared("features")?.<key> !== false` where the feature is drawn.

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
| `mods/companion/` | Pixel Companion companion reacting to live agent starts, turns and requests for input |
| `mods/space-new/` | Space creation menu and searchable `~/Projects` picker, sharing the Changes + terminal layout |
| `mods/menu-pin/` | Herdr's right-click menu, cloned, with Hide, Pin / Unpin and Focus this space |
| `mods/toggles/` | Feature toggles popup, opened from the tab bar |
| `mods/space-hide/` | Timed hiding, custom local deadlines and early restoration of spaces |
| `mods/workspace-status-git/` | Herdr's bottom status bar, cloned, with commits to push and pull beside the branch |
| `mods/changes-modal/sync.js` | Reads the branch's ahead/behind counts, shared with the status bar and review pane through symlinks |
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
