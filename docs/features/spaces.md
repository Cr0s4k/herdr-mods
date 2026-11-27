# Spaces and agents

The sidebar **+** offers **New space** for the usual terminal, or **From a project…**
to search the folders in `~/Projects`; **Change** beside the folder's name picks another
folder, which Herdr remembers. Choose a project to create a local space with
the default terminal on the left and **Changes + terminal** on the right. Both
terminals start in the project folder, and focus stays in the left terminal.
Use ↑/↓ and Enter to choose; Esc closes the picker. **Refresh projects** rereads the
folder list. Reading the list requires Python 3, like the other local readers.

The sidebar is one tree: agents appear under their space, with subtle connecting
lines. Click a space to select it, or its chevron to expand or collapse its children
without changing focus. Click an agent to focus its pane. Worktree spaces remain
under their checkout and start collapsed; subagents start collapsed too, and clicking
a subagent opens its live preview. Expansion choices survive restarts.

A space's other terminals are listed after its agents: each is named after its tab (when
you named it) or its folder, with the program running in it beside the name (`web  node`).
Click one to focus its pane. Two with the same name also show their tab number, or their
address when they share a tab. **Needs you** leaves them out.

**Recent** closes each space's list. Click it to unfold the last eight conversations held in
the space's folder that no open agent is in: Claude Code's, Codex's and OpenCode's, newest
first, each with its agent's icon, its title and how long ago it was last used. Click one to resume it in a new
tab of that space (`claude --resume`, `codex resume`, `opencode --session`). The list is read
when you unfold it and again once a minute while it stays open; which spaces have it unfolded
survives restarts. An open agent's own conversation is left out: for Claude Code that is the one its process has
open, and for a Codex or OpenCode agent started by resuming, that conversation. Any other open
agent hides its kind's newest conversation in its folder, since it is probably in it. Conversations held in the repository's other worktrees that still exist (a Pipeline
task's, for one) are listed too, with a branch mark; such a one resumes in its own worktree.
A worktree that was removed takes its conversations out of the list. **Needs you** and the narrow sidebar
leave the row out.

### Find conversation

**⇧⌘F** (or **Find conversation…** in the [command palette](palette.md)) searches what you and
the agents said in past conversations, for the one whose title you don't remember.

- Type words: a conversation matches when every word appears somewhere in what you typed or
  the agent answered, in any case and inside longer words (`limit` finds `limits`). Tool
  output, thinking and helper agents aren't searched. Each result shows its title, the agent,
  how long ago it was used and the line where the words are, marked.
- With nothing typed it lists the latest conversations, newest first.
- It searches the repository of the focused pane and its worktrees (a worktree's results carry
  a branch mark). **⇥**, or a click on the folder's name in the search box, switches to
  **Everywhere**: every folder's conversations, each with its folder's name. The choice sticks.
- ↑/↓ picks, Enter resumes it in a new tab, in its own folder: in the space opened on that
  folder when there is one, else in the space on screen. A conversation whose folder was
  removed is dimmed and can't be resumed. Esc closes.
- A conversation that is open in a tab is marked **open**, and Enter goes to that tab instead
  of opening it twice. It knows this for Claude Code (from the process each one runs) and for
  a Codex or OpenCode agent that was started by resuming that conversation; another open Codex
  or OpenCode conversation isn't marked, and Enter opens it a second time.
- Claude Code's and Codex's conversations are read in full, the newest 600 and 400 files; a
  search that takes over eight seconds stops and says so. OpenCode's match on their titles only.
- Install adds the key to `global` in `~/.config/herdr-app/keys.json` and never replaces a key
  you set there. To use another, bind `mod.open:find-chat` to it instead.

An agent that a Pipeline task owns says where Pipeline has the task beside its status:
**Checks**, **Checks failed**, **Review**, **Merging**, **PR** or **Stopped**. Its tooltip adds
the task's title. While the agent works or asks, Herdr's own status says enough.

Herdr names a space after its first terminal's live folder, so a `cd` or a new worktree
renames it. Here a space is locked to the first place it has outside your home folder: it
takes that repo's (or folder's) name as its own, and the sidebar and the status bar keep
showing that folder's repo and branch wherever its terminals go. A space opened at `~` waits
for its first `cd`. To move a space, right-click → rename it to nothing: it locks again to
where its first terminal is now. Files and Git still follow the focused terminal.

A Pipeline task's worktree could also rename the whole space. While one of its terminals, or the folder it was made in, is in the
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
**Focus this space**, to show only its agents and terminals in the sidebar. Its name stays visible
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

The **Tidy** button beside the sidebar's **+** sorts the spaces by when you last used them,
most recent first, and folds every space unused for an hour. A space is in use while it is the
one shown (with Herdr in front) or an agent is working in it; a program left running in a
terminal doesn't count. Pinned spaces are sorted among themselves and stay above the line, and
a worktree space moves with its checkout. Nothing moves until you click it again. For a space
it hasn't watched yet, the last use is its folder's last commit or checkout, or its newest
Claude session, whichever is later.

## Home

Every space has a **Home** tab, the house at the left of its tab bar. It lists what is open in the
space, most urgent first, and every row takes you there:

- **Needs you**: agents waiting for you or finished while you were away, and Pipeline tasks that
  are stopped, ready for review or asking in their terminal.
- **Agents**: the others, working ones first, each with its Pipeline task or its last brief, else
  its folder and branch.
- **Pipeline**: **Open Pipeline** with its counts, then the tasks that have no agent open (queued
  ones, for instance). A task opens in Pipeline's inspector.
- **Terminals and tabs**: terminals that aren't agents, with what runs in them, and tabs holding
  a panel.
- **Recent conversations**: the last eight closed conversations of the space's folder; click one
  to resume it in a new tab.

A click on a space in the sidebar returns you to the tab you left there. A click on the space
already shown goes to its Home; so does **Go to this space's Home** in the
[command palette](palette.md). On Home, **↑ ↓** (or **J K**) move and **Enter** goes.

Herdr closes a space when its last tab closes. Home can't be closed from the tab bar, so closing
Pipeline or the last terminal leaves the space open on Home; close the space itself to remove it.
Home is always the first tab: one closed another way comes back, and one moved goes back to the
left. Switch **Home tab** off in the tab bar's [feature toggles](tab-bar.md#feature-toggles) to
remove it; a space with nothing else open keeps its Home until it has another tab.

## Suggest cleanup

The broom beside **Tidy** lists what could close inside your spaces, each with why; the spaces
themselves stay. Right-click a space → **Suggest cleanup…**, or **C** on it in the sidebar, lists
that space only. The [command palette](palette.md) has both.

Suggestions sit under their space, longest unused first:

- **Agents idle for an hour**, ticked: the conversation stays under Recent, to resume. One that
  finished while you were away is listed unticked, since its reply is unread.
- **Shells at their prompt for an hour**, ticked unless you named the tab.
- **Programs untouched for a day** (a dev server, an editor), unticked.
- **Panel tabs not opened for a day** (Files, Git, Show), ticked.
- **Agents whose Pipeline task is merged**, ticked however recent.

Never listed: agents working or waiting for you, terminals an unfinished Pipeline task owns, the
Home and Pipeline tabs, and the pane you are typing in.

A terminal or panel is in use while it is on screen with Herdr in front, or while its agent works
or asks; the sidebar notes this once a minute. The last status change in its tab counts too. A
terminal never seen in use counts from when it started; a panel never seen in use isn't listed.

**Space** ticks, **↵** closes the ticked after asking once, **G** (or a row's arrow) goes there and
**Esc** closes. Closing ends their terminals. Home keeps each space open; in a space without one
(Home tab switched off), the tab used last is kept and marked **keeps the space open**.

## Pinned spaces

Hover a space and click its pin to pin it to the top. Pinned spaces always show the pin;
click it again to unpin. You can also right-click → **Pin to top**, or drag a space above
the line to pin it, below to unpin it. Pinned spaces stay above the rest, with a line under them. Pins are saved
in Herdr's shared state (`space.pinned`), so they survive restarts.

## Keyboard

**Ctrl-A E** (or moving left past the first pane) puts the keyboard in the sidebar, with an
accent outline on the current row. **↑ ↓** (or **J K**), **Home** and **End** move through
spaces, their agents and terminals; **→ ←** unfold and fold a space, and **←** on an agent or
terminal goes back to its space. **Enter** shows the space, focuses the agent or terminal, unfolds Recent or resumes a conversation. On a space, **P** pins it, **F**
focuses it, **H** hides it, **C** suggests its cleanup and **M** opens its menu; **N** adds a space and **T** tidies. **Esc** leaves focus
mode, then the sidebar. A long list doesn't scroll to the cursor on its own yet.
