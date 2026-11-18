Herdr Pipeline is taking this conversation over as its task {{task}}, so the person can review and merge your work there.
Pipeline will make a Git worktree and branch for it and move your uncommitted work into it, then tell you to switch. For now, change no project file. Write this JSON file, then stop:
{{file}}
{"title": "…", "description": "…", "files": ["…"]}
- title: what this conversation's work is, as a task title under 90 characters.
- description: what the person asked for, what is done and what is left, in a few plain lines.
- files: every file with uncommitted changes that you changed or created in this conversation, as paths relative to {{root}}. Leave out files that other agents or the person changed, and anything already committed. An empty list when there are none.
