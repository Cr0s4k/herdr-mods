import { agents, terminals, appHome, exec, shared, setShared } from "herdr";
import { ACTIVITY, REPORTS, observe, pipelineOwns } from "./model.js";

export class BriefTracker {
  constructor() {
    this.previous = {};
    this.finished = [];
    this.busy = false;
  }

  start(cx) {
    cx.spawn(async cx => this.refresh(cx));
    cx.timer.every(10000, cx => { cx.spawn(async cx => this.refresh(cx)); });
  }

  observe() {
    const { next, events, finished } = observe(this.previous, agents(), Date.now());
    this.previous = next;
    for (const turn of finished) {
      if (shared("features")?.briefReplies === false || turn.terminal.includes("/") || pipelineOwns(shared("pipeline.prototype.v1"), turn.terminal)) continue;
      const process = terminals().find(t => t.address === turn.terminal);
      this.finished.push({ ...turn, pid: process?.foreground?.pid ?? null, cwd: process?.foreground?.cwd ?? process?.cwd ?? null });
    }
    if (events.length) setShared(ACTIVITY, [...(shared(ACTIVITY) ?? []), ...events].slice(-500));
  }

  async refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const turn of this.finished.splice(0)) await exec("python3", [`${appHome()}/mods/brief/herdr-brief`, "wrap", JSON.stringify(turn)]).catch(() => null);
      const result = await exec("python3", [`${appHome()}/mods/brief/herdr-brief`, "list"]);
      const data = JSON.parse(result.stdout);
      if (result.code !== 0 || !Array.isArray(data.items)) throw new Error(data.error || "Could not load handoffs.");
      if (JSON.stringify(shared(REPORTS)) !== JSON.stringify(data.items)) setShared(REPORTS, data.items);
      setShared("brief.error", data.warning || null);
    } catch (error) {
      setShared("brief.error", `Handoffs could not refresh. ${error.message || error} Previous updates are kept; retry in 10 seconds.`);
    } finally { this.busy = false; cx.notify(); }
  }
}
