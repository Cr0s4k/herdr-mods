# Pipeline

An interactive native Herdr prototype. Visitor mode: Operate. The user observes a project-level planning agent dispatching tasks into a limited number of parallel work slots. A project may contain multiple repositories; a task may coordinate changes across several of them.

The approved direction is a stable constellation with left-to-right flow: picked tasks and watched columns feed a queue; a central planner chooses work; workers produce related PRs; approvals release coordinated merges. Both task intake methods share one queue. Quota reserve, dependency completion and outstanding PR limits govern dispatch. Review releases a worker slot. Doing, Review and Done correspond to successful launch, verified output and completed integration.

The simulation uses labeled synthetic tasks and a deterministic model of planning, execution, checks, quota and PRs; it does not start agents, modify task services or change Git repositories. Live mode (below) runs real agents. The eventual planner will be an agent, with constraints enforced by the execution engine. Background execution after quitting Herdr is outside the initial scope. Closing the view keeps the prototype progressing through a tracker in the tab bar; state is saved and resumes without catching up elapsed time while Herdr was closed.

## Direction contract

THESIS: Make dispatch visible and explain every wait. Task nodes travel through a planner into fixed work slots, then review and merge.

OWN-WORLD: Inherit Herdr's theme colors, native controls, typography and focus behavior. Use precise paths, small round ports, quiet orbital geometry and spacious labels. Color indicates state; text always names it.

STORY: Pick example tasks or watch a column, start the pipeline, observe why the planner chooses independent work, inspect a multi-repository task and approve its related PRs.

FIRST VIEWPORT: Pipeline title and Simulation badge above compact controls; a large spatial canvas owns the view. Queue at left, planner near one-third, three work slots beyond it, review at right and a completed trail below. A narrow inspector opens on selection. Native position transitions carry the dispatch moment. Reduced motion replaces travel with immediate state changes.

FORM: User-selected constellation, confirmed in conversation. Code-led native data geometry; no concept roll or raster comp substitutes for the pinned interaction. The ordinary mod system remains the visual authority.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Live execution (first version)

Live mode runs real agents on the project's repository. Tasks are typed in Pipeline or come from a tracker: the Plane project linked to the repository, or Linear filtered by scope (mine, unassigned, all) and an optional project. Tickets are picked from open ones, or queued automatically from a watched state, each ticket claimed once. Both are read through the panels' local readers (`herdr-plane`, `herdr-linear`, via `mods/pipeline/ticket-source.js`) and never written to. A task keeps the ticket as `task.ticket` (`provider`, `uuid`, `key`, `url`, `status`); watches and their last error live per provider in `watching` and `sourceErrors`. Linear states are matched by name (list_issues takes a state name), a Linear watch keeps the filter it was made with and needs My tickets or a project, and tickets are read in full with `get_issue` before they are queued (up to 10 at a time), because Linear's list shortens descriptions to 500 characters. Each dispatched task gets an isolated worktree and branch (`pipeline/<task>-<run>`, made by the shared `mods/linear/worktrees.py` helper) and an agent tab in the space Start was pressed in. The chosen agent starts with its plain `run` command plus, for Claude Code and Codex, the model and effort saved per agent in `tuning` (`--model`/`--effort`, or `-m`/`-c model_reasoning_effort=`); unset values leave the agent's own default. Herdr's agent status drives the card: working, blocked (Needs you), done or idle after working (Ready for review). Agents that report no status yet are checked for their folder-trust prompt. With a check command set, a finished task first runs it in its worktree (`sh -c`, up to 10 minutes, beside the Git queue): a pass moves it to review, a failure goes back to the agent with the end of the output up to twice, then waits for the person. A finished turn only counts after the agent was seen working, so a stale status never ends the next turn early. Approving a task runs `mods/pipeline/delivery.py`: commit leftovers, rebase onto the project folder's current branch, fast-forward, then close the agent's tab and remove the worktree and branch. With pull request delivery, approving instead pushes the branch to `origin` and opens a PR with `gh pr create` into the worktree's start branch (`delivery.py publish`, which reuses an existing PR). `merging` covers only the push and `gh pr create`; an open PR is its own `pr` status, which the runner asks `gh pr view` about once a minute, finishing the task on MERGED or returning it to review on CLOSED. With `autoPr` set, a task that reaches review on its own (agent done with no check, or checks passed) is approved immediately; failing checks, Review anyway and a closed PR still wait for the person. The runner (`mods/pipeline/pipeline-live.js`) lives in the tab-bar tracker, runs one Git job at a time and never replays a start it could not confirm.

## Next milestone

Dependencies between tasks (Plane relations included), and pull requests on hosts other than GitHub.
