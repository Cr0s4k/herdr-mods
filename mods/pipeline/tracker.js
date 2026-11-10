import { shared, setShared, notify, panes, focused, agents, terminals, spaces, run, exec, hc, readTextFile, appHome, knownAgents } from "herdr";
import { STORE, MOVING, reduce, migrate } from "./pipeline-model.js";
import { LiveRunner, prompt } from "./pipeline-live.js";
import { readTickets, fullTickets, ticketBlockers, updateTicket } from "./ticket-source.js";

const scripts = {};
async function python(file, context, payload) {
  scripts[file] ??= await readTextFile(`${appHome()}/mods/${file}`);
  if (!scripts[file]) throw new Error("A Pipeline helper is missing. Reinstall the mods.");
  const result = await exec("python3", ["-c", scripts[file], JSON.stringify(payload)], { cwd: context.cwd, on: context.on, timeout: 120000 });
  let response;
  try { response = JSON.parse(result.stdout); }
  catch { throw new Error("Pipeline could not run Git there. Check Python 3 and Git on that machine."); }
  if (result.code !== 0 || response.error) throw new Error(response.error || "Git failed.");
  return response.data;
}

export const liveHost = {
  shared, setShared, agents, terminals, panes, run, now: () => Date.now(),
  knownAgents: context => knownAgents({ on: context.on }),
  tickets: readTickets, describe: fullTickets, blockers: ticketBlockers, updateTicket,
  read: async terminal => { const result = await hc(["read", terminal, "--lines", "40"]); return result.code === 0 ? result.stdout : ""; },
  worktree: (context, payload) => python("linear/worktrees.py", context, { ...payload, cwd: context.cwd }),
  delivery: (context, payload) => python("pipeline/delivery.py", context, payload),
  send: async (terminal, text) => { const result = await hc(["send", terminal, text]); if (result.code !== 0) throw new Error(result.stderr); },
  async check(context, cwd, command) {
    try {
      const result = await exec("sh", ["-c", command], { cwd, on: context.on, timeout: 600000 });
      return { code: result.code, output: [result.stdout, result.stderr].map(part => (part ?? "").trimEnd()).filter(Boolean).join("\n") };
    } catch (error) {
      return { code: -1, output: /timeout|timed out/i.test(String(error)) ? "The check ran longer than 10 minutes and was stopped." : String(error?.message ?? error) };
    }
  },
  keys: async (terminal, keys) => { const result = await hc(["keys", terminal, ...keys]); if (result.code !== 0) throw new Error(result.stderr); },
  start(context, task, workspace, agent, space) {
    const before = focused(), inSpace = space && spaces().some(row => row.id === space);
    const opening = { folder: workspace.cwd, argv: agent.run, task: prompt(task, workspace) };
    if (inSpace) run("tab.new", { ...opening, space, name: task.id });
    else run("space.new", { ...opening, machine: context.on || "", tab: task.id });
    const own = inSpace ? "tab" : "space";
    // Keep the person's place while agents open in the background.
    try {
      if (before?.space && spaces().some(row => row.id === before.space)) {
        run("space.select", { id: before.space });
        if (before.tab) run("tab.select", { id: before.tab });
        if (before.pane) run("pane.focus", { pane: before.pane });
      }
    } catch { /* The agent started even if the previous view disappeared. */ }
    return own;
  },
  async locate(context, workspace, cx, previous) {
    for (let i = 0; i < 60; i++) {
      const pane = panes().find(row => row.terminal && row.terminal !== previous && row.cwd === workspace.cwd);
      const owner = pane && spaces().find(space => space.tabs.some(tab => tab.id === pane.tab));
      if (owner) return { space: owner.id, tab: pane.tab, terminal: pane.terminal };
      await cx.sleep(100);
    }
    return null;
  },
};

// Writes shared state only when a stage changes: every write redraws the whole window.
export class PipelineTracker {
  constructor(host = liveHost) { this.live = new LiveRunner(host); }

  start(cx) {
    this.last = null;
    this.live.start();
    cx.timer.every(1000, cx => {
      const now = Date.now(), all = shared(STORE) ?? {};
      const away = this.last === null ? Infinity : now - this.last;
      this.last = now;
      let changed = false;
      const next = { ...all };
      for (const [id, saved] of Object.entries(all)) {
        const state = migrate(saved, now);
        let value = state;
        if (!state?.live && state?.tasks?.some(task => MOVING.includes(task.status))) {
          const pause = away > 2500 ? Math.max(0, Math.min(away, now - state.lastTick) - 1000) : 0;
          value = reduce(state, { type: "tick", pause }, now);
        }
        if (value?.schedule) value = reduce(value, { type: "scheduleTick" }, now);
        if (value !== saved) { next[id] = value; changed = true; this.announce(saved, value); }
      }
      if (changed) setShared(STORE, next);
      this.live.step(cx);
    });
  }

  announce(before, after) {
    if (after.live) return;
    const was = new Map((before?.tasks ?? []).map(task => [task.id, task.status]));
    const asking = after.tasks.filter(task => task.status === "input" && was.get(task.id) !== "input");
    if (!asking.length || panes().find(pane => pane.pane === focused()?.pane)?.mod === "pipeline") return;
    for (const task of asking) notify({ title: `${task.id} needs your input`, body: task.question?.text, level: "warning", action: { name: "tabs-show.pipeline" } });
  }
}
