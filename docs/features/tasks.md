# Tasks: Plane and Linear

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
