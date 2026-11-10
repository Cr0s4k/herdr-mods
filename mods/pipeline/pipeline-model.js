// A deterministic simulation. This module never starts agents, changes tickets or runs Git.
export const STORE = "pipeline.prototype.v1";
export const LIVE = "live:";
export const VERSION = 4;
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
    flags: ({ model, effort }) => [...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : [])] },
  codex: { models: [], efforts: ["low", "medium", "high", "xhigh", "max"], open: true,
    flags: ({ model, effort }) => [...(model ? ["-m", model] : []), ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : [])] },
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
export const agentRun = (state, agent) => [...agent.run, ...(AGENT_OPTIONS[agent.key]?.flags(tuningFor(state, agent.key)) ?? [])];
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

export function createLive(context, now = Date.now()) {
  const repo = (context.cwd ?? "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "project";
  return { version: VERSION, live: true, context, repo, running: false, parallel: 2, reviewLimit: 4, delivery: "merge", agent: null, speed: 1, quota: 100, reserve: 0,
    watch: false, column: "Ready", lastTick: now, sequence: 0, created: 0, events: [], tasks: [], watching: {}, sourceErrors: {},
    plan: "Type a task, then start the pipeline. Each task gets its own agent, branch and worktree." };
}

function ticketed({ watchPlane, planeError, ...state }) {
  return { ...state, version: VERSION, ...(state.live ? { watching: watchPlane ? { plane: watchPlane } : {}, sourceErrors: planeError ? { plane: planeError } : {} } : {}),
    tasks: state.tasks.map(({ plane, ...task }) => plane ? { ...task, ticket: { provider: "plane", ...plane } } : task) };
}

export function migrate(state, now = Date.now()) {
  if (newer(state)) return state;
  if (state?.live && state.tasks?.some(task => task.status === "merging" && task.pr && !task.merge))
    state = { ...state, tasks: state.tasks.map(task => task.status === "merging" && task.pr && !task.merge ? { ...task, status: "pr" } : task) };
  if (!state || state.version === VERSION) return state;
  if (state.version === 3 && Array.isArray(state.tasks)) return ticketed(state);
  if (![1, 2].includes(state.version) || !Array.isArray(state.tasks)) return createPipeline(state.context ?? {}, now);
  const questions = new Map(CATALOG.map(item => [item.id, item.question]));
  return ticketed({ ...state, speed: state.speed ?? 1, created: state.created ?? 0, generated: state.generated ?? 0, askNext: false, lastTick: now,
    tasks: state.tasks.map(({ elapsed = 0, ...task }) => ({ ...task, since: task.since ?? now - elapsed,
      question: task.question ?? ask(questions.get(task.id)), answer: task.answer ?? null, held: task.held ?? null })) });
}

export const duration = (state, status) => (DURATION[status] ?? 0) / (state.speed || 1);
export const progress = (state, task, now = Date.now()) => task.status === "input" ? task.held ?? 0 : MOVING.includes(task.status)
  ? Math.max(0, Math.min(1, (now - task.since) / duration(state, task.status))) : 0;

function event(state, message, task = null) {
  state.events = [{ id: ++state.sequence, message, task }, ...state.events].slice(0, 40);
}
export const activeTasks = state => state.tasks.filter(task => ACTIVE.includes(task.status));
export const outstanding = state => state.tasks.filter(task => [...ACTIVE, "review", "merging", "pr"].includes(task.status));
export const outstandingCount = state => outstanding(state).reduce((count, task) => count + task.repos.length, 0);
export const dependencies = (state, task) => task.depends.filter(id => state.tasks.find(row => row.id === id)?.status !== "done");
export const needsInput = task => task.status === "input";
export const needsApproval = task => task.status === "review" && task.delivery !== "direct" && task.repos.some(repo => !task.approvals.includes(repo));
export const quotaHeld = state => !state.live && state.quota - 8 < state.reserve;
export function waitingReason(state, task) {
  const waits = dependencies(state, task);
  if (waits.length) return `Waiting for ${waits.join(", ")} to merge`;
  if (!state.running) return "Intake paused";
  if (quotaHeld(state)) return "Waiting for quota above the reserve";
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
function approve(state, task, repos) {
  if (state.live) {
    if (task?.status !== "review" || task.merge) return 0;
    task.status = "merging"; task.merge = true; task.error = null;
    event(state, state.delivery === "pr" ? `${task.id} · opening a pull request into ${task.workspace?.target ?? "your branch"}.`
      : `${task.id} · merging into ${task.workspace?.target ?? "your branch"}.`, task.id);
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

function explain(state, picked) {
  const queued = state.tasks.filter(task => task.status === "queued");
  const held = queued.filter(task => dependencies(state, task).length);
  const ready = queued.filter(task => !dependencies(state, task).length);
  const reviews = state.tasks.filter(needsApproval).length;
  const asking = state.tasks.filter(needsInput).map(task => task.id);
  const holding = held.length ? ` Holding ${held.map(task => task.id).join(", ")} until ${held.length === 1 ? "its dependency merges" : "their dependencies merge"}.` : "";
  if (picked.length) return state.live ? `Starting ${picked.length === 1 ? "an agent" : "agents"} for ${picked.join(" + ")}, each in its own worktree.`
    : `Launched ${picked.join(" + ")} by priority.${holding || " They can proceed independently."}`;
  if (asking.length) return state.live ? `${asking.join(", ")} ${asking.length === 1 ? "is" : "are"} waiting for you in ${asking.length === 1 ? "its terminal" : "their terminals"}.`
    : `${asking.join(", ")} ${asking.length === 1 ? "is paused until you answer. Its slot stays" : "are paused until you answer. Their slots stay"} reserved.`;
  if (state.live && !state.running && !state.tasks.length) return "Type a task, then start the pipeline. Each task gets its own agent, branch and worktree.";
  const starts = state.schedule?.start ? ` Starts by itself at ${state.schedule.start}.` : "";
  if (!state.running) return outstanding(state).length ? `Intake paused. Active work and approved merges can finish.${starts}` : starts ? `Ready.${starts}` : "Ready. Start the pipeline and the planner picks independent work first.";
  if (ready.length && quotaHeld(state)) return `Holding new work to protect your quota reserve. Reset the example quota to resume.${holding}`;
  if (ready.length) return `${ready[0].id}: ${waitingReason(state, ready[0])}.${reviews ? ` ${reviews} task${reviews === 1 ? "" : "s"} awaiting your approval.` : ""}${holding}`;
  if (held.length) return holding.trim();
  if (outstanding(state).length) return `All queued work is in flight.${reviews ? ` ${reviews} task${reviews === 1 ? "" : "s"} ${state.live ? "ready for your review" : "awaiting your approval"}.` : ""}`;
  if (state.live) return "Queue clear. Type a task to start another agent.";
  return state.watch ? `Queue clear. Watching ${state.column} for the next task.` : "Queue clear. Add tasks to keep the planner busy.";
}

// All mutations go through one reducer; multiple views share one pipeline.
const liveTask = (state, fields, source) => ({ ...fresh({ repos: [state.repo], priority: 2, depends: [], column: "Ready", description: "", ...fields }, "queued", source),
  workspace: null, planned: null, terminal: null, space: null, launch: null, worked: false, merge: false, discard: false, error: null });
const PRIORITIES = { Urgent: 4, High: 3, Medium: 2, Low: 1 };
export const CHECK_FIXES = 2;
function seat(state, task) {
  const used = new Set(state.tasks.filter(other => other !== task && ACTIVE.includes(other.status)).map(other => other.slot));
  task.slot = 0; while (used.has(task.slot)) task.slot++;
}
function reviewed(state, task) {
  if (state.delivery === "pr" && state.autoPr) approve(state, task);
}

const SIMULATED = ["add", "addAll", "generate", "repos", "watch", "column", "arrival", "delivery", "speed", "quota", "reserve", "fail", "ask", "answer"];

export function reduce(state, action, now = Date.now()) {
  if (newer(state)) return state;
  if (state.live && SIMULATED.includes(action.type)) return state;
  const next = JSON.parse(JSON.stringify(state));
  const row = id => next.tasks.find(task => task.id === id);
  switch (action.type) {
    case "run":
      next.running = !next.running;
      if (next.live && action.space) next.space = action.space;
      event(next, next.running ? "Planner started. Looking for independent work." : "Intake paused. Active work will finish.");
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
      const title = String(action.title ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
      if (!title) return state;
      next.created = (next.created ?? 0) + 1;
      if (next.live) {
        const id = `T-${next.created}`;
        next.tasks.push(liveTask(next, { id, title }, "Typed"));
        event(next, `${id} joined the queue.`, id);
        break;
      }
      const id = `NEW-${next.created}`;
      next.tasks.push(fresh({ id, title, repos: guessRepos(title, next.created), priority: 2, depends: [], column: "Ready",
        description: "Created in Pipeline. The simulation picked its repositories from the title; change them while it waits in the queue." }, "backlog", null));
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
          priority: PRIORITIES[issue.priority?.name] ?? 1, ticket: { provider, uuid: issue.uuid, key: issue.identifier, url: issue.url, status: issue.status } }, action.source ?? name));
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
    case "sourceError": {
      const provider = action.provider;
      if (!next.live || !SOURCES[provider] || (next.sourceErrors?.[provider] ?? null) === (action.error ?? null)) return state;
      next.sourceErrors = { ...next.sourceErrors, [provider]: action.error ?? null };
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
      if (action.planned) task.planned = action.planned;
      if (action.workspace) task.workspace = action.workspace;
      break;
    }
    case "launched": {
      const task = row(action.id);
      if (!next.live || task?.status !== "routing") return state;
      Object.assign(task, { status: "working", launch: null, worked: false, space: action.space, tab: action.tab, terminal: action.terminal, own: action.own ?? "tab", agent: action.agent ?? null, tuning: action.tuning || null, error: null });
      event(next, `${task.id} · ${action.agent ?? "agent"} started on ${task.workspace?.branch ?? "its branch"}.`, task.id);
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
      task.status = checks ? "testing" : action.status; task.reason = action.reason ?? null;
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
      task.checked = "failed"; task.checkOutput = action.output ?? "";
      if (action.fix) {
        task.fixes = (task.fixes ?? 0) + 1;
        Object.assign(task, { status: "working", worked: false, reason: null });
        event(next, `${task.id} checks failed · sent the output back to its agent (${task.fixes} of ${CHECK_FIXES}).`, task.id);
      } else {
        Object.assign(task, { status: "failed", reason: "checks", slot: null });
        event(next, `${task.id} checks failed · waiting for you.`, task.id);
      }
      break;
    }
    case "recheck": {
      const task = row(action.id);
      if (!next.live || !next.check?.command || !(task?.status === "review" || (task?.status === "failed" && task.reason === "checks")) || !task.workspace) return state;
      seat(next, task);
      Object.assign(task, { status: "testing", reason: null, checked: null, checkRun: (task.checkRun ?? 0) + 1, error: null });
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
    case "prOpened": {
      const task = row(action.id);
      if (!next.live || task?.status !== "merging") return state;
      Object.assign(task, { status: "pr", merge: false, error: null, pr: { url: action.url, number: action.number } });
      event(next, `${task.id} · pull request #${action.number} opened. It finishes when it's merged on GitHub.`, task.id);
      break;
    }
    case "prClosed": {
      const task = row(action.id);
      if (!next.live || task?.status !== "pr" || !task.pr) return state;
      Object.assign(task, { status: "review", error: `Pull request #${task.pr.number} was closed without merging.`, pr: null });
      event(next, `${task.id} · pull request closed without merging.`, task.id);
      break;
    }
    case "merged": {
      const task = row(action.id);
      if (!next.live || !["merging", "pr"].includes(task?.status)) return state;
      Object.assign(task, { status: "done", merge: false, finished: ++next.sequence, error: null });
      event(next, `${task.id} merged into ${action.target}.`, task.id);
      break;
    }
    case "mergeFailed": {
      const task = row(action.id);
      if (!next.live || task?.status !== "merging") return state;
      Object.assign(task, { status: "review", merge: false, error: action.error });
      event(next, `${task.id} not merged · ${action.error}`, task.id);
      break;
    }
    case "cleaned": {
      const task = row(action.id);
      if (!next.live || !task) return state;
      Object.assign(task, { workspace: null, planned: null, terminal: null, space: null, tab: null });
      break;
    }
    case "discard": {
      const task = row(action.id);
      if (!next.live || !task || task.discard || ["merging", "pr", "done"].includes(task.status)) return state;
      if (task.status === "queued" && !task.workspace) { next.tasks = next.tasks.filter(other => other !== task); event(next, `${task.id} removed.`); break; }
      task.discard = true;
      event(next, `${task.id} · stopping its agent and deleting its worktree and branch.`, task.id);
      break;
    }
    case "discarded": {
      if (!next.live || !row(action.id)) return state;
      next.tasks = next.tasks.filter(task => task.id !== action.id);
      event(next, `${action.id} discarded.`);
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
      if (!task || !["queued", "backlog"].includes(task.status) || !REPOS.includes(action.repo)) return state;
      const repos = task.repos.includes(action.repo) ? task.repos.filter(repo => repo !== action.repo) : [...task.repos, action.repo];
      if (!repos.length) return state;
      task.repos = REPOS.filter(repo => repos.includes(repo));
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
    case "approve": if (!approve(next, row(action.id), action.repo ? [action.repo] : row(action.id)?.repos ?? [])) return state; break;
    case "approveAll": if (!next.tasks.reduce((count, task) => count + approve(next, task, task.repos), 0)) return state; break;
    case "retry":
      if (action.id) retry(next, row(action.id));
      else next.tasks.forEach(task => retry(next, task));
      break;
    case "remove": {
      const task = row(action.id);
      if (task?.status !== "queued") return state;
      if (next.live) { if (task.workspace) return state; next.tasks = next.tasks.filter(other => other !== task); }
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
  for (const task of next.live ? [] : next.tasks) {
    if (task.status !== "review" || !(task.delivery === "direct" || task.repos.every(repo => task.approvals.includes(repo)))) continue;
    if (task.repos.some(repo => locked.has(repo))) continue;
    task.status = "merging"; task.since = now; task.repos.forEach(repo => locked.add(repo));
    event(next, `${task.id} entering the merge queue.`, task.id);
  }
  const picked = [];
  if (next.running) {
    const candidates = next.tasks.filter(task => task.status === "queued" && dependencies(next, task).length === 0)
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id, undefined, { numeric: true }));
    for (const task of candidates) {
      if (activeTasks(next).length >= next.parallel || quotaHeld(next)) break;
      if (outstandingCount(next) + task.repos.length > next.reviewLimit) continue;
      const used = new Set(activeTasks(next).map(row => row.slot));
      let slot = 0; while (used.has(slot)) slot++;
      task.status = "routing"; task.slot = slot; task.since = now; task.attempts++; task.approvals = [];
      if (next.live) { task.launch = null; task.error = null; } else next.quota -= 8;
      picked.push(task.id);
      event(next, `${task.id} entering slot ${slot + 1} · ${task.repos.join(" + ")}`, task.id);
    }
  }
  next.plan = explain(next, picked);
  return next;
}
