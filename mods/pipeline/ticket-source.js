import { appHome, exec, readTextFile } from "herdr";
import { SOURCES } from "./pipeline-model.js";

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
  if (provider !== "linear" || !issues.length) return issues;
  const full = new Map((await readTickets("linear", { op: "details", ids: issues.slice(0, 10).map(issue => issue.uuid) })).issues.map(issue => [issue.uuid, issue]));
  return issues.slice(0, 10).map(issue => ({ ...issue, ...full.get(issue.uuid) })).filter(issue => full.has(issue.uuid));
}
