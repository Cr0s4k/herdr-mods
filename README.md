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
own tab. The icon button in the header toggles between **Simulation** (flask: example tasks
and pretend agents) and **Live** (broadcast: real coding agents on your repository).

In the sidebar, a space lists its **Pipeline** above its agents while the Pipeline tab is open
there, the live pipeline is started, or it has tasks that aren't merged yet. It spins while the
pipeline is started; click it to open the pipeline in that space. The × that appears on hover
closes the pipeline after a confirmation that lists what goes: it stops intake and clears the
schedule and ticket watches, removes queued tasks, stops the agents still at work and deletes their
worktrees and branches, and closes the Pipeline tab. Tasks merging or waiting on a pull request stay.

### Live

Live runs real agents on the project's Git repository, one isolated worktree and branch per
task, so parallel agents never touch each other or your checkout.

A space's new live pipeline opens with a **Set up this pipeline** card over its empty canvas:
the AI helper, the agent, the check command, Try it, delivery and where tickets come from, each
with a button into its Settings section. What Pipeline recognises from file names is offered,
never applied: **Use npm test** for a check command it finds, **Use pull requests** when the
repository is on GitHub and `gh` is installed. **Choose for me** (sparkles) asks the AI helper
to read the repository, read-only, and set the check command, Try it and delivery; each choice
it made shows its reason under the row. The AI helper is its own setting, apart from the planner:
Claude Code on Haiku unless **AI helper** in Settings picks another agent, model or effort. A run
takes about 20 seconds and costs about a cent. The card goes away with **Done** or the first
**Start pipeline**.

1. Type a task into **New task** and press Enter. Click it to add details for the agent;
   the title and details are its first message. Text too long for a title (over 90
   characters, marked **Title + details** in the field) keeps its first sentence or opening
   words as the title, and the whole text goes into its details. Or bring tickets from **Plane** (P), the
   project linked to this repository in the Tasks panel: pick open tickets and **Queue**
   them, or **Watch a state** (say Ready) so tickets in it join the queue by themselves within
   a minute, each one once. A Plane task keeps the ticket's key (HMOD-12), priority and
   description, and the inspector links back to it.
   **Linear** (L) works the same way, with the connection the Linear panel uses: choose My
   tickets, Unassigned or All tickets and optionally a Linear project, then pick tickets (up
   to 10 at a time) or watch a state. States are merged by name across the teams of the listed
   tickets, and a watch needs My tickets or a project, so a workspace-wide state can't flood
   the queue. Linear's list shortens descriptions, so Pipeline reads each ticket in full
   before it is queued.

   By default Pipeline only reads Plane and Linear. **Ticket updates** in Settings lets it
   move a ticket as its work goes, per tracker: a state **When its agent starts** and one
   **When the work merges** (locally, or the pull request merged on GitHub), picked from the
   linked Plane project's states or Linear's states for the teams of queued tickets, and
   **Link pull requests to the ticket**, which adds "PR #12: title" when the pull request
   opens. Each update first reads the ticket, so a state it already has or a link it already
   carries is left alone, and a retried task doesn't move its ticket again. Updates never
   hold up or stop a task: the inspector shows the last one ("Moved to In Progress in
   Plane"), or what failed with **Try again**, and the task history records each. Linear
   updates need a connection with Write permission; without it the inspector offers
   **Connect Linear**. Agents are still told not to change a ticket's status or assignee.

   Tasks can wait for each other. A ticket brings its **blocked by** links from Plane or
   Linear: a blocker that is also in the pipeline holds the task until that task merges, and
   one outside it holds the task until its ticket is completed or cancelled (Pipeline asks
   once a minute). To make any queued task wait for another, pick that task under **Waits
   for** in the inspector; a circle is refused. **Start anyway** lets a waiting task go, and
   removing or discarding a task frees the ones waiting for it. With pull requests, a task
   that waited starts from its branch freshly fetched from `origin`, so it has its blocker's
   merge; with local merges it starts from your project folder, so pull first if a blocker
   landed somewhere else.

   The queue starts in the order it is drawn: by priority (a ticket's own; typed tasks are
   Medium), then arrival. **Start first** in a queued task's inspector puts it ahead of the
   rest, whatever its priority; the last one marked goes first, and clicking again puts it
   back. **Model and effort for this task** there lets one task start with its own (a small
   model for a docs change, say); what you leave **As set** follows Settings.

   **Plan with an agent** (Settings) hands the ordering to Claude Code or Codex: the one you
   pick there, else the one tasks start with. Whenever a task joins the queue, its details
   change or one of its ticket blockers changes, Pipeline asks it, read-only, to look at the
   queue, each ticket's Plane or Linear blockers, the work already started and the
   repositories, and to answer with the
   order to start tasks in, which must wait for which (because one builds on another, or
   both would change the same lines), and a reason for each. The plan appears above the
   centre, each queued task's inspector shows its reason, and cards
   show the waits. New agents wait for the plan; if planning fails, tasks start by priority
   and only a new or changed task asks again. Pipeline still keeps its own rules: the
   parallel and review limits, waits you set, no circles, and a wait that contradicts the
   plan's own order is dropped. Click the plan card on the map, **The plan · by …** (or the centre while it says
   **Planning**, or **See what the planner did** in Settings) for the **Planner** view: who
   planned and with what model and effort, how long it took, its tokens and (for Claude
   Code) cost, its summary, its order with every task's reason and waits (kept after the
   tasks start), the files it read and the searches and commands it ran, and what it was
   asked. **Watch the next plan** runs the next one in a terminal tab, so you see it read as
   it goes. Ticket blockers hold a task whether the planner is on or
   not; the planner sees them so it can plan around them. **Start first** and **Start
   anyway** still win. Pick its model and effort there (Default is the agent's own); a plan
   takes seconds on a small model.
2. **Start pipeline** (Space). For each queued task, up to the parallel limit (2 by
   default), Pipeline makes a worktree from your current commit under `~/.herdr/worktrees`
   and opens the agent as a tab named after the task in the space you started from, so it
   appears under that space in the sidebar. The agent is the first installed one Herdr knows
   (Claude Code, Codex…); pick another with the agent button. For Claude Code and Codex,
   Settings also sets the **Model** (Claude's aliases such as opus, the models Codex lists in
   its `models_cache.json`, or any model name typed in) and **Effort**, passed as launch
   flags; **Default** leaves the agent's own setting. The agent button and each task's
   inspector show what it started with.
3. The card follows the agent: **Working** with how long its agent has had the task,
   **Needs you** when it waits for you, and **Ready for review** when it finishes. **Answer**
   (or Q) opens what it asks in the task's inspector, the way the simulation does: Pipeline
   reads the agent's menu off its screen (a question, or a permission to run something),
   shows the options as buttons (or press their number) and a field for your own answer, and
   presses the keys in its terminal for you. When a screen has no menu it can read, the
   inspector shows the end of the screen, **Open agent**, and a field to message it. A new worktree first asks whether to trust the folder:
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
5. Review the work: the inspector lists the files the task changed since it started, with
   lines added and removed. Click a file, or **Read the changes** (D), to read the full diff
   in the changes dialog, file by file. The list is there while the agent works too; the
   round arrow reads it again. Send feedback if it needs another pass, then
   **Merge** (or **Merge N tasks**, Y). Merging rebases its branch onto the branch your project
   folder is on and fast-forwards, so history stays linear. It refuses, and keeps the task in
   review with the reason, while your folder or the agent's worktree has uncommitted changes,
   or the branch conflicts. Pipeline never commits for the agent on its own: **Ask the agent
   to commit** sends it back to commit (or finish first), **Commit them anyway** commits
   everything as one commit. Afterwards the agent's tab closes and its worktree and branch are
   removed. **Discard** (asked twice) stops the agent and deletes the worktree and branch. When
   a merge is refused because the branch conflicts, **Ask the agent to rebase** sends the
   refusal to its agent, which rebases, resolves the conflicts and comes back to review.

   To use the change before merging, set a **Try it** command in Settings (Pipeline suggests
   an executable `./try.sh` or `./preview.sh`, a package.json `dev`, `start` or `preview`
   script, a Makefile `run`, `dev` or `preview` target, or `cargo run`). **Try it** (T) in the
   inspector runs it in the task's worktree, in a tab of its own beside the agent, with the
   task id in `$PIPELINE_TASK`. Ctrl-C leaves a shell in the worktree; pressing it again shows
   that tab; it closes when the task merges or is discarded. Several branches running at once
   is up to the command, for example a dev server that picks a free port.

   Turn on **Merge automatically** (Settings, Delivery) to skip the approval: work that
   finishes with passing checks (or with no check set) merges straight away. Work you sent
   on with **Review anyway**, and a merge that was refused, still wait for you.

   To review on GitHub instead, set **Delivery** to **Open a pull request** in Settings. The
   approve action becomes **Open PR**: Pipeline pushes the branch to `origin` and runs
   `gh pr create` into the branch the worktree started from (a Plane or Linear task's PR is
   titled with its key). The branch is named after the task (`hmod-7-fix-login`, no
   prefix), and the agent is told to follow the repository's conventions: it renames the
   branch if the repository names them differently, and writes the description from the
   repository's PR template or rules, or one summary line, a few bullets and the ticket link.
   It writes it to `herdr-pr.md` in the worktree's Git folder, so it is never committed;
   without one the description is just the ticket link. The card then moves to its own **Pull requests**
   section under Review, with a link. Pipeline asks GitHub once a minute what the PR waits for and
   puts the most pressing reason on the card: **Draft**, **Conflicts with main**, **Checks failing · 2**,
   **Changes requested**, **Checks running**, **Waiting for review**, **Behind main**, **Blocked by
   branch rules** or **Ready to merge**. Its inspector lists checks (naming the failing ones), review and
   merge state. The task finishes when the PR is merged (then cleans up as above), or returns to
   review if the PR is closed. Needs `gh`, signed in, and a GitHub
   `origin`. An interrupted push or PR is safe to repeat: an open PR is reused. Turn on
   **Open pull requests automatically** to skip the approval: work that finishes with passing
   checks (or with no check set) is pushed straight away, and you review it on GitHub.

A task can change several repositories. Add them under **Repositories** in Settings: type a
path on the project's machine (`~/code/api`, or relative to the project folder) and **Add**;
Pipeline checks it's a Git repository and refuses one already listed. The project's own
repository always comes first. A queued task's inspector then shows the repositories as
chips; new tasks, typed or from tickets, start with the project's only. Cards and the
inspector name a task's repositories when it has more than one ("shop + api").

- Such a task gets a worktree in each repository, all on the same branch name. Its agent
  starts in the first one and can open the others (Claude Code and Codex get `--add-dir`
  for each), and its first message lists every worktree with its branch and start commit.
- The check command runs in every worktree and passes only if all pass; a failure names the
  repository, and goes back to the one agent as usual.
- The inspector shows the changes per repository. **Merge** merges every repository or none:
  each branch is rebased first, and only when all rebased cleanly are they fast-forwarded. A
  repository the agent left alone is skipped. If a fast-forward still fails after others
  landed, the task stays in review and says which merged; merging again finishes the rest.
- With pull requests, each changed repository gets its own PR, and once all are open each
  description links the others. The card shows the most pressing need across them
  ("api · Checks failing · 1") and the inspector a checklist per PR. The task finishes when
  every PR is merged; one closed without merging sends it back to review with the others
  left open, and approving again opens a new one only where it's needed.
- Two tasks never merge into the same repository at once: an approved task waits
  (**Approved · merging next**) until the one ahead of it is done. **Branches waiting for
  review** counts repositories, so a task across two holds two. **Discard** removes every
  worktree and branch.

While you're looking elsewhere, Pipeline posts a notification for what Herdr doesn't already
announce: failed checks, checked work ready for review, a refused merge, an agent that
stopped or asks to trust its worktree, and a pull request that turns ready to merge, gets
blocked, is closed or is merged. Clicking one opens Pipeline. **Notify me** in Settings
turns them off. Completed tasks say how long they took.

A working agent redraws its terminal all the time. When one shows nothing new for ten
minutes, its card turns to **No output for 12 min** and Pipeline notifies you that it may be
stuck; the flag clears by itself when the screen moves again. For Claude Code and Codex, a
task's inspector also says how many tokens its agent used (written, read and read from cache),
counted from the agent's own session files for the worktree each time a turn ends, and
**Completed** adds up agent time and tokens written. Each task keeps its own history, so it
is still there after the activity log has moved on.

In Live the circle at the centre says what waits for you (**1 needs you**, **2 stopped**,
**3 to review**) and clicking it takes you there.

Agents run in herdr-core, so they keep going when the Pipeline tab or Herdr is closed; the
tab-bar tracker catches up when Herdr opens. A start that Herdr can't confirm after a
restart is never repeated: the task stops with a note to check before retrying. Live needs
Python 3 and Git where the project lives, and a project folder (open Pipeline from a
space).

### Usage limits

In Live, the gauge button in the toolbar shows how full the usage limits of the agent your tasks start with are
(**Claude 49%**), and opens **Usage limits**. It shows each of Claude's and Codex's limits (5-hour, weekly, and a
model's own weekly limit such as Fable's), how full each is and when it resets.

While a limit is at **Hold at** (90% by default) or more, no new agent starts: the queued task says **Held by usage
limit**, and the plan says which limit and when it resets. Agents already working keep going, and new ones start
when the limit resets. A model's own limit only holds tasks set to that model. **Hold new agents near a limit**
turns this off, for example when Claude's extra usage is on and you'd rather spend it.

Claude's limits come from Anthropic every five minutes, asked with Claude Code's own login from the keychain (or
`~/.claude/.credentials.json` off macOS). This uses Anthropic's usage endpoint, which isn't documented and may
change. Codex's limits come from its newest session on that machine, so they are as fresh as Codex's last reply.
**Read again** reads both now. A project on another machine reads that machine's limits.

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
status bar, or Q opens the question; pick an option (or press its number) or type your
own answer, and the task resumes where it stopped and the next question opens. Settings
has **Simulate a question** to make the next working task ask. Real agents will appear in
the sidebar on their own; this only simulates that moment.

Pipeline keeps two bars around the scene: controls on top (the New task field and intake
buttons sit beside the title in a wide window, and on their own row in a narrow one) and one
status bar at the bottom with the state, counts, the latest activity (click it for the log)
and the actions that wait for you. Settings lists the keys.

Keys, with the scene focused: Space start/pause, N new task, the arrow keys (or J and K)
to walk the tasks in the order the scene shows them, A examples (in Live: P for
Plane, L for Linear, D to read the selected task's changes), Q answer (in Live: the next agent that needs you), Y approve all (in Live: merge all), R retry failed,
S speed, Esc close. The bolt button runs the simulation at 1×, 2× or 4×.
**PR approval** in the status bar switches to **Auto-merge** (merge after checks); in Live,
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
with API key**. A local terminal asks privately for a key with Read permission (add Write if
Pipeline should update tickets), validates it,
and saves it with owner-only permissions at `~/.config/herdr-app/linear/credentials.json`.
Return to the panel and refresh. The same setup is available with `herdr-linear connect`.
The reader prefers `LINEAR_API_KEY`, then its saved key, then Claude's login.

Linear access uses the [official MCP server](https://linear.app/docs/mcp) and Python 3's
standard library. The panel only reads; the reader refuses every write except the two
Pipeline's ticket updates make with `save_issue` (a state, or a link). Ticket access and credentials stay on this
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

Herdr names a space after its first terminal's folder, so a Pipeline task's worktree could
rename the whole space. While one of its terminals, or the folder it was made in, is in the
repo's main checkout, the sidebar keeps the space there and under the repo's name (a name you
gave it always wins). Agents working in another worktree sit under a branch row inside their
space; click the branch to focus its first agent.

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
`shared("features")?.<key> !== false` where the feature is drawn. The popup grows to fit
the new row.

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
| `mods/toggles/` | Feature toggles popup, opened from the tab bar; it sizes itself to its rows (`mods/tabs-show/toggles.js` is a symlink) |
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
