import { shared, setShared } from "herdr";
import { STORE, reduce, ACTIVE } from "./pipeline-model.js";

export class PipelineTracker {
  start(cx) {
    cx.timer.every(1000, () => {
      const all = shared(STORE) ?? {};
      let changed = false;
      const next = { ...all };
      for (const [id, state] of Object.entries(all)) {
        if (state.version !== 1 || (!state.running && !state.tasks.some(task => [...ACTIVE, "merging"].includes(task.status)))) continue;
        const value = reduce(state, { type: "tick" });
        if (value !== state) { next[id] = value; changed = true; }
      }
      if (changed) setShared(STORE, next);
    });
  }
}
