---
name: herdr-pipeline
description: What Herdr Pipeline and the Linear and Plane panels tell the agents they start - the review summary, before and after screenshots with a walkthrough page, the pull request description, handing code to an implementer, and the follow-up requests. Use when you work in a Pipeline task's worktree and no longer have its first message (after compaction, or in a new conversation there), or when asked to read or change what these mods tell agents.
---

# Herdr Pipeline procedures

Pipeline starts one agent per task in its own Git worktree. Its first message names the task, the worktree and the branch, then pastes the procedures below that apply. They are pasted, not referenced, so an agent on a machine without this skill still gets them.

[examples.md](examples.md) shows every message in full, with sample values.

## Working in a Pipeline task

The first message is the authority. If you no longer have it:

- `herdr-pipeline .` prints the task whose worktree you are in, and what Pipeline is waiting for.
- Follow [procedures/summary.md](procedures/summary.md) before you stop, every time. Its file is the one `git rev-parse --git-path herdr-summary.md` prints in the worktree.
- Follow the others only when the first message asked for them. When you can't tell, write the summary and say on its Unsure line what you left out.
- Commit on the task's branch and stop. Pipeline merges or opens the pull request; never push or open one yourself.

## The procedures

One file each in `procedures/`. `{{name}}` marks a value the mod fills in.

| File | Sent | Filled in |
|---|---|---|
| summary.md | first message, always | `file`: where the summary goes |
| pull-request.md | first message, with pull request delivery | `where`, `files`: the description file per repository; `ticket`: asks for the ticket link |
| evidence.md | first message, with Show the change on | `tryout`: the Try it command and port; `folder`: where screenshots go; `walkthrough`: walkthrough.md |
| implementer.md | first message, with an implementer set | `implementer`: its name; `where`: the folder to run from; `command`: the line that runs it |
| ticket.md | first message of a task with a ticket, and inside ticket-launch.md | `service`: Linear or Plane; `owner`: who may change the ticket |
| evidence-later.md | Ask for screenshots in the inspector | `tryout`, `folder`, `walkthrough` as above; `base`: the commit the task started from |
| walkthrough.md | inside both evidence procedures | `tryout`: how to try the change locally |
| check-failed.md | the check command failed | `command`, `output` |
| merge-refused.md | the branch could not be merged | `target`: the branch; `error`: what Git said |
| pr-conflict.md | an open pull request conflicts with its base, from the inspector; also the first message of an agent reopened for it | `number`: the pull request; `target`: its base branch |
| pr-checks.md | an open pull request has failing checks, from the inspector (or a reopened agent's first message) | `number`: the pull request; `checks`: the failing checks' names |
| pr-review.md | an open pull request has review comments, from the inspector (or a reopened agent's first message) | `number`: the pull request |
| pr-comments.md | comments picked in a pull request's list in the inspector, with **Send to agent** (or a reopened agent's first message) | `number`: the pull request; `count`: how many; `comments`: each numbered with who wrote it, its link and its text quoted; `note`: what the person added, or nothing. The agent writes its reply to `herdr-reply.md` in the worktree's Git folder, which Pipeline offers to post with the re-review |
| uncommitted.md | delivery found uncommitted changes | nothing |
| adopt-ask.md | a running conversation is converted into a task | `task`: its id; `file`: the JSON file to write; `root`: the project folder |
| adopt-moved.md | the converted work went to a new agent | `task`, `folder`: its worktree |
| ticket-launch.md | a ticket started from the Linear or Plane panel, after the ticket itself | `ticket`: ticket.md |
| demo-task.md | the setup card's task that writes a run-and-show skill | nothing |
| review-notes.md | **Send** in the Git dialog, after notes were left on lines of a diff (to an agent working in that folder, Pipeline's or not) | `count`: how many notes; `notes`: the numbered notes, each with its file and line or lines, those lines quoted, and what the person wrote |

## Changing one

1. Edit the file in `skills/herdr-pipeline/procedures/`.
2. `node skills/herdr-pipeline/preview.mjs --write` rewrites examples.md. Read the diff: it is what agents will now receive.
3. `node --test tests/*.test.mjs`. It fails when examples.md is stale, a placeholder is unfilled or missing from the table above, or wording other code depends on is gone.
4. `./install.sh` from the main checkout, never a worktree. The mods read the installed copy (`mods/pipeline/procedures` is a link to this folder). New messages get the new text; running agents keep what they were sent.

Rules the files must keep:

- Pipeline reads these names back: `herdr-summary.md` with its `Changed:`, `Checked:` and `Unsure:` lines, `herdr-pr.md`, `herdr-reply.md`, `herdr-brief.md`, the `herdr-evidence` folder with `NN-before-…png` and `NN-after-…png` pairs, `walkthrough.url`, and the `title`, `description` and `files` keys of adopt-ask.md.
- evidence-later.md is sent as one line: its lines are joined with spaces, so it takes no lists. walkthrough.md, ticket.md and uncommitted.md stay one line.
- A new `{{name}}` needs its value where the procedure is filled: `procedure(name, values)` in `mods/pipeline/pipeline-live.js`, or `mods/linear/model.js` for ticket-launch.md, or `mods/changes-modal/main.js` for review-notes.md. An unknown name becomes nothing.
- A new file goes in `PROCEDURES` in `mods/pipeline/procedures.js`, in the table above, and in `preview.mjs` so it shows in examples.md.

Still built in code, because they are mostly values from the task or tied to a JSON schema: the task framing around these (worktree, branch, hand-off) and the planner's and setup helper's prompts, all in `mods/pipeline/pipeline-live.js`.
