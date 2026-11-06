---
name: herdr-brief
description: Leave a persistent handoff in Herdr's per-space Since you left panel after completing coding work, running validation, or reaching an unresolved question in Herdr. Use for substantive work in Herdr; skip conversational replies and tasks with nothing to hand off.
---

# Herdr brief

Before the final reply for substantive work in Herdr, post a concise handoff:

```sh
herdr-brief post --title "Login fix ready" --summary "Fixed the redirect after sign-in." \
  --change "Updated the callback handler in src/auth.ts." \
  --test "Passed: npm test (42 tests)." \
  --question "Should expired sessions return to the original page?"
```

`--change`, `--test`, and `--question` repeat. Omit empty sections. Record actual validation and failures; if validation was not run, say so. A handoff describes the outcome, not the tool-call history. Do not send messages to other agents or start validation solely to fill this panel.

The command binds to your own terminal when available, otherwise to the unique working agent in the current directory. It refuses ambiguous matches. Use `--terminal <address>` only when the exact terminal is already known; never guess or use the user's focused space. `--cwd <folder>` supplies the task folder if the command runs elsewhere. If posting fails, report that briefly and finish the user's task; don't change their layout or invent a destination.
