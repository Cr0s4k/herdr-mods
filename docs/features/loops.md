# Loops

The **Loops** tab beside Show lists local **Codex, Claude and OpenCode `/goal` goals** and **Claude
scheduled `/loop` tasks**, labeled by source. It refreshes every ten seconds, with a manual refresh button. Codex goals show
status, tokens used (and budget when set), and working time. Budget usage is not a measure
of task completion.

**This space** follows the space's live terminal folders; **All projects** includes saved
goals and schedules from other local projects. **History** includes completed, failed,
cleared, cancelled, ended, expired, and inactive entries. The **Codex**, **Claude** and **OpenCode**
header buttons independently toggle each source; all start enabled. Claude includes
goals and scheduled tasks. Counts follow the selected sources. All filters are remembered.
**Open session** opens the exact Codex thread with
`codex resume` in a new tab, or the exact OpenCode session with `opencode --session`. From a remote space it opens a local space instead.

Claude goals come from structured `goal_status` attachments in local session transcripts
under `$CLAUDE_CONFIG_DIR/projects` (default `~/.claude/projects`). **Saved goal** means the
last recorded goal is unresolved; it does not prove that Claude is still running. Token
spend, elapsed time, and evaluated turns appear when recorded, usually when the goal ends.
Clearing a goal is distinct from completing it. **Copy session ID** copies its exact session
ID. The panel never runs the Claude CLI, including when refreshing or clicking a Claude row.

OpenCode goals come from its session database (`~/.local/share/opencode/opencode.db`,
`XDG_DATA_HOME` respected), read-only: one goal per session, **Active**, **Paused** or
**Completed**, with the reviewer's reason in the status tooltip and how many times it sent
the agent on. OpenCode records no tokens or time per goal, so none are shown, and a goal
you clear is gone rather than kept in History.

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
