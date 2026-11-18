Agents here are asked for before and after screenshots of what they change, and each one works out by itself how to start the project. Write that down once.
Add a project skill at .claude/skills/demo/SKILL.md. Symlink .agents/skills/demo to its folder so Codex finds it too, and link it from AGENTS.md or CLAUDE.md if the repository has one. It says:
- how to start the project locally from a fresh Git worktree: env files, dependencies, database or other services, and the command. When PIPELINE_PORT is set, use it as the port so several branches can run at once; say how.
- how to sign in locally: a seeded user or the way to make one. No real credentials.
- which screens matter and how to reach them, and how to take a screenshot of one with the tools this repository already has.
- how to stop everything it started.
Follow the skill yourself once, from this worktree, and fix what doesn't work before you finish. Keep it short: steps and commands, no background.
