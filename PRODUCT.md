# Herdr Mods

Herdr Mods extends the native Herdr desktop app for personal coding projects. It keeps
project tools, task context and agent handoffs close to the terminals where work happens.
The repository is the source; installation copies mods and layouts into Herdr's config.

## Tasks

The Tasks panel connects a repository to a project in the user's self-hosted Plane
instance. Users can browse and search work, capture an idea, read requirements, and hand
a task to a coding agent. A local checkout, its subfolders and Git worktrees share one
mapping. Remote mappings belong to the exact working folder on that machine.

The current scope includes task capture with title, description and priority; read-only
task browsing; full rich-text descriptions converted to Markdown; manual handoff to an
idle agent or a new session; and reviewed launches into isolated branches and worktrees.
Task status and assignee change only through the user's existing Plane workflow. Linear
remains available from the Tasks connection settings.

Plane owns the backlog. Herdr owns the working-folder destination, launch review and
session navigation. A changed repository must resolve its own Plane mapping, including
inside a moved Tasks pane. Uncertain saves or launches must not be automatically replayed.
Credentials and mappings are private local configuration, separate from repository files.

## Native interface constraints

Extend the established Herdr ticket panel. Use its GPUI components, theme colors,
typography, spacing, buttons, inputs and virtual lists. Keep the panel usable at its
280px minimum width and as a normal pane. Preserve keyboard navigation, explicit
destinations, loading and empty states, useful errors, and the last successful results
when a refresh fails. No new visual identity is part of this extension.

## Remote access and future work

Pipeline is native visual agent orchestration. Its simulation uses labeled example tasks to
show planning, parallel work, quota reserves, dependency scheduling, cross-repository PR
approval and merge. Live mode runs real agents on one repository: typed tasks or tickets
from the repository's Plane project (picked, or queued from a watched state), an isolated
worktree and branch per task, agent tabs in the project's space, Herdr's agent status as
the task state, and an approved branch rebased and fast-forwarded into the project's
current branch. Pipeline only reads Plane. Linear as a live source, multi-repository
tasks, checks, pull requests and agent planning are follow-up work. Agents keep running in herdr-core while Herdr is
closed; the tab-bar tracker catches up when it opens.

The user wants to capture and plan work while away from the development machine. Plane's
existing web interface and the user's private network provide backlog access. Durable
scheduled agent execution and a small phone scheduling page are follow-up work. A task
planning date does not launch an agent in the current integration.
