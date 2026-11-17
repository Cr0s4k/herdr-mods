# Pipeline

**Pipeline** in the top toolbar opens a visual task pipeline for the current project in its
own tab. Opened from a project it is **Live**: real coding agents on your repository.
**Try a demo** (Settings, General) switches to the **Simulation**, example tasks and pretend
agents, marked **Demo** in the header; **Exit demo** there returns to your pipeline, which
keeps running meanwhile. Without a project folder Pipeline is the demo only.

The view button beside Settings switches between the **map** (the default: work flowing
through the agents at the centre) and the **board**: Queue, Working and Review as three
columns, with the plan as one line above them, pull requests under their own heading in
Review, and the same cards, buttons and inspector. Pipeline remembers the choice.

In the sidebar, a space lists its **Pipeline** above its agents while the Pipeline tab is open
there, the live pipeline is started, or it has tasks that aren't merged yet. It spins while the
pipeline is started; click it to open the pipeline in that space. The × that appears on hover
closes the pipeline after a confirmation that lists what goes: it stops the pipeline and clears the
schedule and ticket watches, removes queued tasks, stops the agents still at work and deletes their
worktrees and branches, and closes the Pipeline tab. Tasks merging or waiting on a pull request stay.

## Live

Live runs real agents on the project's Git repository, one isolated worktree and branch per
task, so parallel agents never touch each other or your checkout.

A space's new live pipeline opens with a **Set up this pipeline** card over its empty canvas:
the AI helper, the agent, the check command, Try it, delivery, the After merge command,
where tickets come from and how tickets are updated, each
with a button into its Settings section. When the repository's branches and commits name a
Linear team (`WEB-186` names WEB), the card offers **Use Linear · Web**; with a team or a
linked Plane project it offers that tracker's usual three moves in one click, such as
**Use In Progress → In Review → Done**. What Pipeline recognises from file names is offered,
never applied: **Use npm test** for a check command it finds, **Use pull requests** when the
repository is on GitHub and `gh` is installed. **Choose for me** (sparkles) asks the AI helper
to read the repository, read-only, and set the check command, Try it, delivery and the After
merge command; each choice
it made shows its reason under the row. The AI helper is the agent that also plans the queue:
**AI helper** in Settings picks its agent (Claude Code, Codex or OpenCode), model and effort once for both, from the same model list as the Agent section,
whether or not **Plan with an agent** is on. On a small model a run
takes about 20 seconds and costs about a cent. The card goes away with **Done** or the next
**Start pipeline**; **Show setup** (Settings, General) brings it back, also on a pipeline made
before the card existed.

Settings belong to the project, not the space: the agent and its model, checks, Prepare, Try
it, delivery, After merge, repositories, ticket updates, the Linear team and project, agent
instructions and Show the change. A change in one space reaches every space open on the same
folder, a new space starts with them (its setup card says so), and closing Pipeline keeps
them. Tasks, the queue, watches, the schedule and Start stay with the space. **Saved
pipelines** (Settings, General) lists every pipeline Herdr has saved, with **Forget** for
one that has nothing left to finish (no agent, worktree or open pull request) and one button
for all such. **Reset project settings** there (asked twice) starts the project's settings
over and keeps the tasks. The Close dialog offers **Close and forget** when closing leaves
nothing to finish.

1. Type a task into **New task** and press Enter. A Linear link or key on its own
   (`https://linear.app/…/issue/WEB-171/…`, `WEB-171`) becomes that ticket, read in full,
   so its updates and pull request link work; if Linear can't be read it stays a typed task. Click it to add details for the agent;
   the title and details are its first message. Under the details, **Images** takes up to
   four screenshots or mockups (PNG, JPEG, GIF, WebP): drop them from Finder, or **Paste
   image** for one on the clipboard (macOS). Pipeline copies them into
   `~/.config/herdr-app/pipeline-images`, lists them in the agent's first message and gives
   Claude Code and Codex that folder to read. A project on another machine takes none. The
   copies are deleted when the task is merged, discarded or removed. Text too long for a title (over 90
   characters, marked **Title + details** in the field) keeps its first sentence or opening
   words as the title, and the whole text goes into its details. Or bring tickets with
   **Add from tickets**, which opens the tracker this pipeline used last and switches between
   the two at the top of its drawer. **Plane** (P) is the
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

   Agents you started by hand in the project's folder can become tasks too. While any are
   open, the toolbar shows **N agents outside**; its drawer lists them with **Open** and
   **Convert to task**. Converting asks the agent, in its terminal, for a title, a description
   and the uncommitted files that are its own (several agents may share the folder). Pipeline
   then makes the task's worktree and branch and moves exactly those files out of the project
   folder into it; commits already made stay where they are. A Claude Code agent is told to
   switch its session into the worktree, so the conversation carries on there (Claude Code
   asks you once to allow the move). Any other agent gets a note that the work moved, and a
   new one of its kind continues in the worktree from the description. From then on it is a
   task like any other. **Cancel** in the inspector stops a conversion before anything moved;
   merging or discarding a converted task closes only its agent's pane, not the whole tab.

   By default Pipeline only reads Plane and Linear. **Ticket updates** in Settings lets it
   move a ticket as its work goes, per tracker: a state **When its agent starts**, one **When
   it is ready for review** (the task reaches review, or with pull requests, the pull request
   opens) and one **When the work merges** (locally, or the pull request merged on GitHub),
   picked from the linked Plane project's states or Linear's states for the chosen team and
   the teams of queued tickets, and
   **Link pull requests to the ticket**, which adds "PR #12: title" when the pull request
   opens. Each update first reads the ticket, so a state it already has or a link it already
   carries is left alone, and a retried task doesn't move its ticket again. Updates never
   hold up or stop a task: the inspector shows the last one ("Moved to In Progress in
   Plane"), or what failed with **Try again**, and the task history records each. Linear
   updates need a connection with Write permission; without it the inspector offers
   **Connect Linear**. Agents are still told not to change a ticket's status or assignee.
   While updates are off, a ticket task's inspector says its ticket stays where it is, with
   **Set up**. When Linear updates are on but the connection can only read (a read-only
   Claude login), the setup card and **Ticket updates** say so with **Connect Linear** before
   any ticket fails; an API key shows what it may do only when it is used.

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
   back. **Move up** and **Move down** beside it swap the task with its neighbour: the queue
   then keeps the order you gave it, Start first still goes ahead of it, and tasks added
   later join after the ones you ordered. **Model and effort for this task** there lets one task start with its own (a small
   model for a docs change, say); what you leave **As set** follows Settings. An agent with many models (OpenCode) shows the same searchable list there as in Settings.

   **Plan with an agent** (Settings, AI helper) hands the ordering to Claude Code, Codex or OpenCode: the one you
   pick there, else Codex when tasks start with it, else Claude Code. OpenCode has no output schema, so it is asked for JSON in its reply, and it reads through its plan agent on a private server that refuses edits and the shell. Whenever a task joins the queue, its details
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
   (Claude Code, Codex…); pick another in Settings, which the toolbar's chip opens (**Claude Code · 2 parallel · 34% used**: the agent with its model and effort, how many run at once, and how full its usage limits are). For Claude Code, Codex and OpenCode,
   Settings also sets the **Model** (Claude's aliases such as opus, the models Codex lists in
   its `models_cache.json`, the models OpenCode's server lists, as `provider/model`, or any
   model name typed in) and **Effort**, passed as launch
   flags; **Default** leaves the agent's own setting. The chip and each task's
   inspector show what it started with. The models are a scrolling
   list headed by **Default**; OpenCode's are grouped by provider with the free ones first,
   as its own model dialog shows them. Typing in the field narrows the list by name,
   provider or "free", and Enter picks the first match, or uses the name as typed when
   nothing matches. OpenCode's effort is the model's variant, so it is
   offered once a model is picked, and a task with a model runs on a private OpenCode
   server (`--standalone`): the shared one can't be told a model per session.
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
5. Review the work: **Summary from the agent** in the inspector is what its agent wrote before
   it stopped, in at most three short lines: **Changed**, **Checked** and, when there is one,
   **Unsure**. Agents are asked for it in their first message and write it into Git's own
   folder, so it is never committed; Pipeline reads it when the agent's turn ends and keeps
   it on the task after the merge. An agent that writes none leaves the box out. The inspector lists the files the task changed since it started, with
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
   that tab; it closes when the task merges or is discarded. Each task has its own port in
   `$PIPELINE_PORT` (4100 to 4999), so several branches can run at once when the command uses
   it. **Start it when work is ready for review** starts it by itself, once per task, without
   taking you away from where you are. While its tab runs, the inspector offers **Open
   localhost:5174** for the last local address the command printed.

   A fresh worktree has only what Git tracks. **Prepare a new worktree** (Settings, Checks
   and Try it) runs a command once in each new worktree before its agent starts, such as
   `cp "$PIPELINE_SOURCE/.env" . && npm ci`, with your project folder in `$PIPELINE_SOURCE`
   and the task's id and port set. A failure is recorded in the task's history and the agent
   still starts. The setup card's **Prepare** row offers one built from what the repository
   ignores but needs: copying an untracked `.env` or `.env.local` (at the top or one folder
   down, such as `crm/.env`), and the install command of
   its lockfile.

   **Agent instructions** (Settings, Agent) is free text added to every task's first message.
   **Show the change** there asks each agent for screenshots of the screens it changes, before
   it changes anything and again when done, saved in Git's own folder (never committed) in
   pairs like `01-before-login.png` and `01-after-login.png`, and to present them on one
   private page published with Claude Code's Artifact tool: each pair side by side, what
   changed, and how to try it locally. **Open walkthrough** under **Before and after** in the
   inspector opens that page; the screenshots are listed below it and open in the Show panel.
   An agent without an Artifact tool leaves the page out, and the inspector says so. The setup
   card has a **Screenshots** row that turns it on. A task that started without it has **Ask
   for screenshots** in its inspector, which sends its agent the same request (with "before"
   taken from the commit its branch started from); with screenshots but no page it reads **Ask
   for the walkthrough page**. With pull requests, **Add the screenshots to the pull request**
   (Settings, Delivery, off by default) pushes them to a `pipeline-evidence` branch on `origin`
   and adds a **Before and after** table to the description. How to start the app and which
   screens matter belongs in the repository's `AGENTS.md` or a skill. When the repository has
   neither, the setup card's Screenshots row offers **Queue: write how to run it**: a task
   whose agent writes `.claude/skills/demo/SKILL.md` (start it from a fresh worktree, sign in
   locally, the screens that matter, how to stop it) and follows it once to prove it.

   **Revert** in a completed task's inspector (asked twice) undoes a task merged locally with
   one new commit, `Revert T-1 <title>`, on the branch it merged into: only that task's
   commits, with work merged since left alone and no history rewritten. The commit is pushed
   when merges are, and the After merge command runs again. It refuses, changing nothing and
   saying why, while your project folder has uncommitted changes, is on another branch, or
   later work changed the same lines (it then names the `git revert` to run by hand). The
   task stays in Completed, marked **Reverted**, and with ticket updates on its ticket goes
   back to the **When its agent starts** state. A task delivered as a pull request reverts
   differently: Revert opens a pull request that undoes it (`gh pr revert`), linked from the
   inspector, and nothing changes until you merge that on GitHub; Pipeline does not follow
   it. Tasks merged locally before Pipeline recorded their commits have no Revert.

   Turn on **Merge automatically** (Settings, Delivery) to skip the approval: work that
   finishes with passing checks (or with no check set) merges straight away. Work you sent
   on with **Review anyway**, and a merge that was refused, still wait for you.

   When merged work only takes effect once something is run (an install or deploy script),
   set an **After merge** command (Settings, Delivery; Pipeline suggests an executable
   `./install.sh` or `./deploy.sh`, or a Makefile `install` or `deploy` target). It runs in
   your project folder, never a worktree, once the merges waiting have landed, in each
   repository a task merged into; one run covers every merge before it, so several spaces'
   tasks merging into the same folder each leave it installed from the merged state. If it
   fails the merge stays, the task's card says **Merged · after-merge failed**, you get a
   notification, and **Run again** in the status bar or the task's inspector runs it again.
   It is not used with pull requests, where nothing merges locally.

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

**Follow up** in a completed task's inspector queues a new task from what you type: a fresh
agent that starts from the branch as it is now, with details that say what the first task
was, what its agent reported, where its commits are, and its pull request or ticket. It opens
in the queue, where the details can be edited before it starts.

A working agent redraws its terminal all the time. When one shows nothing new for ten
minutes, its card turns to **No output for 12 min** and Pipeline notifies you that it may be
stuck; the flag clears by itself when the screen moves again. For Claude Code, Codex and OpenCode, a
task's inspector also says how many tokens its agent used (written, read and read from cache),
counted from the agent's own session files for the worktree (OpenCode's session database) each time a turn ends, and
**Completed** adds up agent time and tokens written. Each task keeps its own history, so it
is still there after the activity log has moved on.

In Live the circle at the centre says what waits for you (**1 needs you**, **2 stopped**,
**3 to review**) and clicking it takes you there.

Agents run in herdr-core, so they keep going when the Pipeline tab or Herdr is closed; the
tab-bar tracker catches up when Herdr opens. A start that Herdr can't confirm after a
restart is never repeated: the task stops with a note to check before retrying. Live needs
Python 3 and Git where the project lives, and a project folder (open Pipeline from a
space).

## Usage limits

In Live, the toolbar's chip ends with how full the usage limits of the agent your tasks start with are
(**49% used**). **Usage limits** in Settings shows each of Claude's and Codex's limits (5-hour, weekly, and a
model's own weekly limit such as Fable's), how full each is and when it resets.

While a limit is at **Hold at** (90% by default) or more, no new agent starts: the queued task says **Held by usage
limit**, and the plan says which limit and when it resets. Agents already working keep going, and new ones start
when the limit resets. A model's own limit only holds tasks set to that model. **Hold new agents near a limit**
turns this off, for example when Claude's extra usage is on and you'd rather spend it.

Claude's limits come from Anthropic every five minutes, asked with Claude Code's own login from the keychain (or
`~/.claude/.credentials.json` off macOS). This uses Anthropic's usage endpoint, which isn't documented and may
change. Codex's limits come from its newest session on that machine, so they are as fresh as Codex's last reply.
**Read again** reads both now. A project on another machine reads that machine's limits.

## Schedule

The clock on the right half of the **Start pipeline** button opens the schedule, which sets a daily **Start at** and **Pause at** time (22:00, 7:30
or 9pm), in Live and Simulation. When a time comes round, Pipeline does what the Start or
Pause button does: a pause stops new work entering, and agents already working keep going.
Either time can be left empty. Starting or pausing by hand still works; the schedule acts
again at its next time. A time that already passed when you save it waits until tomorrow.
The clock shows the next time that changes anything: beside Start pipeline the next start,
beside Pause the next pause.
Times are the computer's local time and need Herdr open; if Herdr was closed, the latest
missed time applies when it opens.

## Simulation

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
paths while a stage bar fills. Checked work lands in **Review**: approve a task with the
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

Pipeline keeps two bars around the scene: controls on top (the New task field and its
buttons sit beside the title in a wide window, and on their own row in a narrow one) and one
status bar at the bottom with the state, the latest activity (click it for the log)
and the actions that wait for you. **?** (or the small button at the end of the status bar)
shows every key for the mode you are in; Esc closes it. Settings lists them too.

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
[docs/pipeline.md](../pipeline.md).

`herdr-pipeline` prints a live pipeline from any terminal, read-only and short enough for an
agent to read cheaply: the project's unfinished tasks, how long each has been in its status and
what holds it. `herdr-pipeline T-3` shows one task (worktree, error, the end of its check
output, summary, tokens and its history with times); `.` picks the task of the worktree you're
in. `--events N`, `--done`, `--full`, `--all` and `--json` widen it.
