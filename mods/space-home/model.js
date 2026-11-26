export const MOD = "space-home";
const RETRY = 3000;

export function homeTabs(space, panes) {
  const mine = new Map(panes.filter(p => p.mod === MOD).map(p => [p.tab, p.pane]));
  return (space?.tabs ?? []).filter(tab => mine.has(tab.id)).map(tab => ({ ...tab, pane: mine.get(tab.id) }));
}
export const homeTab = (space, panes) => homeTabs(space, panes)[0] ?? null;

// The commands that give every space one Home tab, first in its tab bar. Switched off, a Home goes
// wherever its space has another tab: closing a space's last tab would close the space.
// `asked`: space -> when it was last sent commands, so one that a machine refuses isn't repeated on every render.
export function upkeep(spaces, panes, { on = true, asked = {}, now = Date.now() } = {}) {
  const loaded = new Set(panes.map(p => p.tab)), commands = [];
  for (const space of spaces) {
    const tabs = space.tabs ?? [];
    if (!tabs.length || !tabs.every(tab => loaded.has(tab.id)) || now - (asked[space.id] ?? -Infinity) < RETRY) continue;
    const homes = homeTabs(space, panes), close = tab => ["tab.close", { id: tab.id, confirmed: true }];
    const wanted = !on ? (tabs.length > homes.length ? homes.map(close) : [])
      : !homes.length ? [["tab.new", { space: space.id, name: "Home", mod: MOD, props: { space: space.id }, focus: false }]]
      : [...homes.slice(1).map(close), ...(tabs[0].id === homes[0].id ? [] : [["tab.move", { id: homes[0].id, index: 1 }]])];
    if (wanted.length) { asked[space.id] = now; commands.push(...wanted); }
  }
  return commands;
}

const clean = s => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// The name the sidebar gives an agent: its tab's when someone named it, else what it says it is doing.
export function agentName(agent, tab, pane) {
  const raw = (pane?.title || agent.title || "").trim(), live = clean(raw);
  const telling = live && live !== agent.program?.name && live.toLowerCase() !== agent.program?.key
    && !/^[~/]|^[A-Za-z]:\\/.test(raw) && !/^\d+$/.test(live) && !live.includes("@");
  return tab?.named ? tab.name : telling ? live : agent.program?.name || agent.app || "Agent";
}

const STAGES = { routing: "Starting", working: "Working", input: "Needs you", testing: "Checks", review: "Review", merging: "Merging", pr: "PR open", queued: "Queued" };
const ORDER = ["input", "failed", "review", "pr", "merging", "testing", "working", "routing", "queued"];
const WAITING = ["input", "failed", "review"];
export const stage = task => task.status === "failed" ? (task.reason === "checks" ? "Checks failed" : "Stopped") : STAGES[task.status] ?? task.status;

// What Home lists, most urgent first. Each row is one place to go: a task its agent's row already speaks for is listed
// again only when it waits for you, since that row goes to Pipeline and not to the terminal.
export function sections({ space, panes, agents, terminals = [], pipeline = null, briefs = [], sessions = null }) {
  const tabs = new Map((space.tabs ?? []).map(tab => [tab.id, tab])), byPane = new Map(panes.map(p => [p.pane, p]));
  const said = new Map();
  for (const brief of briefs) if (brief.space === space.id && brief.terminal && !(said.get(brief.terminal)?.time > brief.time)) said.set(brief.terminal, brief);
  const tasks = (pipeline?.state?.tasks ?? []).filter(task => task.status !== "done" && !task.discard);
  const owned = new Map(tasks.filter(task => task.terminal).map(task => [task.terminal, task]));
  const agentRows = agents.filter(a => a.space === space.id).map(a => {
    const pane = byPane.get(a.pane), task = owned.get(a.address) ?? null;
    return { kind: "agent", key: `agent:${a.address}`, agent: a, status: a.status, name: agentName(a, tabs.get(a.tab), pane),
      detail: task?.title ?? said.get(a.address)?.title ?? null, cwd: pane?.cwd ?? null, branch: pane?.branch ?? null, stage: task ? stage(task) : null };
  });
  const needs = a => a.status === "blocked" || a.status === "done";
  const asking = new Set(agentRows.filter(needs).map(row => row.agent.address)), open = new Set(agentRows.map(row => row.agent.address));
  const taskRows = tasks.map(task => ({ kind: "task", key: `task:${task.id}`, task, name: task.title, stage: stage(task), failed: task.status === "failed",
    waiting: WAITING.includes(task.status) })).sort((a, b) => ORDER.indexOf(a.task.status) - ORDER.indexOf(b.task.status));
  const rank = { blocked: 0, done: 1, working: 2, idle: 3 };
  const byStatus = (a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4);
  const out = [
    { id: "needs", title: "Needs you", rows: [...agentRows.filter(needs).sort(byStatus), ...taskRows.filter(row => row.waiting && !asking.has(row.task.terminal))] },
    { id: "agents", title: "Agents", rows: agentRows.filter(row => !needs(row)).sort(byStatus) },
    { id: "pipeline", title: "Pipeline", rows: pipeline ? [{ kind: "pipeline", key: "pipeline", pipeline }, ...taskRows.filter(row => !row.waiting && !open.has(row.task.terminal))] : [] },
    { id: "terminals", title: "Terminals and tabs", rows: [
      ...terminals.map(term => ({ kind: "terminal", key: `term:${term.p.pane}`, term })),
      ...panes.filter(p => p.mod && p.mod !== MOD && p.mod !== "pipeline" && tabs.has(p.tab))
        .map(p => ({ kind: "pane", key: `pane:${p.pane}`, pane: p, name: p.name || (tabs.get(p.tab).named ? tabs.get(p.tab).name : p.title) })),
    ] },
    { id: "recent", title: "Recent conversations", rows: (sessions ?? []).map(session => ({ kind: "session", key: `session:${session.id}`, session })) },
  ];
  return out.filter(section => section.rows.length);
}

export function summary(parts) {
  const count = id => parts.find(section => section.id === id)?.rows ?? [];
  const working = count("agents").filter(row => row.status === "working").length, needs = count("needs").length;
  return [needs && `${needs} ${needs === 1 ? "needs" : "need"} you`, working && `${working} working`].filter(Boolean).join(" · ");
}
