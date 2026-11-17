import { appHome, readTextFile, exec, shared, setShared, spaces, panes, terminals, focused, run } from "herdr";

export const LAUNCHES = "linear.launches";
export const PENDING = ["queued", "creating", "starting"];
// OpenCode reads a last argument as its folder, so its first message goes in a flag instead of Herdr's task.
export const agentOpening = (agent, text) => agent.key === "opencode" ? { argv: [...agent.run, `--prompt=${text}`] } : { argv: agent.run, task: text };
let script;

export async function worktrees(context, payload) {
  script ??= await readTextFile(`${appHome()}/mods/linear/worktrees.py`);
  if (!script) throw new Error("The worktree helper is missing. Reinstall the mods.");
  const result = await exec("python3", ["-c", script, JSON.stringify({ ...payload, cwd: context.cwd })], { cwd: context.cwd, on: context.on });
  let response;
  try { response = JSON.parse(result.stdout); }
  catch { throw new Error("Cannot prepare worktrees. Check Python 3 and Git on the destination machine."); }
  if (result.code !== 0 || response.error) throw new Error(response.error || "Cannot prepare the worktree.");
  return response.data;
}

export function updateLaunch(id, apply) {
  const launches = shared(LAUNCHES) ?? [];
  setShared(LAUNCHES, launches.map(launch => launch.id === id ? apply(launch) : launch));
}

const liveSession = row => panes().some(pane => pane.terminal === row.terminal)
  || terminals().some(terminal => terminal.address === row.terminal && terminal.state === "live");

function checkAvailable(launch, launches, exceptId = null) {
  for (const previous of launches) {
    if (previous.id === exceptId) continue;
    if (previous.plan.common !== launch.plan.common || previous.context.on !== launch.context.on) continue;
    for (const row of previous.rows) {
      const live = row.status === "launched" && liveSession(row);
      if ((PENDING.includes(row.status) || row.status === "check" || live) && launch.rows.some(item => item.id === row.id)) {
        throw new Error(`${row.key} already has an active launch. Open Launches to check its agent.`);
      }
    }
  }
}

export function queueLaunch(launch) {
  const launches = shared(LAUNCHES) ?? [];
  if (launches.some(item => item.id === launch.id)) return;
  checkAvailable(launch, launches);
  // Retain every active launch and at most 20 completed launches.
  const active = launches.filter(item => item.rows.some(row => PENDING.includes(row.status) || row.status === "check" || (row.status === "launched" && liveSession(row))));
  const history = launches.filter(item => !active.includes(item)).slice(-20);
  setShared(LAUNCHES, [...history, ...active, launch]);
}

export function retryLaunch(id) {
  const launches = shared(LAUNCHES) ?? [], batch = launches.find(batch => batch.id === id);
  if (!batch) return;
  checkAvailable({ ...batch, rows: batch.rows.filter(row => row.status === "failed") }, launches, id);
  updateLaunch(id, value => ({ ...value, stop: false,
    rows: value.rows.map(row => row.status === "failed" ? { ...row, status: "queued", error: null } : row) }));
}

// Injected host keeps the queue testable without starting real agents.
export async function executeLaunch(id, host) {
  const change = (rowId, patch) => host.update(id, launch => ({ ...launch,
    rows: launch.rows.map(row => row.id === rowId ? { ...row, ...patch } : row) }));
  const initial = host.get(id);
  if (!initial) return;
  for (const original of initial.rows) {
    let batch = host.get(id), row = batch?.rows.find(item => item.id === original.id);
    if (!row || row.status !== "queued") continue;
    if (batch.stop) { change(row.id, { status: "stopped", error: "Not launched." }); continue; }
    try {
      let workspace = row.workspace;
      if (!workspace) {
        change(row.id, { status: "creating", error: null });
        workspace = await host.create(batch, row);
        change(row.id, { workspace });
      }
      batch = host.get(id);
      if (!batch) return;
      if (batch.stop) { change(row.id, { status: "stopped", error: "Stopped before agent launch; worktree kept." }); continue; }
      change(row.id, { status: "starting", error: null });
      // After the structural command is accepted, an uncertain result must never be retried automatically.
      host.start(batch, { ...row, workspace });
      try {
        const opened = await host.locate(batch, workspace);
        change(row.id, opened ? { ...opened, status: "launched" }
          : { status: "check", error: "Start requested. Check the new space before starting this ticket again." });
      } catch {
        change(row.id, { status: "check", error: "Start requested; its terminal could not be confirmed. Check the new space." });
      }
    } catch (error) {
      change(row.id, { status: "failed", error: error.message || String(error) });
    }
  }
}

export class LaunchTracker {
  start(cx) {
    this.owner = `${Date.now()}-${Math.random()}`;
    // Reload/restart cannot prove whether a start command reached the core. Never replay it.
    for (const batch of shared(LAUNCHES) ?? []) {
      if (batch.rows.some(row => PENDING.includes(row.status))) updateLaunch(batch.id, value => ({ ...value, owner: null,
        rows: value.rows.map(row => PENDING.includes(row.status) ? { ...row, status: "check",
          error: "Herdr reloaded during launch. Check its worktree and spaces before launching again." } : row) }));
    }
    cx.timer.every(400, cx => this.pump(cx));
  }

  pump(cx) {
    if (this.busy) return;
    const batch = (shared(LAUNCHES) ?? []).find(batch => batch.rows.some(row => row.status === "queued"));
    if (!batch) return;
    this.busy = true;
    const owner = this.owner;
    updateLaunch(batch.id, value => ({ ...value, owner }));
    cx.spawn(async cx => {
      try {
        await executeLaunch(batch.id, {
          get: id => (shared(LAUNCHES) ?? []).find(batch => batch.id === id && batch.owner === owner),
          update: (id, apply) => updateLaunch(id, value => value.owner === owner ? apply(value) : value),
          create: (batch, row) => worktrees(batch.context, { op: "create", plan: batch.plan, ticket: { id: row.id, key: row.key } }),
          start: (batch, row) => {
            const before = focused();
            run("space.new", { folder: row.workspace.cwd, machine: batch.context.on || "", tab: row.key,
              ...agentOpening(batch.agent, row.task + `\n\nWorking folder: ${row.workspace.cwd}\nBranch: ${row.workspace.branch}\nThis is an isolated worktree starting at ${batch.plan.base}.`) });
            // Keep the user's place while new worktree spaces open in the background.
            try {
              if (before?.space && spaces().some(space => space.id === before.space)) {
                run("space.select", { id: before.space });
                if (before.tab) run("tab.select", { id: before.tab });
                if (before.pane) run("pane.focus", { pane: before.pane });
              }
            } catch { /* Opening succeeded even if the previous view disappeared. */ }
          },
          locate: async (batch, workspace) => {
            for (let i = 0; i < 50; i++) {
              const space = spaces().find(space => (space.machine || null) === (batch.context.on || null) && space.folder === workspace.cwd);
              const tab = space?.tabs.find(tab => tab.active) ?? space?.tabs[0];
              const pane = tab && panes().find(pane => pane.tab === tab.id && pane.terminal);
              if (pane) return { space: space.id, tab: tab.id, terminal: pane.terminal };
              await cx.sleep(100);
            }
            return null;
          },
        });
      } finally { this.busy = false; cx.notify(); }
    });
  }
}
