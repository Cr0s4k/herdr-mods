---
name: herdr-brief
description: Leave a short, human-readable outcome in Herdr's Since you left panel after substantive work or when a decision is needed. Skip routine commits, pushes, agent status changes, and conversational replies.
---

# Herdr brief

Before the final reply for substantive work in Herdr, post a short note for the person returning to their project. Lead with what they can now do or what was fixed. If work is incomplete, say what remains and whether you need their answer.

Write for the person, not the activity log:

- Use a concrete title such as "Spaces can hide until tomorrow", rather than "Agent finished" or "Changes committed and pushed".
- Keep the summary to one or two plain-language sentences. Explain the visible outcome; avoid file inventories, commit hashes, command logs and repeated completion claims.
- Put optional implementation details in `--change` and actual checks or limitations in `--test`. These are collapsed in the panel. Questions stay visible, so use `--question` only for something the person needs to answer.
- Markdown is supported: use short paragraphs, occasional **bold** or `code` where useful. Avoid tables, nested lists and headings inside a brief.
- Skip a separate brief for a routine commit, push, clean working tree, repeated validation, or finishing a turn. Include publishing details only when they affect the person, such as where to try a release or a failed push blocking delivery.

For example:

```sh
herdr-brief post --title "Sign-in returns you to your page" \
  --summary "After signing in, you now return to the page you were trying to open." \
  --change 'Updated the callback handler in `src/auth.ts`.' \
  --test "All 42 sign-in tests passed." \
  --question "Should expired sessions return to the original page?"
```

`--change`, `--test`, and `--question` repeat. Omit empty sections and avoid repeating the summary. Record actual validation and failures; if validation was not run, say so. Do not send messages to other agents or start validation solely to fill this panel.

The command binds to your own terminal when available, otherwise to the unique working agent in the current directory. It refuses ambiguous matches. Use `--terminal <address>` only when the exact terminal is already known; never guess or use the user's focused space. `--cwd <folder>` supplies the task folder if the command runs elsewhere. If posting fails, report that briefly and finish the user's task; don't change their layout or invent a destination.
