import { shared, setShared, notify, panes, focused, agents, terminals, spaces, run, exec, hc, readTextFile, appHome, knownAgents } from "herdr";
import { STORE, MOVING, reduce, migrate, agentOpening } from "./pipeline-model.js";
import { LiveRunner, prompt, openTry } from "./pipeline-live.js";
import { loadProcedures } from "./procedures.js";
import { readTickets, fullTickets, ticketBlockers, updateTicket } from "./ticket-source.js";

const watching = () => panes().find(pane => pane.pane === focused()?.pane)?.mod === "pipeline";
const scripts = {};
loadProcedures(path => readTextFile(`${appHome()}/${path}`)).catch(() => null);
async function python(file, context, payload, timeout = 120000) {
  scripts[file] ??= await readTextFile(`${appHome()}/mods/${file}`);
  if (!scripts[file]) throw new Error("A Pipeline helper is missing. Reinstall the mods.");
  const result = await exec("python3", ["-c", scripts[file], JSON.stringify(payload)], { cwd: context.cwd, on: context.on, timeout });
  let response;
  try { response = JSON.parse(result.stdout); }
  catch { throw new Error("Pipeline could not run Git there. Check Python 3 and Git on that machine."); }
  if (result.code !== 0 || response.error) throw new Error(response.error || "Git failed.");
  return response.data;
}

function openAgent(context, opening, name, space) {
  const before = focused(), inSpace = space && spaces().some(row => row.id === space);
  if (inSpace) run("tab.new", { ...opening, space, name });
  else run("space.new", { ...opening, machine: context.on || "", tab: name });
  // Keep the person's place while agents open in the background.
  try {
    if (before?.space && spaces().some(row => row.id === before.space)) {
      run("space.select", { id: before.space });
      if (before.tab) run("tab.select", { id: before.tab });
      if (before.pane) run("pane.focus", { pane: before.pane });
    }
  } catch { /* The agent started even if the previous view disappeared. */ }
  return inSpace ? "tab" : "space";
}

export const liveHost = {
  shared, setShared, agents, terminals, panes, run, now: () => Date.now(),
  announce: (_id, notice) => { if (!watching()) notify({ title: notice.title, body: notice.body, level: notice.level, action: { name: "tabs-show.pipeline" } }); },
  shown: () => { const at = focused(); return at ? { space: at.space, viewing: panes().some(pane => pane.mod === "pipeline" && pane.tab === at.tab) } : null; },
  knownAgents: context => knownAgents({ on: context.on }),
  tickets: readTickets, describe: fullTickets, blockers: ticketBlockers, updateTicket,
  read: async terminal => { const result = await hc(["read", terminal, "--lines", "40"]); return result.code === 0 ? result.stdout : ""; },
  worktree: (context, payload) => python("linear/worktrees.py", context, { ...payload, cwd: context.cwd }),
  delivery: (context, payload) => python("pipeline/delivery.py", context, payload),
  usage: (context, cwds) => python("pipeline/usage.py", context, { cwds }),
  changed: (context, repos) => python("pipeline/delivery.py", context, { op: "changed", repos }),
  // Only folders Pipeline made for a task's images are ever deleted.
  forget: folders => { const safe = folders.filter(folder => folder.startsWith(`${appHome()}/pipeline-images/`) && !folder.includes("..")); return safe.length ? exec("rm", ["-rf", "--", ...safe]) : null; },
  limits: context => python("pipeline/limits.py", context, {}, 30000),
  // A watched plan runs in a tab of its own, so you see what it reads; the runner waits for its result file.
  async plan(context, job) {
    if (!job.watch) return python("pipeline/planner.py", context, { ...job, cwd: context.cwd }, 320000);
    scripts["pipeline/planner.py"] ??= await readTextFile(`${appHome()}/mods/pipeline/planner.py`);
    const out = `/tmp/herdr-pipeline-plan-${Date.now()}`, opening = { folder: context.cwd, argv: ["python3", "-c", scripts["pipeline/planner.py"], JSON.stringify({ ...job, cwd: context.cwd, out })] };
    if (job.space && spaces().some(row => row.id === job.space)) run("tab.new", { ...opening, space: job.space, name: "Planner" });
    else run("space.new", { ...opening, machine: context.on || "", tab: "Planner" });
    const waited = await exec("sh", ["-c", 'i=0; while [ ! -s "$1/result.json" ] && [ $i -lt 320 ]; do sleep 1; i=$((i+1)); done; cat "$1/result.json" && rm -rf "$1"', "sh", out], { on: context.on, timeout: 330000 });
    try { return JSON.parse(waited.stdout); } catch { throw new Error("The planner's tab closed before it gave a plan."); }
  },
  send: async (terminal, text) => { const result = await hc(["send", terminal, text]); if (result.code !== 0) throw new Error(result.stderr); },
  async check(context, cwd, command) {
    try {
      const result = await exec("sh", ["-c", command], { cwd, on: context.on, timeout: 600000 });
      return { code: result.code, output: [result.stdout, result.stderr].map(part => (part ?? "").trimEnd()).filter(Boolean).join("\n") };
    } catch (error) {
      return { code: -1, output: /timeout|timed out/i.test(String(error)) ? "The command ran longer than 10 minutes and was stopped." : String(error?.message ?? error) };
    }
  },
  keys: async (terminal, keys) => { const result = await hc(["keys", terminal, ...keys]); if (result.code !== 0) throw new Error(result.stderr); },
  start(context, task, workspaces, agent, space, delivery, extras) {
    return openAgent(context, { folder: workspaces[0].cwd, ...agentOpening(agent, prompt(task, workspaces, delivery, extras)) }, task.id, space);
  },
  resume: (context, task, ws, argv, space) => openAgent(context, { folder: ws.cwd, argv }, task.id, space),
  tryout: (context, task, ws, command, cx) => openTry({ run, panes, spaces, focused }, context, task, ws, command, cx, true),
  async locate(context, workspace, cx, previous) {
    for (let i = 0; i < 60; i++) {
      const pane = panes().find(row => row.terminal && ![previous].flat().includes(row.terminal) && row.cwd === workspace.cwd);
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
    if (!asking.length || watching()) return;
    for (const task of asking) notify({ title: `${task.id} needs your input`, body: task.question?.text, level: "warning", action: { name: "tabs-show.pipeline" } });
  }
}
