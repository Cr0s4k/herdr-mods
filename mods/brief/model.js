// Shared by the always-mounted tracker and the panel. Read receipts acknowledge
// concrete records, so a delayed report cannot disappear behind a time cutoff.
export const ACTIVITY = "brief.activity";
export const REPORTS = "brief.reports";
export const receipt = space => `brief.read.${space}`;
// Old activity and housekeeping reports remain available in History, but don't
// compete with results or inflate the toolbar's unread count.
export const isRoutine = item => item.kind === "finished" || (
  item.source === "agent" && !item.questions?.length && !item.caveats?.length &&
  /\b(?:committed|pushed)\b/i.test(item.title ?? "") &&
  /^(?:pushed|committed)\s+[a-f\d]{7,40}\b/i.test(item.summary ?? "") &&
  !/\b(?:fail(?:ed|ure|ures|ing|s)?|error|blocked|conflict|rejected)\b/i.test(
    [item.title, item.summary, ...(item.changes ?? []), ...(item.tests ?? [])].join(" "))
);
export const entriesFor = (space, events, reports, includeRoutine = false) => [...events, ...reports]
  .filter(item => item.space === space && (includeRoutine || !isRoutine(item)))
  .sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
export const unreadFor = (items, read) => {
  const ids = new Set(read ?? []);
  return items.filter(item => !ids.has(item.id));
};

// A turn this long that ends while nobody is looking gets a brief from the agent's last reply, unless the agent left its own.
export const LONG = 60000;
const busy = status => status === "working" || status === "blocked";

// Pipeline reports on its own tasks.
export function pipelineOwns(all, terminal) {
  return Object.values(all ?? {}).some(state => state?.live && (state.tasks ?? []).some(task => task.terminal === terminal && task.status !== "done" && !task.discard));
}

export function observe(previous, agents, time) {
  const events = [], finished = [];
  const next = {};
  for (const agent of agents) {
    const key = `${agent.space}:${agent.address}`;
    const old = previous[key];
    const since = busy(agent.status) ? (old && old.app === agent.app && old.since) || time : null;
    next[key] = { status: agent.status, app: agent.app, since };
    // First observation is a baseline. Unknown/disappeared agents aren't done.
    if (!old || old.app !== agent.app || old.status === agent.status) continue;
    // "done" is Herdr's word for finished while you weren't looking; a turn you watched end goes to "idle".
    if (agent.status === "done" && old.since && time - old.since >= LONG) {
      finished.push({ space: agent.space, terminal: agent.address, title: agent.title || agent.program?.name || "Agent", agent: agent.program?.key ?? null, since: old.since, time });
    }
    const blocked = agent.status === "blocked";
    if (!blocked) continue;
    events.push({ id: `activity-${key}-${time}-${agent.seq}`, space: agent.space,
      terminal: agent.address, time, kind: "blocked",
      title: agent.title || agent.program?.name || "Agent",
      summary: "Your agent is waiting for your input. Open the conversation to reply.", source: "observed" });
  }
  return { next, events, finished };
}
