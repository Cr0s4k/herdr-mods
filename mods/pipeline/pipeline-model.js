// A deterministic simulation. This module never starts agents, changes tickets or runs Git.
export const STORE = "pipeline.prototype.v1";
export const LIVE = "live:";
export const VERSION = 5;
// Pipelines saved before they were per space are keyed by machine and folder alone; one belongs to the space that started it.
export const pipelineId = (on, cwd, space) => JSON.stringify([on ?? null, cwd, space]);
export function spaceKey(all, on, cwd, space) {
  const own = LIVE + pipelineId(on, cwd, space), old = LIVE + JSON.stringify([on ?? null, cwd]);
  return all[own] ? own : all[old] && (all[old].space ?? space) === space ? old : null;
}
// A save from a newer Pipeline is left alone: another worktree may have installed an older one meanwhile.
export const newer = state => Number(state?.version) > VERSION;
export const SOURCES = { plane: "Plane", linear: "Linear" };
export const openIssue = issue => !["completed", "canceled", "duplicate"].includes(issue.statusType);
export const ACTIVE = ["routing", "working", "input", "testing"];
export const MOVING = ["routing", "working", "testing", "merging"];
export const DURATION = { routing: 2200, working: 9500, testing: 5500, merging: 3500 };
export const SPEEDS = [1, 2, 4];
export const REPOS = ["api", "web", "contracts", "docs"];
export const LABELS = { backlog: "Backlog", queued: "Queued", routing: "Entering pipeline", working: "Implementing", input: "Needs your input", testing: "Running checks", review: "Awaiting approval", merging: "Merging", done: "Done", failed: "Checks failed" };
export const LIVE_LABELS = { ...LABELS, routing: "Starting agent", working: "Working", input: "Needs you in its terminal", testing: "Running checks", review: "Ready for review", merging: "Merging", pr: "PR open", done: "Merged", failed: "Stopped" };
export const labelFor = (state, status) => (state.live ? LIVE_LABELS : LABELS)[status];
export const AGENT_OPTIONS = {
  claude: { models: ["fable", "opus", "sonnet", "haiku"], efforts: ["low", "medium", "high", "xhigh", "max"],
    flags: ({ model, effort }) => [...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : [])], dirs: paths => paths.map(path => `--add-dir=${path}`) },
  codex: { models: [], efforts: ["low", "medium", "high", "xhigh", "max"], open: true,
    flags: ({ model, effort }) => [...(model ? ["-m", model] : []), ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : [])], dirs: paths => paths.map(path => `--add-dir=${path}`) },
};
const effortFits = (options, effort) => options.efforts.includes(effort) || Boolean(options.open && /^[a-z]{1,20}$/.test(effort ?? ""));
export const tuningFor = (state, key) => {
  const tune = state?.tuning?.[key] ?? {}, options = AGENT_OPTIONS[key];
  return options ? { model: tune.model ?? null, effort: effortFits(options, tune.effort) ? tune.effort : null } : { model: null, effort: null };
};
export function codexModels(text) {
  let models;
  try { models = JSON.parse(text)?.models; } catch { return []; }
  return (Array.isArray(models) ? models : []).filter(model => model?.slug && model.visibility !== "hide")
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    .map(model => ({ slug: String(model.slug), name: String(model.display_name ?? model.slug),
      efforts: (model.supported_reasoning_levels ?? []).map(level => level?.effort).filter(effort => /^[a-z]{1,20}$/.test(effort ?? "")) }));
}
// A task's own model or effort wins over the agent's setting; what it leaves unset follows the setting.
export const taskTuning = (state, task, key) => {
  const tune = tuningFor(state, key), own = task?.tune ?? {}, options = AGENT_OPTIONS[key];
  return options ? { model: own.model ?? tune.model, effort: effortFits(options, own.effort) ? own.effort : tune.effort } : tune;
};
// Agents without a way to open more folders find the other worktrees in their first message.
export const agentRun = (state, agent, extra = [], task = null) => [...agent.run, ...(AGENT_OPTIONS[agent.key]?.flags(taskTuning(state, task, agent.key)) ?? []),
  ...(extra.length ? AGENT_OPTIONS[agent.key]?.dirs(extra) ?? [] : [])];
export const tuningLabel = tune => [tune?.model, tune?.effort && `${tune.effort} effort`].filter(Boolean).join(" · ");
export const CATALOG = [
  { id: "DEMO-101", title: "Define the checkout contract", repos: ["contracts", "api"], priority: 3, depends: [], column: "Ready", description: "Agree on request and response types, then update the API schema. The web checkout depends on this contract landing in both repositories." },
  { id: "DEMO-102", title: "Build the checkout endpoint", repos: ["api"], priority: 3, depends: ["DEMO-101"], column: "Ready", description: "Implement the checkout endpoint against the shared contract. Cover validation and idempotency before creating the pull request." },
  { id: "DEMO-103", title: "Connect the checkout screen", repos: ["web", "api"], priority: 2, depends: ["DEMO-102"], column: "Ready", description: "Connect the checkout form to the new endpoint and handle the success response across the web and API repositories.",
    question: { text: "When a card is declined, should checkout keep the cart or clear it?", options: ["Keep the cart", "Clear the cart"] } },
  { id: "DEMO-104", title: "Cover the empty cart state", repos: ["web"], priority: 2, depends: [], column: "Ready", description: "Add the empty cart screen, keyboard navigation and an accessible path back to browsing. This can run independently of the API work.",
    question: { text: "The empty cart can link back to the home page or to recently viewed products. Which should it show?", options: ["Home page", "Recently viewed products"] } },
  { id: "DEMO-105", title: "Document local development", repos: ["docs"], priority: 1, depends: [], column: "Ready", description: "Document how to run the repositories together and add a troubleshooting guide for local setup." },
  { id: "DEMO-106", title: "Add request tracing", repos: ["api"], priority: 2, depends: [], column: "Backlog", description: "Add request identifiers and structured tracing around checkout calls. Include tests for propagation between services.",
    question: { text: "Tracing every request adds about 2% latency. Trace all requests, or one in ten?", options: ["All requests", "One in ten"] } },
  { id: "DEMO-107", title: "Improve order confirmation", repos: ["web"], priority: 1, depends: ["DEMO-103"], column: "Backlog", description: "Show a useful order summary after checkout. Wait for the connected checkout screen to land first." },
  { id: "DEMO-108", title: "Refresh repository setup guides", repos: ["docs", "contracts"], priority: 1, depends: [], column: "Backlog", description: "Keep setup instructions and schema generation examples aligned across the documentation and contracts repositories." },
];
const EXAMPLES = [
  ["Rate limit the login endpoint", ["api"]], ["Polish the account settings page", ["web"]],
  ["Version the public schema", ["contracts", "api"]], ["Write the release checklist", ["docs"]],
  ["Cache product search results", ["api", "web"]], ["Add keyboard shortcuts to search", ["web"]],
  ["Document the webhook events", ["docs", "contracts"]], ["Retry failed payments", ["api"]],
  ["Validate addresses at checkout", ["contracts", "api", "web"]], ["Trim unused web dependencies", ["web"]],
  ["Explain the deploy pipeline", ["docs"]], ["Paginate the orders endpoint", ["api"]],
];
const QUESTIONS = [
  { text: "Two approaches pass the checks. Keep the change small, or refactor the module first?", options: ["Keep it small", "Refactor first"] },
  { text: "An existing test contradicts the task description. Update the test, or follow it?", options: ["Update the test", "Follow the test"] },
  { text: "This needs a new dependency. Add it, or write the helper by hand?", options: ["Add the dependency", "Write it by hand"] },
];
const HINTS = [
  ["contracts", /\b(schemas?|contracts?|types?|protocol|openapi)\b/i],
  ["api", /\b(api|endpoints?|server|backend|database|db|auth|login|webhooks?|queue|cache|payments?)\b/i],
  ["web", /\b(web|ui|pages?|screens?|buttons?|forms?|css|frontend|layout|modal|dark mode)\b/i],
  ["docs", /\b(docs?|document(ation)?|readme|guides?|tutorial|changelog)\b/i],
];

const ask = question => question ? { text: question.text, options: [...question.options] } : null;
const fresh = (item, status, source) => ({ ...item, repos: [...item.repos], depends: [...item.depends], question: ask(item.question), answer: null, held: null,
  status, source, slot: null, since: 0, approvals: [], attempts: 0 });

export function createPipeline(context, now = Date.now()) {
  return { version: VERSION, context, running: false, watch: false, column: "Ready", parallel: 3, reviewLimit: 5, delivery: "pr", quota: 72, reserve: 15, speed: 1,
    lastTick: now, sequence: 0, created: 0, generated: 0, failNext: false, askNext: false, events: [], plan: "Ready. Start the pipeline and the planner picks independent work first.",
    tasks: CATALOG.map((item, index) => fresh(item, index < 5 ? "queued" : "backlog", index < 5 ? "Picked" : null)) };
}

const folderName = path => String(path ?? "").replace(/\\/g, "/").split("/").filter(Boolean).pop();
export function createLive(context, now = Date.now()) {
  const repo = folderName(context.cwd) || "project";
  return { version: VERSION, live: true, context, repo, repositories: [{ name: repo, path: context.cwd ?? "" }], running: false, parallel: 2, reviewLimit: 4, delivery: "merge", agent: null, speed: 1, quota: 100, reserve: 0,
    watch: false, column: "Ready", lastTick: now, sequence: 0, created: 0, events: [], tasks: [], watching: {}, sourceErrors: {},
    plan: "Type a task, then start the pipeline. Each task gets its own agent, branch and worktree." };
}

function ticketed({ watchPlane, planeError, ...state }) {
  return { ...state, version: VERSION, ...(state.live ? { watching: watchPlane ? { plane: watchPlane } : {}, sourceErrors: planeError ? { plane: planeError } : {} } : {}),
    tasks: state.tasks.map(({ plane, ...task }) => plane ? { ...task, ticket: { provider: "plane", ...plane } } : task) };
}

function repositories(state) {
  if (!state.live) return { ...state, version: VERSION };
  const source = state.context?.cwd ?? "";
  return { ...state, version: VERSION, repositories: state.repositories ?? [{ name: state.repo, path: source }],
    tasks: state.tasks.map(({ workspace, planned, pr, ...task }) => {
      const name = task.repos?.[0] ?? state.repo;
      return { ...task, workspaces: workspace ? { [name]: { ...workspace, source } } : task.workspaces ?? null,
        planned: planned ? { [name]: { ...planned, source } } : null, prs: pr ? { [name]: pr } : task.prs ?? null };
    }) };
}

export function migrate(state, now = Date.now()) {
  if (newer(state)) return state;
  if (state?.live && state.tasks?.some(task => task.status === "merging" && task.pr && !task.merge))
    state = { ...state, tasks: state.tasks.map(task => task.status === "merging" && task.pr && !task.merge ? { ...task, status: "pr" } : task) };
  if (!state || state.version === VERSION) return state;
  if (state.version === 4 && Array.isArray(state.tasks)) return repositories(state);
  if (state.version === 3 && Array.isArray(state.tasks)) return repositories(ticketed(state));
  if (![1, 2].includes(state.version) || !Array.isArray(state.tasks)) return createPipeline(state.context ?? {}, now);
  const questions = new Map(CATALOG.map(item => [item.id, item.question]));
  return repositories(ticketed({ ...state, speed: state.speed ?? 1, created: state.created ?? 0, generated: state.generated ?? 0, askNext: false, lastTick: now,
    tasks: state.tasks.map(({ elapsed = 0, ...task }) => ({ ...task, since: task.since ?? now - elapsed,
      question: task.question ?? ask(questions.get(task.id)), answer: task.answer ?? null, held: task.held ?? null })) }));
}

export const duration = (state, status) => (DURATION[status] ?? 0) / (state.speed || 1);
export const progress = (state, task, now = Date.now()) => task.status === "input" ? task.held ?? 0 : MOVING.includes(task.status)
  ? Math.max(0, Math.min(1, (now - task.since) / duration(state, task.status))) : 0;

// The shared log keeps the last 40 lines; a live task keeps its own, so its story outlasts a busy pipeline.
function event(state, message, task = null) {
  state.events = [{ id: ++state.sequence, message, task }, ...state.events].slice(0, 40);
  const row = state.live && task ? state.tasks.find(other => other.id === task) : null;
  if (row) row.log = [message, ...(row.log ?? [])].slice(0, 30);
}
export const taskLog = (state, task) => task.log ?? state.events.filter(item => item.task === task.id).map(item => item.message);
export const STALL = 10 * 60000;
export function compact(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n);
}
export const usageText = usage => usage ? `${compact(usage.written)} tokens written · ${compact(usage.read)} read · ${compact(usage.cached)} from cache` : null;
// The order the planner starts work in: tasks marked to start first, then the planner agent's order when it is on, then priority, then arrival.
const startOrder = state => (a, b) => (b.rank ?? 0) - (a.rank ?? 0)
  || (state.planner?.on ? planOrder(a) - planOrder(b) : 0) || b.priority - a.priority || a.id.localeCompare(b.id, undefined, { numeric: true });
const planOrder = task => task.plan?.sig === planSig(task) ? task.plan.n : Infinity;
export const queueOrder = state => state.tasks.filter(task => task.status === "queued").sort(startOrder(state));
// A queued task needs a new plan when it is new or what the planner read about it changed; a task leaving the queue doesn't.
export const planSig = task => JSON.stringify([task.title, task.description ?? "", task.repos, task.priority, task.depends, (task.blockers ?? []).map(blocker => [blocker.key, blocker.closed])]);
// The planner runs as Claude Code or Codex: the one you pick, else the one tasks start with when it is one of them.
export const PLANNERS = { claude: "Claude Code", codex: "Codex" };
// How a planner run went, kept beside its plan: what it read, how long it took, what it cost.
const ran = action => ({ trace: (Array.isArray(action.trace) ? action.trace : []).map(line => String(line).slice(0, 200)).slice(-80),
  ms: Number(action.ms) || null, cost: typeof action.cost === "number" ? action.cost : null, tokens: Number(action.tokens) || null });
export const plannerAgent = state => PLANNERS[state.planner?.agent] ? state.planner.agent : state.agent?.key === "codex" ? "codex" : "claude";
export const planKey = state => JSON.stringify(state.tasks.filter(task => task.status === "queued").map(task => [task.id, planSig(task)]).sort((a, b) => a[0].localeCompare(b[0])));
export const planned = state => state.tasks.every(task => task.status !== "queued" || task.plan?.sig === planSig(task));
// A failed plan lets the tasks it was asked about start by priority; only a new or changed task asks again.
const failedFor = state => state.planning?.status === "failed"
  && state.tasks.every(task => task.status !== "queued" || task.plan?.sig === planSig(task) || JSON.parse(state.planning.key).some(([id, sig]) => id === task.id && sig === planSig(task)));
// With the planner agent on, nothing new starts until every queued task is planned, unless planning them failed.
export const plannerHolds = state => Boolean(state.live && state.planner?.on && !planned(state) && !failedFor(state));
export function elapsed(ms) {
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}
// Time counts while an agent works or its checks run, never while the work waits for the person.
const WORKED = ["working", "testing"];
export function timing(task, now = Date.now()) {
  if (task.status === "done") return task.spent ? `took ${elapsed(task.spent)}` : null;
  const spent = (task.spent ?? 0) + (WORKED.includes(task.status) && task.at ? Math.max(0, now - task.at) : 0);
  return spent && !["queued", "routing"].includes(task.status) ? elapsed(spent) : null;
}
export const activeTasks = state => state.tasks.filter(task => ACTIVE.includes(task.status));
export const outstanding = state => state.tasks.filter(task => [...ACTIVE, "review", "merging", "pr"].includes(task.status));
export const outstandingCount = state => outstanding(state).reduce((count, task) => count + task.repos.length, 0);
const ticketRows = (state, task, blocker) => blocker.key ? state.tasks.filter(row => row !== task && row.ticket?.provider === task.ticket?.provider && row.ticket?.key === blocker.key) : [];
// A blocker that is also in the pipeline waits for its task to merge; one outside it waits for its ticket to close.
const planWaits = (state, task) => state.planner?.on && task.plan?.sig === planSig(task) ? (task.plan?.waits ?? []).filter(id => { const row = state.tasks.find(other => other.id === id); return row && row.status !== "done"; }) : [];
export function waitsFor(state, task) {
  if (task.unblocked) return [];
  const waits = task.depends.filter(id => state.tasks.find(row => row.id === id)?.status !== "done").map(id => ({ id, kind: "task" }));
  for (const id of planWaits(state, task)) if (!waits.some(wait => wait.id === id)) waits.push({ id, kind: "task", planner: true });
  for (const blocker of task.blockers ?? []) {
    const rows = ticketRows(state, task, blocker);
    if (rows.some(row => row.status === "done")) continue;
    if (rows.length) { if (!waits.some(wait => wait.id === rows[0].id)) waits.push({ id: rows[0].id, kind: "task" }); }
    else if (blocker.closed !== true) waits.push({ id: blocker.key ?? "a ticket Pipeline can't read", kind: "ticket" });
  }
  return waits;
}
export const dependencies = (state, task) => waitsFor(state, task).map(wait => wait.id);
const after = (state, task) => [...task.depends, ...(state.planner?.on ? task.plan?.waits ?? [] : []), ...(task.blockers ?? []).flatMap(blocker => ticketRows(state, task, blocker).map(row => row.id))];
function reaches(state, from, id, seen = new Set()) {
  if (from.id === id) return true;
  if (seen.has(from.id)) return false;
  seen.add(from.id);
  return after(state, from).some(next => { const row = state.tasks.find(task => task.id === next); return row && row.status !== "done" && reaches(state, row, id, seen); });
}
export const canWaitFor = (state, task, other) => other !== task && other.status !== "done" && !reaches(state, other, task.id);
export const needsInput = task => task.status === "input";
export const needsApproval = task => task.status === "review" && task.delivery !== "direct" && task.repos.some(repo => !task.approvals.includes(repo));
export const workspacesOf = task => task.repos.filter(name => task.workspaces?.[name]).map(name => ({ name, ...task.workspaces[name] }));
export const targetOf = task => (workspacesOf(task)[0] ?? Object.values(task.planned ?? {})[0])?.target;
export const prList = prs => Object.entries(prs ?? {}).map(([name, pr]) => `${name} #${pr.number}`).join(", ");
// Ranked by how much it needs someone: the lowest rank across a task's pull requests goes on its card.
export function prNeed(pr, target = "the base branch") {
  const status = pr?.status;
  if (!status) return { label: `PR #${pr?.number} open`, tone: "wait", rank: 9 };
  if (status.draft) return { label: "Draft · mark it ready", tone: "wait", rank: 0 };
  if (status.mergeable === "CONFLICTING" || status.mergeState === "DIRTY") return { label: `Conflicts with ${target}`, tone: "blocked", rank: 1 };
  if (status.failed) return { label: `Checks failing · ${status.failed}`, tone: "blocked", rank: 2 };
  if (status.review === "CHANGES_REQUESTED") return { label: "Changes requested", tone: "blocked", rank: 3 };
  if (status.pending) return { label: `Checks running · ${status.pending}`, tone: "wait", rank: 4 };
  if (status.review === "REVIEW_REQUIRED") return { label: "Waiting for review", tone: "wait", rank: 5 };
  if (status.mergeState === "BEHIND") return { label: `Behind ${target}`, tone: "wait", rank: 6 };
  if (status.mergeState === "BLOCKED") return { label: "Blocked by branch rules", tone: "wait", rank: 7 };
  if (status.mergeState === "UNKNOWN") return { label: "GitHub is checking it", tone: "wait", rank: 8 };
  return { label: "Ready to merge", tone: "ready", rank: 10 };
}
export function prNeeds(task) {
  const open = Object.entries(task.prs ?? {}).filter(([, pr]) => !pr.merged)
    .map(([name, pr]) => ({ name, ...prNeed(pr, task.workspaces?.[name]?.target) }));
  if (!open.length) return { label: "Merged on GitHub", tone: "ready" };
  const top = open.reduce((best, need) => need.rank < best.rank ? need : best);
  if (task.repos.length < 2 || top.tone === "ready") return { label: top.label, tone: top.tone };
  if (open.length > 1 && open.every(need => need.rank === 9)) return { label: `${open.length} PRs open`, tone: "wait" };
  return { label: `${top.name} · ${top.label}`, tone: top.tone };
}
export function prChecklist(pr, target = "the base branch") {
  const status = pr?.status;
  if (!status) return [];
  const failing = status.failing?.length ? `: ${status.failing.join(", ")}` : "";
  const checks = status.failed ? { value: `${status.failed} failing${failing}`, tone: "blocked" }
    : status.pending ? { value: `${status.pending} running${status.passed ? `, ${status.passed} passed` : ""}`, tone: "wait" }
    : status.passed ? { value: `All ${status.passed} passed`, tone: "ready" } : { value: "None reported", tone: "ready" };
  const review = { APPROVED: { value: "Approved", tone: "ready" }, CHANGES_REQUESTED: { value: "Changes requested", tone: "blocked" },
    REVIEW_REQUIRED: { value: "Required, not given yet", tone: "wait" } }[status.review] ?? { value: "Not required", tone: "ready" };
  const merge = status.draft ? { value: "Draft. Mark it ready for review on GitHub", tone: "wait" }
    : status.mergeable === "CONFLICTING" || status.mergeState === "DIRTY" ? { value: `Conflicts with ${target}`, tone: "blocked" }
    : status.mergeState === "BEHIND" ? { value: `Behind ${target}. Update the branch`, tone: "wait" }
    : status.mergeState === "BLOCKED" ? { value: "Blocked until branch rules are met", tone: "wait" }
    : status.mergeState === "UNKNOWN" ? { value: "GitHub is still checking", tone: "wait" } : { value: `No conflicts with ${target}`, tone: "ready" };
  return [{ name: "Checks", ...checks }, { name: "Review", ...review }, { name: "Merge", ...merge }];
}
// What changed that the person should hear about while looking elsewhere. Herdr itself announces an agent that asks or finishes.
export function liveNotices(before, after) {
  if (!after?.live || after.quiet) return [];
  const was = new Map((before?.tasks ?? []).map(task => [task.id, task])), notices = [];
  for (const task of after.tasks) {
    const old = was.get(task.id);
    if (!old || task.discard) continue;
    const say = (title, body, level) => notices.push({ title: `${task.id} ${title}`, body: body || task.title, level, task: task.id });
    if (task.stalled && !old.stalled) say("may be stuck", `Its terminal has shown nothing new for ${elapsed(STALL)} · ${task.title}`, "warning");
    else if (task.status === "failed" && old.status !== "failed") say(task.reason === "checks" ? "checks failed" : "stopped", task.reason === "checks" ? task.title : task.error, "error");
    else if (task.status === "input" && task.reason === "trust" && old.reason !== "trust") say("asks to trust its worktree", task.title, "warning");
    else if (task.status === "review" && old.status === "merging") say(after.delivery === "pr" ? "pull request not opened" : "not merged", task.error, "error");
    else if (task.status === "review" && old.status === "pr") say("pull request closed", task.error, "warning");
    else if (task.status === "review" && old.status === "testing" && needsApproval(task)) say("is ready for review", `Checks passed · ${task.title}`, "success");
    else if (task.status === "done" && old.status === "pr") say("merged on GitHub", task.title, "success");
    else if (task.status === "done" && old.status === "merging" && after.autoMerge) say("merged", task.title, "success");
    else if (task.status === "pr" && old.status === "pr") {
      const need = prNeeds(task), last = prNeeds(old);
      if (need.label !== last.label && need.tone !== "wait" && need.tone !== last.tone) say(`pull request · ${need.label.toLowerCase()}`, task.title, need.tone === "ready" ? "success" : "warning");
    }
  }
  return notices;
}
export const LIMITED = { claude: "Claude", codex: "Codex" };
export const LIMIT_HOLD = 90;
export const LIMIT_READ = 5 * 60000;
export const limitHold = state => state.limitHold === undefined ? LIMIT_HOLD : state.limitHold;
export const limitAgent = state => state.agent ? state.agent.key : "claude";
// A reading outlives its window: once a window resets, nothing of it is used until the next reading says otherwise.
export const limitUsed = (window, now = Date.now()) => window.resets && window.resets <= now ? 0 : window.used;
// The limit that keeps a task from starting: one of its agent's windows at the hold, unless it counts only another model.
export function limitHolding(state, task = null, now = Date.now()) {
  const hold = limitHold(state), key = limitAgent(state), windows = state.limits?.[key]?.windows;
  if (!state.live || hold === null || !Array.isArray(windows)) return null;
  const model = String(taskTuning(state, task, key).model ?? "").toLowerCase();
  const held = windows.find(window => limitUsed(window, now) >= hold && (!window.model || model.includes(window.model)));
  return held ? { ...held, agent: LIMITED[key] } : null;
}
const percent = value => typeof value === "number" && value >= 0 && value <= 100 ? value : null;
function cleanLimits(read) {
  if (!Array.isArray(read.windows)) return { error: String(read.error ?? "No reading.").slice(0, 300), missing: Boolean(read.missing) };
  const windows = read.windows.filter(window => window && typeof window.name === "string" && percent(window.used) !== null).slice(0, 8)
    .map(window => ({ name: window.name.slice(0, 40), used: window.used, resets: Number(window.resets) || null, model: typeof window.model === "string" && window.model ? window.model.slice(0, 40) : null }));
  return { windows, ...(percent(read.extra) !== null ? { extra: read.extra } : {}), ...(Number(read.seen) ? { seen: Number(read.seen) } : {}) };
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function resetTime(at, now = Date.now()) {
  const when = new Date(at), clock = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  if (when.toDateString() === new Date(now).toDateString()) return clock;
  return at - now < 6 * 86400000 ? `${DAYS[when.getDay()]} ${clock}` : `${when.getDate()}/${when.getMonth() + 1} ${clock}`;
}
const limitName = limit => `${limit.agent}'s ${limit.name.replace(/^Weekly /, "weekly ").replace(/^Weekly$/, "weekly")} limit`;
export const quotaHeld = (state, task = null, now = Date.now()) => state.live ? Boolean(limitHolding(state, task, now)) : state.quota - 8 < state.reserve;
export function waitingReason(state, task, now = Date.now()) {
  const waits = waitsFor(state, task), tasks = waits.filter(wait => wait.kind === "task"), tickets = waits.filter(wait => wait.kind === "ticket");
  if (waits.length) return `Waiting for ${[tasks.length && `${tasks.map(wait => wait.id).join(", ")} to merge`,
    tickets.length && `${tickets.map(wait => wait.id).join(", ")} to close in ${SOURCES[task.ticket?.provider] ?? "its tracker"}`].filter(Boolean).join(" and ")}`;
  if (!state.running) return "Intake paused";
  if (plannerHolds(state)) return "Waiting for the planner";
  const limit = limitHolding(state, task, now);
  if (limit) return `Held by ${limitName(limit)}${limit.resets ? ` until ${resetTime(limit.resets, now)}` : ""}`;
  if (!state.live && quotaHeld(state)) return "Waiting for quota above the reserve";
  if (outstandingCount(state) + task.repos.length > state.reviewLimit) return state.live ? "Too many branches waiting for your review" : "Outstanding PR limit reached";
  if (activeTasks(state).length >= state.parallel) return "Waiting for a work slot";
  return "Ready for the planner";
}
export function parseTime(text) {
  const match = String(text ?? "").trim().toLowerCase().match(/^(\d{1,2})(?:[:.]?(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (match[3]) { if (hours < 1 || hours > 12) return null; hours = hours % 12 + (match[3] === "pm" ? 12 : 0); }
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
// Schedule times are local wall-clock times that come round every day.
function occurrence(time, now, step) {
  const [hours, minutes] = time.split(":").map(Number), at = new Date(now);
  at.setHours(hours, minutes, 0, 0);
  if (step < 0 ? at.getTime() > now : at.getTime() <= now) at.setDate(at.getDate() + step);
  return at.getTime();
}
const turn = (state, now, step) => ["start", "pause"].filter(kind => state.schedule?.[kind])
  .map(kind => ({ kind, time: state.schedule[kind], at: occurrence(state.schedule[kind], now, step) }))
  .sort((a, b) => step * (a.at - b.at))[0] ?? null;
export const lastScheduled = (state, now = Date.now()) => turn(state, now, -1);
export const nextScheduled = (state, now = Date.now()) => turn(state, now, 1);
export function guessRepos(title, index = 0) {
  const repos = HINTS.filter(([, pattern]) => pattern.test(title)).map(([repo]) => repo);
  return repos.length ? repos : [REPOS[index % 2]];
}

function enqueue(state, ids, source) {
  for (const task of state.tasks) {
    if (!ids.includes(task.id) || task.status !== "backlog") continue;
    task.status = "queued"; task.source = source;
    event(state, `${task.id} joined the queue · ${source}`, task.id);
  }
}
// A live task is approved for every repository at once, and merges every one or none.
function approve(state, task, repos) {
  if (state.live) {
    if (task?.status !== "review" || task.merge || task.discard || task.repos.every(repo => task.approvals.includes(repo))) return 0;
    task.approvals = [...task.repos]; task.error = null;
    return 1;
  }
  if (task?.status !== "review" || task.delivery === "direct") return 0;
  const added = repos.filter(repo => task.repos.includes(repo) && !task.approvals.includes(repo));
  task.approvals.push(...added);
  for (const repo of added) event(state, `${task.id} · ${repo} PR approved.`, task.id);
  return added.length;
}
function retry(state, task) {
  if (task?.status !== "failed") return;
  task.status = "queued"; task.since = 0; task.approvals = []; task.error = null;
  event(state, `${task.id} returned to the queue.`, task.id);
}
function advance(state, task, now) {
  const previous = task.status;
  task.since = Math.max(task.since + duration(state, previous), now - 1000);
  if (previous === "routing") task.status = "working";
  else if (previous === "working") task.status = "testing";
  else if (previous === "testing") {
    task.slot = null;
    if (state.failNext) {
      task.status = "failed"; task.error = "Example contract test failed. Inspect the task, then retry."; state.failNext = false;
      event(state, `${task.id} needs attention · checks failed.`, task.id);
    } else {
      task.status = "review"; task.delivery = state.delivery;
      event(state, `${task.id} checks passed · ${task.repos.length} example PR${task.repos.length === 1 ? "" : "s"} ready.`, task.id);
    }
  } else if (previous === "merging") { task.status = "done"; task.finished = ++state.sequence; event(state, `${task.id} merged across ${task.repos.join(" + ")}.`, task.id); }
}

function explain(state, picked, now = Date.now()) {
  const said = plain(state, picked, now);
  if (!state.live || !state.planner?.on || !state.tasks.some(task => task.status === "queued")) return said;
  const planning = state.planning;
  if (plannerHolds(state)) return `The planner is reading ${count(state.tasks.filter(task => task.status === "queued").length, "queued task")} and the repository.${state.running ? " New agents wait for its plan." : ""}`;
  if (!planned(state) && planning?.status === "failed") return `The planner couldn't plan: ${planning.error} Tasks start by priority meanwhile.`;
  return `${planning?.summary ?? ""}${picked.length ? ` ${said}` : ""}`.trim();
}
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
function plain(state, picked, now = Date.now()) {
  const queued = state.tasks.filter(task => task.status === "queued");
  const held = queued.filter(task => dependencies(state, task).length);
  const ready = queued.filter(task => !dependencies(state, task).length);
  const reviews = state.tasks.filter(needsApproval).length;
  const asking = state.tasks.filter(needsInput).map(task => task.id);
  const holding = !held.length ? "" : state.live ? ` Holding ${held.map(task => task.id).join(", ")} until what ${held.length === 1 ? "it waits" : "they wait"} for is done.`
    : ` Holding ${held.map(task => task.id).join(", ")} until ${held.length === 1 ? "its dependency merges" : "their dependencies merge"}.`;
  if (picked.length) return state.live ? `Starting ${picked.length === 1 ? "an agent" : "agents"} for ${picked.join(" + ")}, each in its own worktree.${holding}`
    : `Launched ${picked.join(" + ")} by priority.${holding || " They can proceed independently."}`;
  if (asking.length) return state.live ? `${asking.join(", ")} ${asking.length === 1 ? "is" : "are"} waiting for you in ${asking.length === 1 ? "its terminal" : "their terminals"}.`
    : `${asking.join(", ")} ${asking.length === 1 ? "is paused until you answer. Its slot stays" : "are paused until you answer. Their slots stay"} reserved.`;
  if (state.live && !state.running && !state.tasks.length) return "Type a task, then start the pipeline. Each task gets its own agent, branch and worktree.";
  const starts = state.schedule?.start ? ` Starts by itself at ${state.schedule.start}.` : "";
  if (!state.running) return outstanding(state).length ? `Intake paused. Active work and approved merges can finish.${starts}` : starts ? `Ready.${starts}` : "Ready. Start the pipeline and the planner picks independent work first.";
  if (ready.length && !state.live && quotaHeld(state)) return `Holding new work to protect your quota reserve. Reset the example quota to resume.${holding}`;
  const limit = ready.length && ready.every(task => limitHolding(state, task, now)) && limitHolding(state, ready[0], now);
  if (limit) return `Holding new agents: ${limitName(limit)} is at ${Math.round(limitUsed(limit, now))}%, past the ${limitHold(state)}% you hold at.${limit.resets ? ` It resets at ${resetTime(limit.resets, now)}.` : ""} Agents already working keep going.${holding}`;
  if (ready.length) return `${ready[0].id}: ${waitingReason(state, ready[0], now)}.${reviews ? ` ${reviews} task${reviews === 1 ? "" : "s"} awaiting your approval.` : ""}${holding}`;
  if (held.length) return holding.trim();
  if (outstanding(state).length) return `All queued work is in flight.${reviews ? ` ${reviews} task${reviews === 1 ? "" : "s"} ${state.live ? "ready for your review" : "awaiting your approval"}.` : ""}`;
  if (state.live) return "Queue clear. Type a task to start another agent.";
  return state.watch ? `Queue clear. Watching ${state.column} for the next task.` : "Queue clear. Add tasks to keep the planner busy.";
}

export const TITLE = 90;
export function typedTask(text) {
  const full = String(text ?? "").trim(), flat = full.replace(/\s+/g, " ");
  if (flat.length <= TITLE) return { title: flat, description: "" };
  const sentence = flat.match(/^(.{12,}?[.!?])(?=\s)/)?.[1];
  if (sentence && sentence.length <= TITLE) return { title: sentence, description: full.slice(0, 4000) };
  const space = flat.slice(0, TITLE).lastIndexOf(" "), head = flat.slice(0, space > TITLE / 2 ? space : TITLE - 1).replace(/[\s,;:.-]+$/, "");
  return { title: `${head}…`, description: full.slice(0, 4000) };
}

// All mutations go through one reducer; multiple views share one pipeline.
const liveTask = (state, fields, source) => ({ ...fresh({ repos: [state.repo], priority: 2, depends: [], column: "Ready", description: "", ...fields }, "queued", source),
  workspaces: null, planned: null, prs: null, terminal: null, space: null, launch: null, worked: false, merge: false, discard: false, error: null });
const started = task => Object.keys(task.workspaces ?? {}).length > 0;
const repoNames = task => task.repos.length > 1 ? ` in ${task.repos.join(" + ")}` : "";
const PRIORITIES = { Urgent: 4, High: 3, Medium: 2, Low: 1 };
export const CHECK_FIXES = 2;
function seat(state, task) {
  const used = new Set(state.tasks.filter(other => other !== task && ACTIVE.includes(other.status)).map(other => other.slot));
  task.slot = 0; while (used.has(task.slot)) task.slot++;
}
const cleanBlockers = blockers => (Array.isArray(blockers) ? blockers : []).filter(blocker => blocker && typeof blocker === "object").slice(0, 20)
  .map(blocker => ({ key: blocker.key ? String(blocker.key).slice(0, 40) : null, uuid: blocker.uuid ? String(blocker.uuid) : null, title: String(blocker.title ?? "").slice(0, 200),
    url: /^https?:\/\//.test(blocker.url ?? "") ? blocker.url : null, closed: typeof blocker.closed === "boolean" ? blocker.closed : null }));
function unlink(state, id) {
  for (const task of state.tasks.filter(task => task.depends.includes(id))) {
    task.depends = task.depends.filter(other => other !== id);
    event(state, `${task.id} no longer waits for ${id}, which was removed.`, task.id);
  }
}
export const UPDATE_KINDS = { start: "When its agent starts", merge: "When the work merges" };
// Ticket updates wait on the task until the runner makes them; none of them changes the task's own status.
function ticketUpdate(state, task, kind) {
  const ticket = task.ticket, setup = state.ticketUpdates?.[ticket?.provider];
  if (!ticket || !setup) return;
  let update;
  if (kind === "link") {
    const links = Object.entries(task.prs ?? {}).filter(([, pr]) => !pr.merged && pr.url)
      .map(([name, pr]) => ({ url: pr.url, number: pr.number, title: `${task.repos.length > 1 ? `${name} ` : ""}PR #${pr.number}: ${task.title}` }));
    if (!setup.link || !links.length) return;
    update = { kind, ...links[0], ...(links.length > 1 ? { links } : {}) };
  } else {
    if (!setup[kind]?.id || (kind === "start" && ticket.moved?.includes("start"))) return;
    update = { kind, state: { id: setup[kind].id, name: setup[kind].name } };
  }
  ticket.serial = (ticket.serial ?? 0) + 1;
  ticket.pending = [...(ticket.pending ?? []).filter(other => other.kind !== kind), { ...update, n: ticket.serial }];
  ticket.failed = (ticket.failed ?? []).filter(other => other.kind !== kind);
}
export function updateText(ticket, update, changed = true) {
  const service = SOURCES[ticket?.provider] ?? "its tracker";
  if (update.kind === "link" && update.links) return changed ? `Linked ${update.links.length} pull requests in ${service}` : `The pull requests were already linked in ${service}`;
  if (update.kind === "link") return changed ? `Linked PR #${update.number} in ${service}` : `PR #${update.number} was already linked in ${service}`;
  return changed ? `Moved to ${update.state.name} in ${service}` : `Already ${update.state.name} in ${service}`;
}
// A branch whose last push failed stays listed until a push of it succeeds; every push carries all merges before it.
function recordPushes(state, task, results) {
  for (const result of results ?? []) {
    if (!result?.repo || !result.branch) continue;
    const push = { pushed: Boolean(result.pushed), remote: String(result.remote || "origin"), branch: String(result.branch),
      error: result.pushed ? null : String(result.error || "Git could not push.").slice(0, 300) };
    if (task) task.pushes = { ...task.pushes, [result.repo]: push };
    const others = (state.unpushed ?? []).filter(entry => entry.repo !== result.repo || entry.branch !== push.branch);
    if (push.pushed) {
      for (const other of state.tasks) {
        const before = other.pushes?.[result.repo];
        if (other !== task && before && !before.pushed && before.branch === push.branch) other.pushes = { ...other.pushes, [result.repo]: { ...push, later: true } };
      }
      state.unpushed = others;
    } else state.unpushed = [...others, { repo: result.repo, root: result.root ?? null, branch: push.branch, remote: push.remote, error: push.error, retry: false }];
  }
}
export function pushNote(task) {
  const rows = Object.entries(task?.pushes ?? {});
  if (!rows.length) return null;
  const failed = rows.filter(([, push]) => !push.pushed), several = rows.length > 1;
  if (!failed.length) return { ok: true, text: `pushed to ${[...new Set(rows.map(([, push]) => push.remote))].join(" + ")}` };
  return { ok: false, text: `${several ? `${failed.map(([name]) => name).join(" + ")} ` : ""}not pushed`,
    error: failed.map(([name, push]) => `${several ? `${name}: ` : ""}${push.error}`).join(" ") };
}
const pushEvent = note => note ? ` · ${note.text}${note.ok ? "" : ` · ${note.error}`}` : "";
export const unpushedLabel = state => (state.unpushed ?? []).map(entry => (state.repositories?.length ?? 1) > 1 ? `${entry.branch} in ${entry.repo}` : entry.branch).join(", ");

function reviewed(state, task) {
  if (state.delivery === "pr" ? state.autoPr : state.autoMerge) approve(state, task);
}

const SIMULATED = ["add", "addAll", "generate", "watch", "column", "arrival", "delivery", "speed", "quota", "reserve", "fail", "ask", "answer"];

export function reduce(state, action, now = Date.now()) {
  if (newer(state)) return state;
  if (state.live && SIMULATED.includes(action.type)) return state;
  const next = JSON.parse(JSON.stringify(state));
  const row = id => next.tasks.find(task => task.id === id);
  switch (action.type) {
    case "run":
      next.running = !next.running;
      if (next.live && action.space) next.space = action.space;
      event(next, next.running ? (next.live ? "Started. Agents start for queued tasks, up to the parallel limit." : "Planner started. Looking for independent work.") : "Intake paused. Active work will finish.");
      break;
    case "schedule": {
      const value = { ...(next.schedule ?? { start: null, pause: null }) };
      for (const kind of ["start", "pause"]) {
        if (action[kind] === undefined) continue;
        const time = String(action[kind] ?? "").trim() ? parseTime(action[kind]) : null;
        if (time === null && String(action[kind] ?? "").trim()) return state;
        value[kind] = time;
      }
      if (value.start && value.start === value.pause) return state;
      const schedule = value.start || value.pause ? value : null;
      if (JSON.stringify(schedule) === JSON.stringify(next.schedule ?? null)) return state;
      next.schedule = schedule;
      // Times that already passed today wait for tomorrow instead of firing the moment they're saved.
      next.scheduled = lastScheduled(next, now)?.at ?? null;
      if (next.live && action.space) next.space = action.space;
      const parts = [value.start && `starts at ${value.start}`, value.pause && `pauses intake at ${value.pause}`].filter(Boolean);
      event(next, parts.length ? `Every day the pipeline ${parts.join(" and ")}.` : "Schedule cleared.");
      break;
    }
    case "scheduleTick": {
      const due = lastScheduled(next, now);
      if (!due || due.at <= (next.scheduled ?? -Infinity)) return state;
      next.scheduled = due.at;
      const running = due.kind === "start";
      if (next.running === running) break;
      next.running = running;
      event(next, running ? `Scheduled start at ${due.time} · planner started.` : `Scheduled pause at ${due.time} · intake paused. Active work will finish.`);
      break;
    }
    case "add": enqueue(next, action.ids ?? [], "Picked"); break;
    case "addAll": enqueue(next, next.tasks.filter(task => task.status === "backlog").map(task => task.id), "Picked"); break;
    case "create": {
      const { title, description } = typedTask(action.title);
      if (!title) return state;
      next.created = (next.created ?? 0) + 1;
      if (next.live) {
        const id = `T-${next.created}`;
        next.tasks.push(liveTask(next, { id, title, description }, "Typed"));
        event(next, `${id} joined the queue${description ? " · the whole text is in its details" : ""}.`, id);
        break;
      }
      const id = `NEW-${next.created}`;
      next.tasks.push(fresh({ id, title, repos: guessRepos(description || title, next.created), priority: 2, depends: [], column: "Ready",
        description: description || "Created in Pipeline. The simulation picked its repositories from the title; change them while it waits in the queue." }, "backlog", null));
      enqueue(next, [id], "Created");
      break;
    }
    case "generate": {
      const ids = [];
      for (let i = 0; i < Math.max(1, Math.min(12, action.count ?? 6)); i++) {
        const n = next.generated ?? 0, [title, repos] = EXAMPLES[n % EXAMPLES.length];
        next.generated = n + 1;
        const id = `DEMO-${109 + n}`;
        next.tasks.push(fresh({ id, title, repos, priority: 1 + (n % 3), depends: [], column: next.column, question: n % 3 === 1 ? QUESTIONS[n % QUESTIONS.length] : null,
          description: "An example task generated by the simulation." }, "backlog", null));
        ids.push(id);
      }
      enqueue(next, ids, "Picked");
      break;
    }
    case "addTickets": {
      const provider = action.provider, name = SOURCES[provider];
      if (!next.live || !name) return state;
      next.claimed ??= [];
      let added = 0;
      for (const issue of action.issues ?? []) {
        if (!issue?.uuid || !issue.title) continue;
        if (next.tasks.some(task => task.ticket?.uuid === issue.uuid && task.status !== "done")) continue;
        if (action.watched && next.claimed.includes(issue.uuid)) continue;
        let id = String(issue.identifier || `T-${++next.created}`);
        if (next.tasks.some(task => task.id === id)) { let n = 2; while (next.tasks.some(task => task.id === `${id}-${n}`)) n++; id = `${id}-${n}`; }
        next.tasks.push(liveTask(next, { id, title: String(issue.title).slice(0, 200), description: String(issue.description ?? "").slice(0, 8000),
          priority: PRIORITIES[issue.priority?.name] ?? 1, ticket: { provider, uuid: issue.uuid, key: issue.identifier, url: issue.url, status: issue.status, ...(issue.team ? { team: String(issue.team) } : {}) },
          blockers: cleanBlockers(issue.blockers) }, action.source ?? name));
        next.claimed = [...next.claimed.filter(uuid => uuid !== issue.uuid), issue.uuid].slice(-500);
        event(next, `${id} joined the queue · ${action.source ?? name}`, id);
        added++;
      }
      if (!added) return state;
      break;
    }
    case "watchTickets": {
      const provider = action.provider, name = SOURCES[provider];
      if (!next.live || !name) return state;
      const watch = action.state?.id ? { id: action.state.id, name: String(action.state.name ?? "a state"), ...(action.filter ? { filter: action.filter } : {}) } : null;
      const current = next.watching?.[provider] ?? null;
      if (watch?.id === current?.id && JSON.stringify(watch?.filter ?? null) === JSON.stringify(current?.filter ?? null)) return state;
      next.watching = { ...next.watching, [provider]: watch };
      next.sourceErrors = { ...next.sourceErrors, [provider]: null };
      event(next, watch ? `Watching ${name} for tickets in ${watch.name}${watch.filter?.label ? ` · ${watch.filter.label}` : ""}.` : `Stopped watching ${name}.`);
      break;
    }
    case "ticketUpdates": {
      const provider = action.provider, name = SOURCES[provider];
      if (!next.live || !name) return state;
      const now = { start: null, merge: null, link: false, ...next.ticketUpdates?.[provider] }, value = { ...now };
      for (const kind of Object.keys(UPDATE_KINDS)) if (kind in action) value[kind] = action[kind]?.id ? { id: String(action[kind].id), name: String(action[kind].name ?? action[kind].id) } : null;
      if ("link" in action) value.link = Boolean(action.link);
      if (JSON.stringify(value) === JSON.stringify(now)) return state;
      next.ticketUpdates = { ...next.ticketUpdates, [provider]: value };
      const changes = [value.start && `move to ${value.start.name} when their agent starts`, value.merge && `move to ${value.merge.name} when their work merges`,
        value.link && "get their pull request linked"].filter(Boolean);
      event(next, changes.length ? `${name} tickets ${changes.join(", ").replace(/, ([^,]*)$/, " and $1")}.` : `Pipeline no longer updates ${name} tickets.`);
      break;
    }
    case "ticketUpdated": {
      const task = row(action.id), ticket = task?.ticket, update = ticket?.pending?.find(other => other.n === action.n);
      if (!next.live || !update) return state;
      const service = SOURCES[ticket.provider];
      ticket.pending = ticket.pending.filter(other => other !== update);
      const { n, ...request } = update;
      if (action.ok) {
        const text = updateText(ticket, update, action.changed !== false);
        ticket.update = { kind: update.kind, ok: true, error: null, at: now, text };
        ticket.moved = [...new Set([...(ticket.moved ?? []), update.kind])];
        if (update.state) ticket.status = update.state.name;
        event(next, `${task.id} · ${text[0].toLowerCase()}${text.slice(1)}.`, task.id);
      } else {
        const error = String(action.error || `${service} could not be updated.`).slice(0, 300);
        ticket.update = { kind: update.kind, ok: false, error, errorKind: action.errorKind ?? null, at: now };
        ticket.failed = [...(ticket.failed ?? []).filter(other => other.kind !== update.kind), { ...request, error, errorKind: action.errorKind ?? null }];
        event(next, `${task.id} · couldn't update ${service} · ${error}`, task.id);
      }
      break;
    }
    case "ticketRetry": {
      const task = row(action.id), ticket = task?.ticket;
      if (!next.live || !ticket?.failed?.length) return state;
      for (const { error, errorKind, ...update } of ticket.failed) {
        ticket.serial = (ticket.serial ?? 0) + 1;
        ticket.pending = [...(ticket.pending ?? []).filter(other => other.kind !== update.kind), { ...update, n: ticket.serial }];
      }
      ticket.failed = [];
      event(next, `${task.id} · trying the ${SOURCES[ticket.provider]} update again.`, task.id);
      break;
    }
    case "sourceError": {
      const provider = action.provider;
      if (!next.live || !SOURCES[provider] || (next.sourceErrors?.[provider] ?? null) === (action.error ?? null)) return state;
      next.sourceErrors = { ...next.sourceErrors, [provider]: action.error ?? null };
      break;
    }
    case "blockers": {
      const task = row(action.id), service = SOURCES[task?.ticket?.provider];
      if (!next.live || task?.status !== "queued" || !service || !Array.isArray(action.blockers)) return state;
      const value = cleanBlockers(action.blockers), before = task.blockers ?? [];
      if (JSON.stringify(value) === JSON.stringify(before)) return state;
      for (const blocker of value.filter(blocker => blocker.closed && before.some(old => old.key === blocker.key && !old.closed)))
        event(next, `${task.id} · ${blocker.key} closed in ${service}.`, task.id);
      task.blockers = value;
      break;
    }
    case "link": {
      const task = row(action.id), other = row(action.on);
      if (!next.live || task?.status !== "queued" || !other || other === task) return state;
      if (task.depends.includes(other.id)) {
        task.depends = task.depends.filter(id => id !== other.id);
        event(next, `${task.id} no longer waits for ${other.id}.`, task.id);
      } else {
        if (!canWaitFor(next, task, other)) return state;
        task.depends.push(other.id); task.unblocked = false;
        event(next, `${task.id} waits for ${other.id} to merge.`, task.id);
      }
      break;
    }
    case "unblock": {
      const task = row(action.id), value = Boolean(action.value ?? !task?.unblocked);
      if (!next.live || task?.status !== "queued" || Boolean(task.unblocked) === value || (value && !dependencies(next, task).length)) return state;
      task.unblocked = value;
      event(next, value ? `${task.id} starts without waiting.` : `${task.id} waits for what it depends on again.`, task.id);
      break;
    }
    case "first": {
      const task = row(action.id), value = Boolean(action.value ?? !task?.rank);
      if (task?.status !== "queued" || Boolean(task.rank) === value) return state;
      task.rank = value ? Math.max(0, ...next.tasks.map(other => other.rank ?? 0)) + 1 : 0;
      event(next, value ? `${task.id} starts before the rest of the queue.` : `${task.id} is back in its usual place in the queue.`, task.id);
      break;
    }
    case "tuneTask": {
      const task = row(action.id), key = next.agent?.key ?? action.key, options = AGENT_OPTIONS[key];
      if (!next.live || task?.status !== "queued" || !options) return state;
      const before = { model: task.tune?.model ?? null, effort: task.tune?.effort ?? null }, tune = { ...before };
      if ("model" in action) tune.model = String(action.model ?? "").trim().slice(0, 100) || null;
      if ("effort" in action) tune.effort = effortFits(options, action.effort) ? action.effort : null;
      if (tune.model === before.model && tune.effort === before.effort) return state;
      task.tune = tune.model || tune.effort ? tune : null;
      break;
    }
    case "resolving": {
      const task = row(action.id);
      if (!next.live || task?.status !== "review" || !task.error) return state;
      task.error = null; task.approvals = [];
      event(next, action.ask === "commit" ? `${task.id} · asked its agent to commit what it left.`
        : `${task.id} · asked its agent to rebase onto ${targetOf(task) ?? "your branch"} and resolve the conflicts.`, task.id);
      break;
    }
    case "usage": {
      const task = row(action.id), usage = action.usage;
      if (!next.live || !task || !usage || JSON.stringify(task.usage ?? null) === JSON.stringify(usage)) return state;
      task.usage = { written: Number(usage.written) || 0, read: Number(usage.read) || 0, cached: Number(usage.cached) || 0, turns: Number(usage.turns) || 0 };
      break;
    }
    case "stalled": {
      const task = row(action.id), since = action.since ?? null;
      if (!next.live || task?.status !== "working" || (task.stalled ?? null) === since) return state;
      task.stalled = since;
      if (since) event(next, `${task.id} · its terminal has shown nothing new for ${elapsed(STALL)}. Its agent may be stuck.`, task.id);
      break;
    }
    case "plannerSetup": {
      if (!next.live) return state;
      const before = { on: false, agent: null, model: null, effort: null, ...next.planner }, value = { ...before };
      if ("on" in action) value.on = Boolean(action.on);
      if ("agent" in action && PLANNERS[action.agent] && action.agent !== plannerAgent(next)) Object.assign(value, { agent: action.agent, model: null, effort: null });
      if ("model" in action) value.model = String(action.model ?? "").trim().slice(0, 100) || null;
      if ("effort" in action) value.effort = /^[a-z]{1,20}$/.test(action.effort ?? "") ? action.effort : null;
      if (JSON.stringify(value) === JSON.stringify(before)) return state;
      next.planner = value;
      if (value.on !== before.on) event(next, value.on ? "An agent plans the queue before work starts." : "Tasks start by priority again, without the planner agent.");
      break;
    }
    case "planning": {
      if (!next.live || !next.planner?.on || action.key !== planKey(next)) return state;
      next.planning = { key: action.key, status: "running", at: now, agent: plannerAgent(next), model: next.planner.model ?? null, effort: next.planner.effort ?? null,
        prompt: String(action.prompt ?? "").slice(0, 20000), watch: Boolean(next.planner.watch) };
      if (next.planner.watch) next.planner = { ...next.planner, watch: false };
      break;
    }
    case "planned": {
      if (!next.live || !next.planner?.on || next.planning?.key !== action.key || action.key !== planKey(next)) return state;
      const queued = next.tasks.filter(task => task.status === "queued");
      const order = [...new Set((action.order ?? []).map(String))].filter(id => queued.some(task => task.id === id));
      for (const task of queued.sort(startOrder({ planner: null }))) if (!order.includes(task.id)) order.push(task.id);
      for (const task of queued) task.plan = { n: order.indexOf(task.id), reason: String(action.reasons?.[task.id] ?? "").slice(0, 300), waits: [], sig: planSig(task) };
      // A wait on a queued task the plan starts later contradicts the plan's own order, so it is left out.
      for (const task of [...queued].sort((a, b) => a.plan.n - b.plan.n)) for (const id of [...new Set((action.waits?.[task.id] ?? []).map(String))]) {
        const other = next.tasks.find(row => row.id === id);
        if (!other || other === task || other.status === "done" || task.depends.includes(id) || (other.status === "queued" && other.plan.n > task.plan.n)) continue;
        if (canWaitFor(next, task, other)) task.plan.waits.push(id);
      }
      next.planning = { ...next.planning, ...ran(action), status: "done", at: now, summary: String(action.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 400) || "The planner ordered the queue.",
        tasks: queued.sort((a, b) => a.plan.n - b.plan.n).map(task => ({ id: task.id, title: task.title, reason: task.plan.reason, waits: task.plan.waits })) };
      const waiting = queued.filter(task => task.plan.waits.length);
      event(next, `The planner ordered the queue: ${order.join(", ")}.${waiting.length ? ` ${waiting.map(task => `${task.id} waits for ${task.plan.waits.join(", ")}`).join("; ")}.` : ""}`);
      break;
    }
    case "planFailed": {
      if (!next.live || next.planning?.key !== action.key || next.planning.status !== "running") return state;
      next.planning = { ...next.planning, ...ran(action), status: "failed", at: now, error: String(action.error || "The planner gave no plan.").replace(/\s+/g, " ").slice(0, 300) };
      event(next, `The planner couldn't plan · ${next.planning.error}`);
      break;
    }
    case "watchPlan": {
      if (!next.live || !next.planner?.on) return state;
      next.planner = { ...next.planner, watch: !next.planner.watch };
      break;
    }
    case "replan": {
      if (!next.live || !next.planner?.on || next.planning?.status === "running") return state;
      next.planning = null;
      for (const task of next.tasks) if (task.status === "queued") task.plan = null;
      break;
    }
    case "quiet": {
      const value = Boolean(action.value ?? !next.quiet);
      if (!next.live || Boolean(next.quiet) === value) return state;
      next.quiet = value;
      event(next, value ? "Pipeline no longer notifies you." : "Pipeline notifies you when work needs you.");
      break;
    }
    case "describe": {
      const task = row(action.id);
      if (!next.live || task?.status !== "queued") return state;
      task.description = String(action.text ?? "").slice(0, 4000);
      break;
    }
    case "agent": {
      if (!next.live || !Array.isArray(action.value?.run)) return state;
      next.agent = { key: action.value.key ?? null, name: action.value.name ?? "Agent", run: [...action.value.run] };
      break;
    }
    case "tune": {
      const options = AGENT_OPTIONS[action.key];
      if (!next.live || !options) return state;
      const now = tuningFor(next, action.key), tune = { ...now };
      if ("model" in action) tune.model = String(action.model ?? "").trim().slice(0, 100) || null;
      if ("effort" in action) tune.effort = effortFits(options, action.effort) ? action.effort : null;
      if (tune.model === now.model && tune.effort === now.effort) return state;
      next.tuning = { ...next.tuning, [action.key]: tune };
      event(next, `New tasks start with ${tuningLabel(tune) || "the agent's default model and effort"}.`);
      break;
    }
    case "launch": {
      const task = row(action.id);
      if (!next.live || task?.status !== "routing") return state;
      task.launch = action.phase;
      if (action.planned) task.planned = { ...task.planned, [action.repo]: action.planned };
      if (action.workspace) task.workspaces = { ...task.workspaces, [action.repo]: action.workspace };
      break;
    }
    case "launched": {
      const task = row(action.id);
      if (!next.live || task?.status !== "routing") return state;
      Object.assign(task, { status: "working", launch: null, worked: false, space: action.space, tab: action.tab, terminal: action.terminal, own: action.own ?? "tab", agent: action.agent ?? null, tuning: action.tuning || null, error: null });
      event(next, `${task.id} · ${action.agent ?? "agent"} started on ${workspacesOf(task)[0]?.branch ?? "its branch"}${repoNames(task)}.`, task.id);
      ticketUpdate(next, task, "start");
      break;
    }
    case "launchFailed": {
      const task = row(action.id);
      if (!next.live || !task) return state;
      Object.assign(task, { status: "failed", slot: null, launch: null, error: action.error });
      event(next, `${task.id} could not start · ${action.error}`, task.id);
      break;
    }
    case "observe": {
      const task = row(action.id);
      const watched = ["working", "input", "review", "testing"].includes(task?.status) || (task?.status === "failed" && task.reason === "checks");
      if (!next.live || !task || !watched) return state;
      if (task.status === action.status) {
        if (action.status !== "working" || task.worked) return state;
        task.worked = true;
        break;
      }
      if (action.status === "failed") {
        Object.assign(task, { status: "failed", slot: null, reason: null, error: action.error });
        event(next, `${task.id} stopped · ${action.error}`, task.id);
        break;
      }
      if (action.status === "review" && !["working", "input"].includes(task.status)) return state;
      const started = task.worked, checks = action.status === "review" && Boolean(next.check?.command);
      if (task.slot === null || task.slot === undefined) seat(next, task);
      task.status = checks ? "testing" : action.status; task.reason = action.reason ?? null; task.approvals = [];
      if (action.status === "working") task.worked = true;
      if (checks) { task.checkRun = (task.checkRun ?? 0) + 1; task.checked = null; }
      if (task.status === "review") task.slot = null;
      event(next, action.reason === "trust" ? `${task.id} · its agent asks whether to trust the new worktree.` : action.status === "input" ? `${task.id} needs you in its terminal.`
        : checks ? `${task.id} finished · running ${next.check.command}.` : action.status === "review" ? `${task.id} finished · ready for your review.`
        : started ? `${task.id} back to work.` : `${task.id} is working.`, task.id);
      if (task.status === "review") reviewed(next, task);
      break;
    }
    case "check": {
      if (!next.live) return state;
      const command = String(action.command ?? next.check?.command ?? "").trim().slice(0, 500);
      const value = command ? { command, fix: action.fix ?? next.check?.fix ?? true } : null;
      if (JSON.stringify(value) === JSON.stringify(next.check ?? null)) return state;
      next.check = value;
      event(next, value ? `Checks before review: ${command}.` : "No checks before review.");
      break;
    }
    case "tryout": {
      if (!next.live) return state;
      const command = String(action.command ?? "").trim().slice(0, 500) || null;
      if (command === (next.tryout ?? null)) return state;
      next.tryout = command;
      event(next, command ? `Try it: ${command}.` : "No Try it command.");
      break;
    }
    case "tried": {
      const task = row(action.id);
      if (!next.live || !task || task.tried === action.tab) return state;
      task.tried = action.tab;
      break;
    }
    case "checkPassed": {
      const task = row(action.id);
      if (!next.live || task?.status !== "testing" || task.checkRun !== action.run) return state;
      Object.assign(task, { status: "review", slot: null, checked: "passed", checkOutput: action.output ?? "", reason: null });
      event(next, `${task.id} checks passed · ready for your review.`, task.id);
      reviewed(next, task);
      break;
    }
    case "checkFailed": {
      const task = row(action.id);
      if (!next.live || task?.status !== "testing" || task.checkRun !== action.run) return state;
      task.checked = "failed"; task.checkOutput = action.output ?? ""; task.checkRepos = action.repos ?? null;
      const where = task.repos.length > 1 && action.repos?.length ? ` in ${action.repos.join(" + ")}` : "";
      if (action.fix) {
        task.fixes = (task.fixes ?? 0) + 1;
        Object.assign(task, { status: "working", worked: false, reason: null });
        event(next, `${task.id} checks failed${where} · sent the output back to its agent (${task.fixes} of ${CHECK_FIXES}).`, task.id);
      } else {
        Object.assign(task, { status: "failed", reason: "checks", slot: null });
        event(next, `${task.id} checks failed${where} · waiting for you.`, task.id);
      }
      break;
    }
    case "recheck": {
      const task = row(action.id);
      if (!next.live || !next.check?.command || !(task?.status === "review" || (task?.status === "failed" && task.reason === "checks")) || !started(task)) return state;
      seat(next, task);
      Object.assign(task, { status: "testing", reason: null, checked: null, checkRun: (task.checkRun ?? 0) + 1, error: null, approvals: [] });
      event(next, `${task.id} · running ${next.check.command} again.`, task.id);
      break;
    }
    case "reviewAnyway": {
      const task = row(action.id);
      if (!next.live || task?.status !== "failed" || task.reason !== "checks") return state;
      Object.assign(task, { status: "review", reason: null });
      event(next, `${task.id} moved to review with failing checks.`, task.id);
      break;
    }
    case "fixing": {
      const task = row(action.id);
      if (!next.live || task?.status !== "failed" || task.reason !== "checks") return state;
      seat(next, task);
      Object.assign(task, { status: "working", reason: null, worked: false });
      event(next, `${task.id} · sent the check output to its agent.`, task.id);
      break;
    }
    case "autoTrust": if (!next.live) return state; next.autoTrust = !next.autoTrust; break;
    case "trusted": {
      const task = row(action.id);
      if (!next.live || !task) return state;
      if (task.status === "input" && task.reason === "trust") { task.status = "working"; task.reason = null; }
      event(next, `${task.id} · trusted its new worktree${action.manual ? "" : " automatically"}.`, task.id);
      break;
    }
    case "deliver": {
      const value = action.value === "pr" ? "pr" : "merge";
      if (!next.live || next.delivery === value) return state;
      next.delivery = value;
      event(next, value === "pr" ? "Finished work opens a pull request." : "Finished work merges locally.");
      break;
    }
    case "autoPr": {
      const value = action.value ?? !next.autoPr;
      if (!next.live || Boolean(next.autoPr) === Boolean(value)) return state;
      next.autoPr = Boolean(value);
      event(next, next.autoPr ? "Pull requests open as soon as work is ready for review." : "Pull requests wait for you to open them.");
      break;
    }
    case "autoMerge": {
      const value = action.value ?? !next.autoMerge;
      if (!next.live || Boolean(next.autoMerge) === Boolean(value)) return state;
      next.autoMerge = Boolean(value);
      event(next, next.autoMerge ? "Finished work merges as soon as it is ready for review." : "Finished work waits for you to merge it.");
      break;
    }
    case "pushAfterMerge": {
      const value = action.value ?? !next.pushAfterMerge;
      if (!next.live || Boolean(next.pushAfterMerge) === Boolean(value)) return state;
      next.pushAfterMerge = Boolean(value);
      event(next, next.pushAfterMerge ? "Merged work is pushed to origin after each merge." : "Merged work stays local until you push it.");
      break;
    }
    case "pushNow": {
      const waiting = (next.unpushed ?? []).filter(entry => !entry.retry);
      if (!next.live || !waiting.length) return state;
      for (const entry of waiting) entry.retry = true;
      event(next, `Pushing ${unpushedLabel({ ...next, unpushed: waiting })} to ${[...new Set(waiting.map(entry => entry.remote))].join(" + ")} again.`);
      break;
    }
    case "pushed": {
      if (!next.live || !action.results?.length) return state;
      recordPushes(next, null, action.results);
      for (const result of action.results) event(next, result.pushed ? `Pushed ${result.branch} to ${result.remote || "origin"}.`
        : `${result.branch} not pushed · ${String(result.error || "Git could not push.").slice(0, 300)}`);
      break;
    }
    case "prOpened": {
      const task = row(action.id), opened = Object.entries(action.prs ?? {});
      if (!next.live || task?.status !== "merging" || !opened.length) return state;
      const prs = { ...task.prs };
      for (const [name, pr] of opened) prs[name] = { url: pr.url, number: pr.number };
      Object.assign(task, { status: "pr", merge: false, commit: false, error: null, prs });
      event(next, task.repos.length > 1 ? `${task.id} · pull requests open: ${prList(prs)}. It finishes when every one is merged on GitHub.`
        : `${task.id} · pull request #${opened[0][1].number} opened. It finishes when it's merged on GitHub.`, task.id);
      ticketUpdate(next, task, "link");
      break;
    }
    case "prStatus": {
      const task = row(action.id), pr = task?.prs?.[action.repo];
      if (!next.live || task?.status !== "pr" || !pr || pr.url !== action.url || !action.status) return state;
      if (JSON.stringify(pr.status ?? null) === JSON.stringify(action.status)) return state;
      task.prs = { ...task.prs, [action.repo]: { ...pr, status: action.status } };
      break;
    }
    case "prMerged": {
      const task = row(action.id), pr = task?.prs?.[action.repo];
      if (!next.live || task?.status !== "pr" || !pr || pr.url !== action.url || pr.merged) return state;
      task.prs = { ...task.prs, [action.repo]: { ...pr, merged: true } };
      const open = Object.fromEntries(Object.entries(task.prs).filter(([, other]) => !other.merged));
      if (Object.keys(open).length) { event(next, `${task.id} · ${action.repo} #${pr.number} merged on GitHub. Waiting for ${prList(open)}.`, task.id); break; }
      Object.assign(task, { status: "done", merge: false, finished: ++next.sequence, error: null });
      event(next, Object.keys(task.prs).length > 1 ? `${task.id} merged on GitHub: ${prList(task.prs)}.`
        : `${task.id} merged into ${task.workspaces?.[action.repo]?.target ?? "the base branch"} on GitHub (#${pr.number}).`, task.id);
      ticketUpdate(next, task, "merge");
      break;
    }
    case "prClosed": {
      const task = row(action.id), pr = task?.prs?.[action.repo];
      if (!next.live || task?.status !== "pr" || !pr || (action.url && pr.url !== action.url)) return state;
      const prs = Object.fromEntries(Object.entries(task.prs).filter(([name]) => name !== action.repo));
      Object.assign(task, { status: "review", approvals: [], prs: Object.keys(prs).length ? prs : null,
        error: task.repos.length > 1 ? `${action.repo}'s pull request #${pr.number} was closed without merging. The others are left as they are; approving again opens a new one for ${action.repo}.`
          : `Pull request #${pr.number} was closed without merging.` });
      event(next, `${task.id} · ${task.repos.length > 1 ? `${action.repo}'s ` : ""}pull request closed without merging.`, task.id);
      break;
    }
    case "merged": {
      const task = row(action.id);
      if (!next.live || task?.status !== "merging") return state;
      Object.assign(task, { status: "done", merge: false, commit: false, finished: ++next.sequence, error: null, target: action.target ?? null });
      recordPushes(next, task, action.pushes);
      event(next, `${task.id} merged into ${action.target}${pushEvent(action.pushes?.length ? pushNote(task) : null)}`.replace(/\.*$/, "."), task.id);
      ticketUpdate(next, task, "merge");
      break;
    }
    case "mergeFailed": {
      const task = row(action.id);
      if (!next.live || task?.status !== "merging") return state;
      Object.assign(task, { status: "review", merge: false, commit: false, approvals: [], error: action.error });
      event(next, `${task.id} not merged · ${action.error}`, task.id);
      break;
    }
    case "cleaned": {
      const task = row(action.id);
      if (!next.live || !task) return state;
      Object.assign(task, { workspaces: null, planned: null, terminal: null, space: null, tab: null });
      break;
    }
    case "discard": {
      const task = row(action.id);
      if (!next.live || !task || task.discard || ["merging", "pr", "done"].includes(task.status)) return state;
      if (task.status === "queued" && !started(task)) { next.tasks = next.tasks.filter(other => other !== task); event(next, `${task.id} removed.`); unlink(next, task.id); break; }
      task.discard = true;
      event(next, `${task.id} · stopping its agent and deleting its worktree and branch.`, task.id);
      break;
    }
    case "close": {
      if (!next.live) return state;
      next.running = false; next.schedule = null; next.watching = {};
      for (const task of [...next.tasks]) {
        if (task.discard || ["merging", "pr", "done"].includes(task.status)) continue;
        if (task.status === "queued" && !started(task)) { next.tasks = next.tasks.filter(other => other !== task); unlink(next, task.id); }
        else task.discard = true;
      }
      event(next, "Pipeline closed. Stopping its agents and deleting their worktrees and branches.");
      break;
    }
    case "discarded": {
      if (!next.live || !row(action.id)) return state;
      next.tasks = next.tasks.filter(task => task.id !== action.id);
      event(next, `${action.id} discarded.`);
      unlink(next, action.id);
      break;
    }
    case "discardFailed": {
      const task = row(action.id);
      if (!next.live || !task) return state;
      Object.assign(task, { discard: false, error: action.error });
      event(next, `${task.id} could not be discarded · ${action.error}`, task.id);
      break;
    }
    case "repos": {
      const task = row(action.id);
      if (next.live) {
        const names = (next.repositories ?? []).map(repo => repo.name);
        if (task?.status !== "queued" || started(task) || !names.includes(action.repo)) return state;
        const repos = task.repos.includes(action.repo) ? task.repos.filter(repo => repo !== action.repo) : [...task.repos, action.repo];
        if (!repos.length) return state;
        task.repos = names.filter(name => repos.includes(name));
        break;
      }
      if (!task || !["queued", "backlog"].includes(task.status) || !REPOS.includes(action.repo)) return state;
      const repos = task.repos.includes(action.repo) ? task.repos.filter(repo => repo !== action.repo) : [...task.repos, action.repo];
      if (!repos.length) return state;
      task.repos = REPOS.filter(repo => repos.includes(repo));
      break;
    }
    case "addRepository": {
      const path = String(action.path ?? "").trim().replace(/(.)[\\/]+$/, "$1");
      if (!next.live || !path) return state;
      next.repositories ??= [{ name: next.repo, path: next.context.cwd ?? "" }];
      if (next.repositories.some(repo => repo.path === path)) return state;
      const base = folderName(path) || "repository";
      let name = base;
      for (let n = 2; next.repositories.some(repo => repo.name === name); n++) name = `${base}-${n}`;
      next.repositories.push({ name, path });
      event(next, `Tasks can work in ${name} too (${path}).`);
      break;
    }
    case "removeRepository": {
      const index = (next.repositories ?? []).findIndex(repo => repo.name === action.name);
      if (!next.live || index < 1) return state;
      next.repositories.splice(index, 1);
      for (const task of next.tasks.filter(task => task.status === "queued" && !started(task) && task.repos.includes(action.name))) {
        task.repos = task.repos.filter(name => name !== action.name);
        if (!task.repos.length) task.repos = [next.repositories[0].name];
      }
      event(next, `${action.name} removed from the repositories. Work already started there keeps its worktree.`);
      break;
    }
    case "watch":
      next.watch = !next.watch;
      event(next, next.watch ? `Watching ${next.column} for example tasks.` : "Column watch stopped.");
      break;
    case "column": next.column = action.value === "Backlog" ? "Backlog" : "Ready"; break;
    case "arrival": {
      const task = next.tasks.find(row => row.status === "backlog" && row.column !== next.column)
        ?? next.tasks.find(row => row.status === "backlog");
      if (task) { task.column = next.column; event(next, `${task.id} moved to ${next.column}.`, task.id); }
      break;
    }
    case "parallel": next.parallel = Math.max(1, Math.min(6, Math.floor(Number(action.value) || 1))); break;
    case "reviewLimit": next.reviewLimit = Math.max(1, Math.min(10, Math.floor(Number(action.value) || 1))); break;
    case "limits": {
      if (!next.live) return state;
      const read = action.limits ?? {};
      next.limits = { ...(next.limits ?? {}), read: now, error: read.error ? String(read.error).slice(0, 300) : null };
      for (const key of Object.keys(LIMITED)) if (read[key]) next.limits[key] = cleanLimits(read[key]);
      break;
    }
    case "limitHold": {
      const value = action.value === null ? null : Math.max(50, Math.min(100, Math.round(Number(action.value) || LIMIT_HOLD)));
      if (!next.live || limitHold(next) === value) return state;
      next.limitHold = value;
      event(next, value === null ? "Usage limits no longer hold new agents." : `New agents wait while a usage limit is at ${value}% or more.`);
      break;
    }
    case "readLimits": if (!next.live) return state; next.limitsAsked = now; break;
    case "delivery": next.delivery = action.value === "direct" ? "direct" : "pr"; break;
    case "speed": {
      const speed = SPEEDS.includes(action.value) ? action.value : 1;
      for (const task of next.tasks.filter(task => MOVING.includes(task.status))) {
        task.since = now - (now - task.since) * (next.speed || 1) / speed;
      }
      next.speed = speed;
      break;
    }
    case "quota": next.quota = Math.max(0, Math.min(100, Number(action.value) || 0)); break;
    case "reserve": next.reserve = Math.max(0, Math.min(50, Number(action.value) || 0)); break;
    case "fail": next.failNext = true; event(next, "The next example check will fail."); break;
    case "ask": next.askNext = true; event(next, "The next working task will ask you a question."); break;
    case "answer": {
      const task = row(action.id), value = String(action.value ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (task?.status !== "input" || !value) return state;
      task.status = "working"; task.answer = value; task.since = now - (task.held ?? 0.5) * duration(next, "working"); task.held = null;
      event(next, `${task.id} · you answered “${value}”. Back to work.`, task.id);
      break;
    }
    case "approve": {
      const task = row(action.id);
      if (!approve(next, task, action.repo ? [action.repo] : task?.repos ?? [])) return state;
      if (next.live && action.commit) task.commit = true;
      break;
    }
    case "approveAll": if (!next.tasks.reduce((count, task) => count + approve(next, task, task.repos), 0)) return state; break;
    case "retry":
      if (action.id) retry(next, row(action.id));
      else next.tasks.forEach(task => retry(next, task));
      break;
    case "remove": {
      const task = row(action.id);
      if (task?.status !== "queued") return state;
      if (next.live) { if (started(task)) return state; next.tasks = next.tasks.filter(other => other !== task); unlink(next, task.id); }
      else { task.status = "backlog"; task.source = null; }
      break;
    }
    case "reset": return next.live ? state : createPipeline(next.context, now);
    case "tick": {
      if (next.live) return state;
      // The tracker passes the time it was away (sleep, a closed app) so work resumes instead of catching up.
      const pause = Math.max(0, Number(action.pause) || 0);
      const moving = next.tasks.filter(task => MOVING.includes(task.status));
      for (const task of moving) task.since += pause;
      let asked = 0;
      for (const task of moving.filter(task => task.status === "working" && !task.answer && now - task.since >= duration(next, "working") / 2)) {
        if (!task.question && next.askNext) { task.question = ask(QUESTIONS[next.sequence % QUESTIONS.length]); next.askNext = false; }
        if (!task.question) continue;
        task.held = Math.min(1, (now - task.since) / duration(next, "working")); task.status = "input"; asked++;
        event(next, `${task.id} needs you · ${task.question.text}`, task.id);
      }
      const due = moving.filter(task => MOVING.includes(task.status) && now - task.since >= duration(next, task.status));
      if (!due.length && !asked && !(pause && moving.length)) return state;
      for (const task of due) advance(next, task, now);
      break;
    }
    default: return state;
  }
  next.lastTick = now;
  if (next.watch) enqueue(next, next.tasks.filter(task => task.status === "backlog" && task.column === next.column).map(task => task.id), `Watch · ${next.column}`);
  // One integration at a time per repository, including cross-repository tasks.
  const locked = new Set(next.tasks.filter(task => task.status === "merging").flatMap(task => task.repos));
  for (const task of next.tasks) {
    if (task.status !== "review" || task.discard || !(task.delivery === "direct" || task.repos.every(repo => task.approvals.includes(repo)))) continue;
    if (task.repos.some(repo => locked.has(repo))) continue;
    task.status = "merging"; task.since = now; task.repos.forEach(repo => locked.add(repo));
    if (!next.live) { event(next, `${task.id} entering the merge queue.`, task.id); continue; }
    task.merge = true; task.error = null;
    const target = targetOf(task) ?? "your branch";
    event(next, next.delivery === "pr" ? `${task.id} · opening ${task.repos.length > 1 ? "pull requests" : "a pull request"} into ${target}${repoNames(task)}.`
      : `${task.id} · merging into ${target}${repoNames(task)}.`, task.id);
  }
  const picked = [];
  if (next.running && !plannerHolds(next)) {
    const candidates = next.tasks.filter(task => task.status === "queued" && dependencies(next, task).length === 0)
      .sort(startOrder(next));
    for (const task of candidates) {
      if (activeTasks(next).length >= next.parallel) break;
      if (quotaHeld(next, task, now)) continue;
      if (outstandingCount(next) + task.repos.length > next.reviewLimit) continue;
      const used = new Set(activeTasks(next).map(row => row.slot));
      let slot = 0; while (used.has(slot)) slot++;
      task.status = "routing"; task.slot = slot; task.since = now; task.attempts++; task.approvals = [];
      if (task.rank) task.rank = 0;
      if (next.live) { task.launch = null; task.error = null; } else next.quota -= 8;
      picked.push(task.id);
      event(next, `${task.id} entering slot ${slot + 1} · ${task.repos.join(" + ")}`, task.id);
    }
  }
  const was = new Map(state.tasks.map(task => [task.id, task]));
  for (const task of next.tasks) {
    if (task.stalled && task.status !== "working") task.stalled = null;
    const old = was.get(task.id);
    if (!next.live || old?.status === task.status) continue;
    if (old && WORKED.includes(old.status) && old.at) task.spent = (task.spent ?? 0) + Math.max(0, now - old.at);
    task.at = now;
  }
  next.plan = explain(next, picked, now);
  return next;
}
