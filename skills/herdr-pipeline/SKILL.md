---
name: herdr-pipeline
description: The procedures Herdr Pipeline gives the agent of each task - the review summary, before and after screenshots with a walkthrough page, the pull request description, and handing the code to an implementer. Use when you work in a Pipeline task's worktree and no longer have its first message (after compaction, or in a new conversation there), or when asked to read or change what Pipeline tells its agents.
---

# Herdr Pipeline procedures

Pipeline starts one agent per task in its own Git worktree. Its first message names the task, the worktree and the branch, then pastes the procedures below that apply. They are pasted, not referenced, so an agent on a machine without this skill still gets them.

## Working in a Pipeline task

The first message is the authority. If you no longer have it:

- `herdr-pipeline <task>` prints the task, its worktrees and what Pipeline is waiting for.
- Follow [procedures/summary.md](procedures/summary.md) before you stop, every time. Its file is the one `git rev-parse --git-path herdr-summary.md` prints in the worktree.
- Follow the others only when the first message asked for them. When you can't tell, write the summary and say on its Unsure line what you left out.
- Commit on the task's branch and stop. Pipeline merges or opens the pull request; never push or open one yourself.

## The procedures

`{{name}}` marks a value Pipeline fills in from the task.

| File | Sent when | Filled in |
|---|---|---|
| [summary.md](procedures/summary.md) | every task | `file`: where the summary goes |
| [pull-request.md](procedures/pull-request.md) | delivery is by pull request | `where`, `files`: the description file per repository; `ticket`: asks for the ticket link when there is one |
| [evidence.md](procedures/evidence.md) | Show the change is on | `tryout`: the Try it command and port; `folder`: where screenshots go; `walkthrough`: the text of walkthrough.md |
| [evidence-later.md](procedures/evidence-later.md) | screenshots are asked for from the inspector, after the work | as evidence.md, plus `base`: the commit the task started from |
| [walkthrough.md](procedures/walkthrough.md) | inside both evidence procedures | `tryout`: how to try the change locally |
| [implementer.md](procedures/implementer.md) | an implementer is set and the task didn't opt out | `implementer`: its name; `where`: the folder to run from; `command`: the line that runs it |
| [demo-task.md](procedures/demo-task.md) | the setup card's task that writes a run-and-show skill for a project | nothing |

## Changing one

Edit the file here, in `skills/herdr-pipeline/procedures/`. `mods/pipeline/procedures` is a link to this folder and Pipeline reads the installed copy, so run `./install.sh` afterwards (from the main checkout, never a worktree). New tasks get the new text; running agents keep what they were sent.

- Pipeline reads these names back, so keep them: `herdr-summary.md` with its `Changed:`, `Checked:` and `Unsure:` lines, `herdr-pr.md`, `herdr-brief.md`, the `herdr-evidence` folder with `NN-before-…png` and `NN-after-…png` pairs, and `walkthrough.url`.
- evidence-later.md is sent as one line: its lines are joined with spaces, so it takes no lists. walkthrough.md sits inside a list item and stays one line.
- A new `{{name}}` needs its value in `mods/pipeline/pipeline-live.js`, where each procedure is filled (`procedure(name, values)`); an unknown name becomes nothing. A new file also goes in `PROCEDURES` there.
- `node --test tests/pipeline-live.test.mjs tests/pipeline-view.test.mjs` checks the wording other code depends on and that no placeholder is left unfilled.

The task framing around these (worktree, branch, hand-off), the messages sent after a failed check or a refused merge, and the planner's and setup helper's prompts are built in `mods/pipeline/pipeline-live.js`, because they are mostly values from the task or tied to a JSON schema.
