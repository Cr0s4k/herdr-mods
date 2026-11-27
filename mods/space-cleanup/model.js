import { MOD as HOME, agentName } from "./home-model.js";

export const USED = "cleanup.used";
export const IDLE = 3600000, DAY = 86400000;
const STEP = 60000, KEPT = 400;
const KEEP = new Set([HOME, "pipeline"]);
const key = p => p.terminal ?? p.pane;
const base = path => path.replace(/\/+$/, "").split("/").pop() || "/";

export function ago(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
}

// When each terminal (by address) and panel (by pane) was last in use: on screen with Herdr in front, or its agent working or asking.
export function touchUse(used, spaces, panes, now, front) {
  const shown = new Set(front ? spaces.filter(s => s.active).flatMap(s => (s.tabs ?? []).filter(tab => tab.active).map(tab => tab.id)) : []);
  const ids = new Set(panes.map(key));
  const drop = Object.keys(used).length > KEPT;
  const next = drop ? Object.fromEntries(Object.entries(used).filter(([id]) => ids.has(id))) : { ...used };
  let changed = drop && Object.keys(next).length !== Object.keys(used).length;
  for (const p of panes) {
    if (!shown.has(p.tab) && p.status !== "working" && p.status !== "blocked") continue;
    if (typeof next[key(p)] === "number" && now - next[key(p)] < STEP) continue;
    next[key(p)] = now;
    changed = true;
  }
  return changed ? next : used;
}

// Terminals a Pipeline task has: an unfinished one's are its own; a merged one's are left over.
export function owners(all) {
  const found = new Map();
  for (const state of Object.values(all ?? {})) {
    if (!state?.live) continue;
    for (const task of state.tasks ?? []) for (const address of [task.terminal, task.adopt?.terminal]) {
      if (!address || task.discard) continue;
      const done = task.status === "done";
      if (!found.has(address) || !done) found.set(address, { id: task.id, done });
    }
  }
  return found;
}

function judge({ p, tab, agent, task, last, now }) {
  const idle = last ? now - last : null;
  if (p.mod) return KEEP.has(p.mod) || idle === null || idle < DAY ? null : { kind: "panel", why: `not opened for ${ago(idle)}`, tick: true };
  if (task && !task.done) return null;
  if (agent) {
    if (agent.status === "working" || agent.status === "blocked") return null;
    if (task?.done) return { kind: "agent", why: `its Pipeline task ${task.id} is merged`, tick: true };
    if (idle === null || idle < IDLE) return null;
    if (agent.status === "done") return { kind: "agent", why: `finished ${ago(idle)} ago, reply not read`, tick: false };
    return { kind: "agent", why: `idle for ${ago(idle)}`, tick: true };
  }
  if (p.program && !p.program.shell) return idle === null || idle < DAY ? null : { kind: "program", why: `runs ${p.program.name}, untouched for ${ago(idle)}`, tick: false };
  return idle === null || idle < IDLE ? null : { kind: "shell", why: `at its prompt for ${ago(idle)}`, tick: !tab.named };
}

// What could close in each space, oldest first; the spaces themselves stay. A space without a Home tab
// keeps the tab used last when everything else in it would go, since closing its last tab closes it.
export function suggest({ spaces, panes, agents, terminals = [], pipelines = {}, used = {}, focused = null, only = null, now = Date.now() }) {
  const tasks = owners(pipelines), born = new Map(terminals.map(t => [t.address, t.created_ms]));
  const byPane = new Map(agents.map(a => [a.pane, a]));
  return spaces.filter(space => !only || space.id === only).map(space => {
    const tabs = new Map((space.tabs ?? []).map(tab => [tab.id, tab]));
    const mine = panes.filter(p => tabs.has(p.tab));
    const rows = mine.flatMap(p => {
      if (p.pane === focused) return [];
      const tab = tabs.get(p.tab), agent = byPane.get(p.pane) ?? null;
      const last = Math.max(used[key(p)] ?? 0, tab.changed_at ?? 0) || (p.terminal ? born.get(p.terminal) : null) || null;
      const verdict = judge({ p, tab, agent, task: p.terminal ? tasks.get(p.terminal) : null, last, now });
      if (!verdict) return [];
      const name = agent ? agentName(agent, tab, p) : p.mod ? p.name || (tab.named ? tab.name : p.title) : tab.named ? tab.name : p.cwd ? base(p.cwd) : p.program?.name || "Terminal";
      return [{ ...verdict, key: `${space.id}:${p.pane}`, pane: p.pane, terminal: p.terminal ?? null, tab: p.tab, name, program: p.program ?? null, cwd: p.cwd ?? null, branch: p.branch ?? null,
        idle: last ? now - last : null, hold: null }];
    });
    const named = new Map();
    for (const row of rows) named.set(row.name, (named.get(row.name) ?? 0) + 1);
    const twins = rows.map(row => named.get(row.name) > 1 && rows.some(other => other !== row && other.name === row.name && other.tab === row.tab));
    rows.forEach((row, n) => { if (named.get(row.name) > 1) row.name += ` · ${twins[n] ? row.terminal ?? row.pane : space.tabs.findIndex(tab => tab.id === row.tab) + 1}`; });
    const home = mine.some(p => p.mod === HOME);
    const going = new Set(rows.map(row => row.pane));
    if (!home && rows.length && mine.every(p => going.has(p.pane))) {
      const kept = rows.reduce((a, b) => (b.idle ?? Infinity) < (a.idle ?? Infinity) ? b : a).tab;
      for (const row of rows) if (row.tab === kept) Object.assign(row, { hold: "keeps the space open", tick: false });
    }
    rows.sort((a, b) => (b.idle ?? 0) - (a.idle ?? 0));
    return { space, rows };
  }).filter(group => group.rows.length);
}
