---
version: 1
slug: "mods-pipeline-main-js"
primary_target: "mods/pipeline/main.js"
related_targets: ["mods/pipeline/pipeline-model.js","mods/pipeline/geometry.js"]
---

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

## Validation and next milestone

Check the mod in Herdr, inspect full-width and narrow-pane compositions, and exercise intake, concurrency, quota pause, failure/retry, per-repository approval and dependency release. No shipping raster assets are needed. Live mode now starts real agents and merges their branches; Plane as a live source, checks, pull requests and agent planning remain future work.
