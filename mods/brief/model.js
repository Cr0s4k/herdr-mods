// Shared by the always-mounted tracker and the panel. Read receipts acknowledge
// concrete records, so a delayed report cannot disappear behind a time cutoff.
export const ACTIVITY = "brief.activity";
export const REPORTS = "brief.reports";
export const receipt = space => `brief.read.${space}`;
export const entriesFor = (space, events, reports) => [...events, ...reports]
  .filter(item => item.space === space)
  .sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
export const unreadFor = (items, read) => {
  const ids = new Set(read ?? []);
  return items.filter(item => !ids.has(item.id));
};

export function observe(previous, agents, time) {
  const events = [];
  const next = {};
  for (const agent of agents) {
    const key = `${agent.space}:${agent.address}`;
    const old = previous[key];
    next[key] = { status: agent.status, app: agent.app };
    // First observation is a baseline. Unknown/disappeared agents aren't done.
    if (!old || old.app !== agent.app || old.status === agent.status) continue;
    const blocked = agent.status === "blocked";
    const finished = old.status === "working" && ["done", "idle"].includes(agent.status);
    if (!blocked && !finished) continue;
    events.push({ id: `activity-${key}-${time}-${agent.seq}`, space: agent.space,
      terminal: agent.address, time, kind: blocked ? "blocked" : "finished",
      title: agent.title || agent.program?.name || "Agent",
      summary: blocked ? "Agent requested input." : "Agent finished a turn.", source: "observed" });
  }
  return { next, events };
}
