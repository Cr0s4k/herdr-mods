// Pipeline's unfinished tasks as palette rows, found by task id, ticket key, pull request number or branch.
export const STORE = "pipeline.prototype.v1";
const STATE = { queued: "queued waiting", routing: "starting", working: "working", input: "needs you", testing: "checks running", review: "ready for review", merging: "merging", pr: "pull request open", failed: "stopped failed" };

export function taskJumps(all, spaces) {
  const out = [];
  for (const state of Object.values(all ?? {})) {
    if (!state?.live) continue;
    const on = state.context?.on ?? null, own = state.space ?? state.context?.space;
    const space = spaces.find(s => s.id === own) ?? spaces.find(s => (s.machine ?? null) === on && s.folder === state.context?.cwd);
    if (!space) continue;
    for (const task of state.tasks ?? []) {
      if (task.status === "done" || task.discard) continue;
      const prs = Object.values(task.prs ?? {}).filter(pr => pr?.number), branches = Object.values(task.workspaces ?? {}).map(w => w?.branch).filter(Boolean);
      const marks = [task.ticket?.key, ...prs.map(pr => `#${pr.number}`)].filter(Boolean);
      out.push({ space: space.id, task: task.id, title: `Go to ${task.id}${marks.length ? ` (${marks.join(", ")})` : ""}: ${task.title}`,
        words: ["pipeline task jump find", STATE[task.status], task.ticket?.url, ...prs.map(pr => pr.url), ...branches, space.name].filter(Boolean).join(" ") });
    }
  }
  return out;
}
