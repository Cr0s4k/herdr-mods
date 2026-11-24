export const ITEMS = "watchers.items";
export const ANNOUNCED = "watchers.announced";
export const ERROR = "watchers.error";

export const UNTIL = [
  ["review", "Review", "Approved, or changes requested"],
  ["checks", "Checks", "Its checks finish, passing or failing"],
  ["ready", "Ready", "Approved, checks passed and no conflicts; also tells you what blocks it"],
  ["merged", "Merged", "It is merged or closed"],
  ["comment", "Comment", "Someone comments or reviews"],
];
const WAITS = {
  review: "a review", checks: "its checks to finish", ready: "it to be ready to merge",
  merged: "the merge", comment: "a new comment", succeeds: "it to succeed", changes: "its output to change",
};

export const active = items => (items ?? []).filter(item => !item.fired);
export const unannounced = (items, announced) => (items ?? []).filter(item => item.fired && !(announced ?? []).includes(item.id));

export function repoOf(url) {
  return /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url ?? "")?.[1] ?? null;
}

export function heading(item) {
  if (item.kind === "command") return item.name;
  return item.number ? `#${item.number} ${item.title ?? ""}`.trim() : `Pull request ${item.ref ?? ""}`.trim();
}

export function origin(item) {
  const folder = (item.cwd ?? "").replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  return item.kind === "pr" ? repoOf(item.ref) ?? folder : folder;
}

const tidy = path => (path ?? "").replace(/\\/g, "/").replace(/\/$/, "");
const within = (a, b) => Boolean(a && b) && (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`));

// Watchers under the space whose folders hold them, the shown space first; the rest under their folder's name.
export function bySpace(items, spaceList, paneList) {
  const places = spaceList.filter(space => !space.machine).map(space => {
    const tabs = new Set((space.tabs ?? []).map(tab => tab.id));
    return { space, folders: [space.folder, ...paneList.filter(pane => tabs.has(pane.tab)).map(pane => pane.cwd)].filter(Boolean).map(tidy) };
  });
  const rank = (place, cwd) => place.folders.includes(cwd) ? (place.space.active ? 0 : 1)
    : place.folders.some(folder => within(cwd, folder)) ? (place.space.active ? 2 : 3) : 4;
  const groups = new Map();
  for (const item of items ?? []) {
    const cwd = tidy(item.cwd), place = [...places].sort((a, b) => rank(a, cwd) - rank(b, cwd))[0];
    const owner = place && rank(place, cwd) < 4 ? place.space : null;
    const key = owner ? `space-${owner.id}` : `folder-${cwd}`;
    if (!groups.has(key)) groups.set(key, { key, name: owner?.name ?? (cwd.split("/").pop() || "Elsewhere"), current: Boolean(owner?.active), items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()].map(group => ({ ...group, items: [...active(group.items), ...group.items.filter(item => item.fired)] }))
    .sort((a, b) => b.current - a.current || a.name.localeCompare(b.name));
}

// A follow-up message is typed into a terminal, so only an agent gets one: the focused one, or the tab's only one.
export function tellTarget(agentList, focus, tab) {
  const here = (agentList ?? []).filter(agent => agent.tab === tab);
  return here.find(agent => agent.address === focus?.terminal) ?? (here.length === 1 ? here[0] : null);
}

export const waitingFor = item => `Waiting for ${WAITS[item.until] ?? item.until}`;

// [text, theme color name] lines of what was read last.
export function facts(item) {
  const state = item.state;
  if (!state) return [];
  if (item.kind === "command") {
    const last = (state.output || state.errors || "").split("\n").pop().slice(0, 160);
    return [[state.code === 0 ? "Exits 0" : `Exits ${state.code}`, state.code === 0 ? "ansi2" : "muted"], ...(last ? [[last, "muted"]] : [])];
  }
  const review = {
    approved: ["Approved", "ansi2"], changes_requested: ["Changes requested", "blocked"],
    required: ["Review required", "muted"], none: ["No review yet", "muted"],
  }[state.review?.state] ?? ["No review yet", "muted"];
  const by = state.review?.by?.length ? ` by ${state.review.by.join(", ")}` : "";
  const { passed = 0, failed = [], pending = 0 } = state.checks ?? {};
  const total = passed + failed.length + pending;
  const checks = !total ? ["No checks", "muted"]
    : failed.length ? [`${failed.length} of ${total} checks failed: ${failed.slice(0, 3).join(", ")}`, "blocked"]
    : pending ? [`Checks running, ${passed} of ${total} passed`, "working"]
    : [`${total} ${total === 1 ? "check" : "checks"} passed`, "ansi2"];
  const rows = [[review[0] + by, review[1]], checks];
  if (state.draft) rows.push(["Draft", "muted"]);
  if (state.mergeable === "CONFLICTING") rows.push(["Has conflicts", "blocked"]);
  return rows;
}

export function ago(at, now) {
  if (!at) return "not yet";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}
