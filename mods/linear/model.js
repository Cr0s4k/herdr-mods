export { contextFor } from "./context.js";
import { procedure } from "./procedures.js";

export const issueKey = issue => issue.identifier || issue.id;
export const issueId = issue => issue.uuid || issue.id;
export const priorityName = issue => issue.priority?.name || ({ 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" }[issue.priority] ?? "No priority");
export const statusName = issue => typeof issue.status === "string" ? issue.status : issue.status?.name || "Unknown";
export const assigneeName = issue => typeof issue.assignee === "string" ? issue.assignee : issue.assignee?.name || "Unassigned";
export const projectName = issue => typeof issue.project === "string" ? issue.project : issue.project?.name || "No project";
export const statusColor = issue => ({ started: "working", completed: "done", canceled: "dim", duplicate: "dim" }[issue.statusType] ?? "muted");

// Linear exports disclosure blocks as >>> Summary ... >>>, not HTML <details>.
// Keep ordinary Markdown and fenced examples intact, including incomplete blocks.
export function descriptionBlocks(markdown) {
  const lines = String(markdown || "No description provided.").split(/\r?\n/);
  function parse(start, nested = false, depth = 0) {
    const blocks = []; let text = [], fence = null;
    const flush = () => { if (text.join("\n").trim()) blocks.push({ kind: "markdown", text: text.join("\n"), id: `text-${start}-${blocks.length}` }); text = []; };
    for (let i = start; i < lines.length; i++) {
      const delimiter = lines[i].match(/^ {0,3}(`{3,}|~{3,})/);
      if (delimiter) {
        if (!fence) fence = delimiter[1];
        else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = null;
        text.push(lines[i]); continue;
      }
      const marker = !fence && lines[i].match(/^ {0,3}>>>[ \t]*(.*)$/);
      if (marker && !marker[1].trim() && nested) { flush(); return { blocks, end: i, closed: true }; }
      if (marker && marker[1].trim() && depth < 32) {
        const inner = parse(i + 1, true, depth + 1);
        if (!inner.closed) { text.push(...lines.slice(i)); break; }
        flush();
        blocks.push({ kind: "details", id: `details-${i}`, title: marker[1].trim(), blocks: inner.blocks });
        i = inner.end;
      } else text.push(lines[i]);
    }
    flush(); return { blocks, end: lines.length, closed: false };
  }
  return parse(0).blocks;
}

export function taskFor(issue, note = "") {
  const source = issue.provider === "plane" ? "Plane" : "Linear";
  const relation = issue.relations;
  const blockers = relation?.blockedBy?.map(item => `${item.identifier || item.id}: ${item.title || ""}`).join("\n");
  return [`Work on ${source} ticket ${issueKey(issue)}: ${issue.title}`, issue.url,
    `Status: ${statusName(issue)} · Priority: ${priorityName(issue)} · Project: ${projectName(issue)}`,
    "Ticket description:", issue.description || "No description provided.",
    blockers ? `Blocked by:\n${blockers}` : null,
    note.trim() ? `Additional instructions:\n${note.trim()}` : null,
    procedure("ticket-launch", { ticket: procedure("ticket", { service: source, owner: " unless I ask" }) }),
  ].filter(Boolean).join("\n\n");
}

export function targetsFor(agentList, context) {
  return agentList.filter(agent => agent.space === context.space && agent.status === "idle");
}

export function startArgs(issue, agent, context, note = "") {
  if (!context.space || !context.cwd || !agent?.installed || !agent.run?.length) return null;
  return { name: issueKey(issue), space: context.space, folder: context.cwd, argv: agent.run, task: taskFor(issue, note) };
}
