---
name: herdr-brief
description: Leave a short, human-readable outcome in Herdr's Since you left panel after substantive work or when a decision is needed. Skip routine commits, pushes, agent status changes, and conversational replies.
---

# Herdr brief

Before the final reply for substantive work in Herdr, post a short note for the person returning to their project. Lead with what they can now do or what was fixed. If work is incomplete, say what remains and whether you need their answer.

In a Herdr Pipeline task (your first message says Pipeline made the worktree), post no brief: the summary file Pipeline asked for is the report, and Pipeline tells the person when the task needs them.

When you post nothing and your turn ends while the person is away, Herdr shows the first paragraph of your final reply instead. A brief you write is better: it says what they can now do, where your reply may open with something else.

Write for the person, not the activity log:

- Use a concrete title such as "Spaces can hide until tomorrow", rather than "Agent finished" or "Changes committed and pushed".
- Keep the title to a few words and the summary to one short sentence. Explain the visible outcome; avoid file inventories, commit hashes, command logs and repeated completion claims.
- Read the task request and actual result before writing. Explain the difference the person will notice, including where to find or use it. A list of files or tool calls doesn't explain the outcome.
- Use `--change` for one or two short practical details when needed. These are hidden behind **Read more**. Prefer "Bring a hidden space back early" to "Added a restore handler". Omit this section when the summary is enough.
- Put actual validation in `--test` for the saved record; checks are not displayed in the panel, including under **Read more**. Use `--caveat` only for a concrete blocker or limitation that affects using the result. Keep it short; skip routine process notes. Caveats stay visible under **Keep in mind**.
- Use `--question` only for a decision or answer the person needs to give. Questions stay visible under **Needs your answer**.
- Markdown is supported: use short paragraphs, occasional **bold** or `code` where useful. Avoid tables, nested lists and headings inside a brief.
- Skip a separate brief for a routine commit, push, clean working tree, repeated validation, or finishing a turn. Include publishing details only when they affect the person, such as where to try a release or a failed push blocking delivery.

For example:

```sh
herdr-brief post --title "Hide quiet spaces" \
  --summary "Hide a space until a time you choose." \
  --change "Terminals keep running; restore early from Hidden spaces." \
  --test "All sidebar tests passed; checked hiding and early restore in the app."
```

`--change`, `--test`, `--caveat`, and `--question` repeat. Omit empty sections and avoid repeating the summary. Record actual validation and failures; if validation was not run, say so. Do not send messages to other agents or start validation solely to fill this panel.

The command binds to your own terminal when available, otherwise to the unique working agent in the current directory. It refuses ambiguous matches. Use `--terminal <address>` only when the exact terminal is already known; never guess or use the user's focused space. `--cwd <folder>` supplies the task folder if the command runs elsewhere. If posting fails, report that briefly and finish the user's task; don't change their layout or invent a destination.
