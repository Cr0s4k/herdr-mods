# Skills

**Skills** in the top toolbar opens a searchable inventory for the working folder and
machine. **Available here** combines discovered project and personal skills with skills
from plugins enabled in local configuration. **Personal library** shows personal,
managed, built-in and cached plugin skills, including disabled or unverified copies.
Filter either view by **All agents**, **Codex**, **Claude** or **OpenCode**. Plugin and built-in groups
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
OpenCode's skills aren't read from folders: the reader asks OpenCode's own server
(`opencode api GET /api/skill`) what a session in the working folder loads, so they include
the Claude and `.agents` skills it picks up and its built-ins, which open from the text the
server returns. OpenCode has no command to copy for a skill.
The reader runs on the selected space's machine, using Python 3, and refreshes every
15 seconds or manually. The folder follows terminal focus; a moved pane stays in its tab.

This is **filesystem discovery, not a running agent's loaded-skills list**. Per-session
options, trust, managed policies, account state and agent versions can change what loads.
Cached Codex plugins without confirmed enablement, or with multiple cached versions,
appear only in Personal library as unverified. Claude's built-ins that have no local
manifest are not indexed. A plain repository `skills/` folder contains source files and
does not itself install those skills for any agent.
