const STORE = "pipeline.prototype.v1";
export { STORE };
const STATE = { queued: "queued", routing: "starting", working: "working", input: "needs you", testing: "running checks", review: "in review", merging: "merging", pr: "PR open", failed: "stopped" };

// What Herdr knows about each checkout that Git doesn't: the unfinished Pipeline task that owns it, and the terminals open in it.
export function annotate(rows, all, panes, on) {
  const tasks = new Map();
  for (const state of Object.values(all ?? {})) {
    if (!state?.live || (state.context?.on ?? null) !== (on ?? null)) continue;
    for (const task of state.tasks ?? []) {
      if (task.status === "done" || task.discard) continue;
      for (const ws of Object.values(task.workspaces ?? {})) for (const path of [ws?.root, ws?.cwd]) if (path) tasks.set(path, { id: task.id, state: STATE[task.status] ?? task.status });
    }
  }
  const machine = pane => pane.terminal?.includes("/") ? pane.terminal.split("/")[0] : null;
  return rows.map(row => ({ ...row, task: tasks.get(row.path) ?? null,
    open: panes.filter(p => p.terminal && machine(p) === (on ?? null) && (p.cwd === row.path || p.cwd?.startsWith(row.path + "/"))).length }));
}

// Git refuses a locked checkout and one with uncommitted files; one in use is left alone here.
export const removable = row => !row.locked && !(row.dirty > 0) && !row.task && !row.open;
export const suggested = row => removable(row) && (row.gone || row.ahead === 0 || Boolean(row.pr));

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function tags(row, target) {
  const out = [];
  if (row.task) out.push({ text: `Pipeline ${row.task.id} · ${row.task.state}`, tone: "held" });
  if (row.open) out.push({ text: `${plural(row.open, "terminal")} open`, tone: "held" });
  if (row.locked) out.push({ text: "locked", tone: "held" });
  if (row.gone) out.push({ text: "folder is gone", tone: "good" });
  if (row.dirty > 0) out.push({ text: `${plural(row.dirty, "uncommitted file")}`, tone: "bad" });
  if (row.pr) return [...out, { text: `merged in #${row.pr}`, tone: "good" }];
  if (row.ahead === 0) out.push({ text: `nothing ${target} lacks`, tone: "good" });
  else if (row.ahead > 0) out.push({ text: `${plural(row.ahead, "commit")} not in ${target}`, tone: "warn" });
  if (row.only > 0) out.push({ text: `${row.only} not pushed`, tone: "bad" });
  else if (row.ahead > 0 && row.only === 0) out.push({ text: "pushed", tone: "good" });
  return out;
}

export function ago(at, now = Date.now()) {
  if (!at) return "";
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
}

export function outcome(results) {
  const removed = results.filter(r => r.removed), kept = removed.filter(r => r.kept), failed = results.filter(r => r.error);
  return [removed.length ? `Removed ${plural(removed.length, "worktree")}` : null,
    kept.length ? `kept ${plural(kept.length, "branch").replace("branchs", "branches")} that ${kept.length === 1 ? "isn't" : "aren't"} merged` : null,
    failed.length ? `Git refused ${failed.length}` : null].filter(Boolean).join(" · ");
}
