import { shared, setShared, notify, panes, focused } from "herdr";
import { STORE, MOVING, reduce, migrate } from "./pipeline-model.js";

// Writes shared state only when a stage changes: every write redraws the whole window.
export class PipelineTracker {
  start(cx) {
    this.last = null;
    cx.timer.every(1000, () => {
      const now = Date.now(), all = shared(STORE) ?? {};
      const away = this.last === null ? Infinity : now - this.last;
      this.last = now;
      let changed = false;
      const next = { ...all };
      for (const [id, saved] of Object.entries(all)) {
        const state = migrate(saved, now);
        let value = state;
        if (state?.tasks?.some(task => MOVING.includes(task.status))) {
          const pause = away > 2500 ? Math.max(0, Math.min(away, now - state.lastTick) - 1000) : 0;
          value = reduce(state, { type: "tick", pause }, now);
        }
        if (value !== saved) { next[id] = value; changed = true; this.announce(saved, value); }
      }
      if (changed) setShared(STORE, next);
    });
  }

  announce(before, after) {
    const was = new Map((before?.tasks ?? []).map(task => [task.id, task.status]));
    const asking = after.tasks.filter(task => task.status === "input" && was.get(task.id) !== "input");
    if (!asking.length || panes().find(pane => pane.pane === focused()?.pane)?.mod === "pipeline") return;
    for (const task of asking) notify({ title: `${task.id} needs your input`, body: task.question?.text, level: "warning", action: { name: "tabs-show.pipeline" } });
  }
}
