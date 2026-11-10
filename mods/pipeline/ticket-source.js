import { appHome, exec, readTextFile } from "herdr";
import { SOURCES, openIssue } from "./pipeline-model.js";

const scripts = {};
const PRIORITY_NAMES = { 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" };
const linearTicket = issue => ({ ...issue, identifier: issue.id, uuid: issue.uuid || issue.id,
  status: typeof issue.status === "string" ? issue.status : issue.status?.name ?? "Unknown",
  priority: { name: issue.priority?.name ?? PRIORITY_NAMES[issue.priority] ?? "No priority" } });

// Tracker access stays on this computer, even for a project on another machine.
export async function readTickets(provider, payload) {
  const service = SOURCES[provider];
  if (!service) throw new Error("Pipeline can't read that tracker.");
  scripts[provider] ??= await readTextFile(`${appHome()}/mods/${provider}/herdr-${provider}`);
  if (!scripts[provider]) throw new Error(`The ${service} reader is missing. Reinstall the mods.`);
  const result = await exec("python3", ["-c", scripts[provider], "--home", appHome(), "request", JSON.stringify(payload)], { timeout: 120000 });
  let response;
  try { response = JSON.parse(result.stdout); }
  catch { throw new Error(`Cannot read ${service}. Check Python 3 on this computer.`); }
  if (response.error || result.code !== 0) {
    const error = new Error(response.error || `Cannot load ${service}.`);
    error.kind = response.kind;
    throw error;
  }
  const data = response.data ?? {};
  return provider === "linear" && Array.isArray(data.issues) ? { ...data, issues: data.issues.map(linearTicket) } : data;
}

// Linear lists cut descriptions short, so tickets about to be queued are read in full.
export async function fullTickets(provider, issues) {
  if (!issues.length) return issues;
  let list = issues;
  if (provider === "linear") {
    const full = new Map((await readTickets("linear", { op: "details", ids: issues.slice(0, 10).map(issue => issue.uuid) })).issues.map(issue => [issue.uuid, issue]));
    list = issues.slice(0, 10).map(issue => ({ ...issue, ...full.get(issue.uuid) })).filter(issue => full.has(issue.uuid));
  }
  const blockers = await ticketBlockers(provider, list);
  return list.map(issue => ({ ...issue, blockers: blockers.get(issue.uuid) ?? [] }));
}

async function chunked(ids, read) {
  const rows = [];
  for (let i = 0; i < ids.length; i += 10) rows.push(...await read(ids.slice(i, i + 10)));
  return rows;
}

// What each ticket is blocked by, and whether that ticket is closed (null when it can't be read).
export async function ticketBlockers(provider, issues) {
  if (!issues.length) return new Map();
  if (provider === "plane") {
    const found = await chunked(issues.map(issue => issue.uuid), async ids => Object.entries((await readTickets("plane", { op: "blockers", ids })).blockers ?? {}));
    return new Map(found);
  }
  const listed = issues.every(issue => issue.relations) ? issues
    : await chunked(issues.map(issue => issue.uuid), async ids => (await readTickets("linear", { op: "details", ids })).issues);
  const keys = [...new Set(listed.flatMap(issue => (issue.relations?.blockedBy ?? []).map(blocker => blocker.identifier || blocker.id)).filter(Boolean))].slice(0, 30);
  const known = new Map((await chunked(keys, async ids => (await readTickets("linear", { op: "details", ids })).issues)).map(issue => [issue.identifier, issue]));
  return new Map(listed.map(issue => [issue.uuid, (issue.relations?.blockedBy ?? []).map(blocker => {
    const key = blocker.identifier || blocker.id, found = known.get(key);
    return { key: key ?? null, uuid: found?.uuid ?? null, title: found?.title ?? blocker.title ?? "", url: found?.url ?? null, closed: found ? !openIssue(found) : null };
  })]));
}
