// A deterministic simulation. This module never starts agents, changes tickets or runs Git.
export const STORE = "pipeline.prototype.v1";
export const VERSION = 3;
export const ACTIVE = ["routing", "working", "input", "testing"];
export const MOVING = ["routing", "working", "testing", "merging"];
export const DURATION = { routing: 2200, working: 9500, testing: 5500, merging: 3500 };
export const SPEEDS = [1, 2, 4];
export const REPOS = ["api", "web", "contracts", "docs"];
export const LABELS = { backlog: "Backlog", queued: "Queued", routing: "Entering pipeline", working: "Implementing", input: "Needs your input", testing: "Running checks", review: "Awaiting approval", merging: "Merging", done: "Done", failed: "Checks failed" };
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

export function migrate(state, now = Date.now()) {
  if (!state || state.version === VERSION) return state;
  if (![1, 2].includes(state.version) || !Array.isArray(state.tasks)) return createPipeline(state.context ?? {}, now);
  const questions = new Map(CATALOG.map(item => [item.id, item.question]));
  return { ...state, version: VERSION, speed: state.speed ?? 1, created: state.created ?? 0, generated: state.generated ?? 0, askNext: false, lastTick: now,
    tasks: state.tasks.map(({ elapsed = 0, ...task }) => ({ ...task, since: task.since ?? now - elapsed,
      question: task.question ?? ask(questions.get(task.id)), answer: task.answer ?? null, held: task.held ?? null })) };
}

export const duration = (state, status) => (DURATION[status] ?? 0) / (state.speed || 1);
export const progress = (state, task, now = Date.now()) => task.status === "input" ? task.held ?? 0 : MOVING.includes(task.status)
  ? Math.max(0, Math.min(1, (now - task.since) / duration(state, task.status))) : 0;

function event(state, message, task = null) {
  state.events = [{ id: ++state.sequence, message, task }, ...state.events].slice(0, 40);
}
export const activeTasks = state => state.tasks.filter(task => ACTIVE.includes(task.status));
export const outstanding = state => state.tasks.filter(task => [...ACTIVE, "review", "merging"].includes(task.status));
export const outstandingCount = state => outstanding(state).reduce((count, task) => count + task.repos.length, 0);
export const dependencies = (state, task) => task.depends.filter(id => state.tasks.find(row => row.id === id)?.status !== "done");
export const needsInput = task => task.status === "input";
export const needsApproval = task => task.status === "review" && task.delivery !== "direct" && task.repos.some(repo => !task.approvals.includes(repo));
export const quotaHeld = state => state.quota - 8 < state.reserve;
export function waitingReason(state, task) {
  const waits = dependencies(state, task);
  if (waits.length) return `Waiting for ${waits.join(", ")} to merge`;
  if (!state.running) return "Intake paused";
  if (quotaHeld(state)) return "Waiting for quota above the reserve";
  if (outstandingCount(state) + task.repos.length > state.reviewLimit) return "Outstanding PR limit reached";
  if (activeTasks(state).length >= state.parallel) return "Waiting for a work slot";
  return "Ready for the planner";
}
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
  if (picked.length) return `Launched ${picked.join(" + ")} by priority.${holding || " They can proceed independently."}`;
  if (asking.length) return `${asking.join(", ")} ${asking.length === 1 ? "is paused until you answer. Its slot stays" : "are paused until you answer. Their slots stay"} reserved.`;
  if (!state.running) return outstanding(state).length ? "Intake paused. Active work and approved merges can finish." : "Ready. Start the pipeline and the planner picks independent work first.";
  if (ready.length && quotaHeld(state)) return `Holding new work to protect your quota reserve. Reset the example quota to resume.${holding}`;
  if (ready.length) return `${ready[0].id}: ${waitingReason(state, ready[0])}.${reviews ? ` ${reviews} task${reviews === 1 ? "" : "s"} awaiting your approval.` : ""}${holding}`;
  if (held.length) return holding.trim();
  if (outstanding(state).length) return `All queued work is in flight.${reviews ? ` ${reviews} task${reviews === 1 ? "" : "s"} awaiting your approval.` : ""}`;
  return state.watch ? `Queue clear. Watching ${state.column} for the next task.` : "Queue clear. Add tasks to keep the planner busy.";
}

// All mutations go through one reducer; multiple views share one pipeline.
export function reduce(state, action, now = Date.now()) {
  const next = JSON.parse(JSON.stringify(state));
  const row = id => next.tasks.find(task => task.id === id);
  switch (action.type) {
    case "run":
      next.running = !next.running;
      event(next, next.running ? "Planner started. Looking for independent work." : "Intake paused. Active work will finish.");
      break;
    case "add": enqueue(next, action.ids ?? [], "Picked"); break;
    case "addAll": enqueue(next, next.tasks.filter(task => task.status === "backlog").map(task => task.id), "Picked"); break;
    case "create": {
      const title = String(action.title ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
      if (!title) return state;
      next.created = (next.created ?? 0) + 1;
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
      if (task?.status === "queued") { task.status = "backlog"; task.source = null; }
      break;
    }
    case "reset": return createPipeline(next.context, now);
    case "tick": {
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
      next.quota -= 8; picked.push(task.id);
      event(next, `${task.id} entering slot ${slot + 1} · ${task.repos.join(" + ")}`, task.id);
    }
  }
  next.plan = explain(next, picked);
  return next;
}
