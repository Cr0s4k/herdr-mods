# Watchers

The **Watchers** tab beside Show waits for things that happen outside Herdr and tells you when
they do: a toast in Herdr with the alert sound, and a macOS notification when Herdr isn't the
app in front. Clicking the toast opens the panel. The tab shows how many are still waiting
(**Watchers (2)**).

**New watcher** has two kinds:

- **Pull request**: a number or link, or nothing for the pull request of the branch in the
  focused terminal's folder. Pick what to wait for: **Review** (approved, or changes
  requested), **Checks** (its checks finish, passing or failing), **Ready** (approved, checks
  passed and no conflicts; it also ends on what blocks it: requested changes, a failed check or
  conflicts), **Merged**, or **Comment** (a new comment or review). Every pull request watcher
  also ends when the pull request merges or is closed. A review that was already there when
  the watch began isn't news; only a newer one counts.
- **Command**: a name and a shell command, run with `sh` in that folder. It ends when the
  command **exits 0**, or when its **output changes** from the first run. Use it for anything
  else: a deploy answering, a release appearing, a file showing up.

Watchers are grouped by the space whose folders hold them. The shown space's group comes first
and is open; the others are folded to one line with their counts (click to open). A watcher of
a folder no space has open sits under that folder's name.

A waiting watcher shows what it read last (review, checks, draft, conflicts, or the command's
exit code and last line), when it was checked, **Check now** and **Stop**. Finished ones move
to the end of their group with their outcome until you **Remove** them or **Clear finished**. A watcher that
can't be read (no network, `gh` logged out) says why and keeps trying.

From a terminal, and for agents through the `herdr-watch` skill:

```sh
herdr-watch pr                         # this branch's pull request, until it is reviewed
herdr-watch pr 42 --until checks
herdr-watch pr 42 --until ready --then "Merge it with gh pr merge --squash, then pull main."
herdr-watch command --name "Staging is up" -- curl -sf https://staging.example.com/health
herdr-watch list
herdr-watch remove <id>
```

`--then` sends that message, after the outcome, to the terminal the watch was set from, so an
agent can pick up where it left off (`--terminal` names another one). `--every` sets the
seconds between checks (60 by default, at least 15).

Watchers are checked every 15 seconds for the ones that are due, from this computer, while
Herdr is open: a quit Herdr checks nothing and catches up on the next start. Pull requests are
read with GitHub's `gh` (GitHub only), so a remote space's pull request needs its link.
Watchers live in `~/.config/herdr-app/watchers/`, one file each. Needs Python 3.
