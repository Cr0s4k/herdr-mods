# Files and Git in a dialog

The Files and Git panels only list; clicking a file opens it in a large dialog instead of
the narrow panel. ↑/↓ steps through the listed files, Esc closes, and Vim's keys move
through the file (see [Keys in the dialog](#keys-in-the-dialog)).

**Git** is Herdr's Changes panel, renamed. It has two tabs: **Changes**, your uncommitted
files, and **History**, the commits (see [History](#history)).

- **Files** shows the file with syntax highlighting (Herdr's code view).
  Use **Collapse all folders** in its header to close every expanded folder at once.
- **Changes** shows the diff, **Split** (old and new side by side) or **Unified** (`S` toggles,
  and the choice sticks). When there is more than one file, every file sits in a list on the
  left with its status and +/− counts; click one to open it. The list follows ↑/↓. Diffs are syntax-highlighted with [`bat`](https://github.com/sharkdp/bat)
  when it's installed (`brew install bat`), in the theme's terminal colors; without it they're plain.
- Images (PNG, JPEG, GIF, WebP, BMP, ICO, AVIF, TIFF) show as pictures: in Files on their own,
  in Changes as **Before** (`HEAD`) and **After** (working copy) side by side, like GitHub. SVGs
  stay text. Local folders only; the copies Herdr needs to load them live in
  `~/.config/herdr-app/data/image-preview/` and are deleted after a day.
- The bottom of **Changes** shows the branch and, like VS Code, how many commits are waiting:
  **↑N Push** for local commits not yet pushed, **↓N Pull** for commits on the remote you don't
  have. It fetches when the folder changes and every 3 minutes (**↻** fetches now). A branch
  with no upstream shows **Publish** (`git push -u origin HEAD`). Pull runs plain `git pull`, so
  your `pull.rebase` setting applies; failures show in red above the bar.
  The bottom status bar shows the same counts beside the space's branch (`main ↑2 ↓1`), only when
  there is something to push or pull. Click **↓N** to pull or **↑N** to push; a failure shows in
  red beside them for a few seconds. It checks every 10 seconds and fetches every 3 minutes.
- Files and Git use VS Code's [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme)
  file and folder icons (MIT, vendored in `mods/files-modal/icons/`; `scripts/icons.sh` updates them).

## Keys in the dialog

Like Vim, a number before a key repeats it: `10j` moves ten lines down.

| Key | Moves |
|---|---|
| `j` / `k` | a line down / up |
| `⌃D` / `⌃U` | half a screen down / up, scrolling with it (`20⌃D`: 20 lines) |
| `⌃F` / `⌃B`, Page Down / Page Up | a screen down / up |
| `gg` / `G` | to the top / bottom; `42G` to line 42 |
| `]c` / `[c` | to the next / previous change (Git only) |
| `C` / `X` | add or edit a note on the line / remove it (Git only; see [Notes for the agent](#notes-for-the-agent)) |
| `V` | pick lines from here, for one note on all of them (Git only) |
| ↑ / ↓ | to the next / previous file |

- In a diff the line under the cursor is marked; clicking a line moves it there. The view
  keeps three lines around it, and a long jump such as `G` centres it. The footer shows a
  count or `g` while you type it; Esc drops it.
- In Files the cursor is Herdr's code-view caret: its line number lights up and the footer
  shows `Ln 42 / 300`. Clicking into the text hands the keyboard to the code view, so ↑/↓
  then move its caret instead of changing file.

## Notes for the agent

While you read a diff, leave notes on its lines and send them all to the agent as one message,
instead of describing each place in its terminal.

- **`C`** on the line under the cursor opens a note. Enter saves it, ⇧Enter starts a new line
  in it, Esc cancels. The note sits under its line; `C` there edits it and **`X`** removes it.
  Saving it empty removes it too.
- For a note on several lines, press **`V`**, move to the last one (`j`, `3j`, `]c`…) and press
  `C`: the picked lines are tinted, and the note says `note on 21-24` and sits under the last.
  `V` again or Esc drops the pick. The lines are the ones on the side of the row you end on:
  end on a removed line to note removed lines. The message quotes up to twelve of them.
- Notes stay while you step through the files, close the dialog and come back: the file list
  and the Changes tab show how many each file has. A note follows its line when the file
  changes; when the line leaves the diff, the note moves to the top and says so.
- A bar under the header counts the checkout's notes. **Send** (`⌘↵`) sends them to the agent
  working in that folder: the one in front, else the one that acted last. With several, click
  the agent's name to pick another. The message lists each note with its file, line and the
  line quoted ([what the agent receives](../../skills/herdr-pipeline/examples.md)). Sent notes
  are removed; if the agent doesn't take them (it is waiting for an answer, say), they stay.
- **Copy** puts the same message on the clipboard, for a folder with no agent. **Clear**
  removes every note, and asks once.
- Notes work on a removed line, in a Pipeline task's diff and in a commit opened from History.
  Each of those keeps its own notes, and Send takes all of the checkout's.
- Unsent notes are dropped after 30 days.

## Clean up worktrees

**Clean up worktrees…** in the [command palette](palette.md) lists the other worktrees of the
focused pane's repository, so the ones left behind by finished or abandoned work can go
without guessing what is in them.

- Each row shows the branch, the folder, when it last got a commit, and what removing it
  would lose, compared with the branch the main checkout is on: **nothing main lacks**, **3
  commits not in main** (then **pushed**, or **2 not pushed** for commits that exist nowhere
  else), **4 uncommitted files**, **folder is gone**.
- It opens with the ones that lose nothing ticked: no commits of their own, or a folder that
  is already gone. Click a row (or Space) to tick or untick it.
- A worktree can't be ticked while an unfinished Pipeline task owns it, a terminal is open in
  it, it is locked, or it has uncommitted or untracked files. Commit or discard those first.
- **Remove** asks once, then runs `git worktree remove` and `git branch -d` for each, never
  with force: Git still refuses a worktree with changes, and a branch that isn't merged stays
  (the row then says so). A folder that is gone is pruned.
- It doesn't know about squash merges: a branch merged that way shows its commits as not in
  main. If they are pushed, removing the worktree keeps the branch.

## Find file

**⇧⌘N** (or the magnifier in the Files header) searches the focused pane's project by file name,
like VS Code's Go to File. Letters match in order with gaps between them, so `fmain` finds
`files-modal/main.js`; a space separates words that all have to match. Matches in the file name,
at the start of a word and in a run rank first. With nothing typed, it lists the files you
opened from it recently, then the changed ones (marked M, A or U like in Files).

↑/↓ picks, Enter opens the file in the same dialog as Files, where ↑/↓ then
steps through the other matches. Esc closes.

- It searches the whole Git repository the pane is in: tracked and untracked files, without
  ignored ones. Outside Git it searches the pane's folder, skipping hidden folders and
  `node_modules`. Very large projects are cut at about 60,000 paths, and the popup says so.
- The matching runs inside the mod, in the style of [fzf](https://github.com/junegunn/fzf),
  so nothing needs installing and it works on spaces on other machines.
- Install adds the key to `global` in `~/.config/herdr-app/keys.json`, so it works in every
  layout, and never replaces a key you set there. To use another key, bind `mod.open:find-file`
  to it there instead; install then leaves ⇧⌘N alone, and the Files button's tooltip and the
  command palette show your key.
- The [command palette](palette.md) lists it as **Find file…**.

**Changes + terminal** is a separate action beside the Files, Git, Show and Loops side-panel
toggles. It opens Git as a normal pane on the right, with a normal terminal pane below
it, starting at equal height. Once open, the action becomes **Focus changes** and returns
to that pane without creating another terminal or closing your chosen side panel.
Pane navigation, swapping, dragging, splitting, zooming and closing use Herdr's usual
shortcuts and controls. The arrangement belongs to its tab and Herdr remembers it.
**Git** toggles the normal side panel, just like Files, Show and Loops. It works
independently of the review panes, so either view is available when you want it.

Files, Git, Show and Loops each have a **Move to pane** icon in their side-panel header.
It opens that view as a normal pane in the current tab, then hides the side panel. New panes
keep the current folder expansion, commit draft, Git tab or filters. If that view already has a pane
in the tab, the action focuses it and keeps its existing state. These panes support the usual
navigation, drag, split, zoom and close controls. Use the toolbar toggle whenever you want
the side panel again. Moving a panel does not start a terminal; **Changes + terminal**
remains the shortcut for the paired layout.

## History

- Lists the latest 1,000 commits, newest first, with a graph of where branches fork and merge.
  **All branches** (on by default) includes every local branch, remote branch and tag; off, only
  the checked-out branch. Branch, remote and tag names sit on the commit they point at; the
  checked-out branch is highlighted and its commit's dot is a ring.
- **↑ not pushed** marks commits of the checked-out branch that no remote has yet.
- The search box filters by message, author, hash or branch name; every word must match. The
  graph hides while you search.
- Click a commit for its details under the list; double-click to go straight to its diff.
  - **View changes** opens its files and diffs in the same dialog as Changes, compared with its
    first parent.
  - **Copy hash** copies the full hash.
  - **GitHub** opens the commit on GitHub, the same way the tab bar's GitHub button opens the
    repository. It shows only when the repository has a GitHub remote, and works once the
    commit is pushed.
  - **Revert** asks first, then makes a new commit that undoes it. It works on commits of the
    checked-out branch, not on merge commits, and only with no uncommitted changes to tracked
    files. If Git stops on a conflict, the revert is undone and the error shows in red.
- It re-reads the log when a branch, tag or `HEAD` moves, checked when the folder changes and
  every 10 seconds.
