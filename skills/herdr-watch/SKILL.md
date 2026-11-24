---
name: herdr-watch
description: Set a Herdr watcher that notifies the user, and optionally messages you, when a pull request is reviewed, its checks finish, it becomes ready or merges, or when a shell command succeeds. Use inside Herdr (HERDR_ENV=1 or HC_TERMINAL_ID is set) when the user asks to be told about, or to wait for, something that happens later outside this conversation. Do not use it to wait for work you are doing yourself.
---

# Herdr watch

`herdr-watch` hands a wait to Herdr. Herdr checks once a minute while it is open, shows the watcher in its **Watchers** panel, and posts a notification when the wait ends. Set the watcher, tell the user what it waits for, and end your turn; do not poll or sleep.

```sh
herdr-watch pr                          # this branch's pull request: approved or changes requested
herdr-watch pr 42 --until checks        # its checks finish, passing or failing
herdr-watch pr <url> --until ready      # approved, checks passed, no conflicts (also reports what blocks it)
herdr-watch pr 42 --until merged
herdr-watch pr 42 --until comment       # a new comment or review
herdr-watch command --name "Staging is up" -- curl -sf https://staging.example.com/health
herdr-watch command --name "New release" --changes -- gh release view --json tagName -q .tagName
herdr-watch list
herdr-watch remove <id>
```

- `--then "<message>"` sends you that message in this terminal when the wait ends, after the outcome ("PR #42 approved"). Use it only when the user asked for a follow-up, and write the message as the instruction you will need then, for example `--then "Merge PR #42 with gh pr merge --squash, then pull main."`. A pull request watcher also ends when the pull request is closed, or for `ready` when something blocks it, so word the message for either outcome.
- `ready` always needs an approval. On a repository where nobody reviews it never comes: use `--until checks` there.
- `--every <seconds>` changes how often it checks (default 60, at least 15). `--cwd <folder>` checks from another folder.
- A command watcher runs the command with `sh` from the current folder, for at most a minute per check. It ends when the command exits 0, or with `--changes` when its output differs from the first run. Keep the command read-only and quick.
- Every command prints JSON. `{"error": "… already. Nothing to wait for."}` means the wait is already over: tell the user the outcome instead.
- Watchers check from this computer and stop while Herdr is closed. Say so if the user expects to be told overnight with Herdr quit.
