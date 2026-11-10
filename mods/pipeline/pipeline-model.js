// A deterministic simulation. This module never starts agents, changes tickets or runs Git.
export const STORE = "pipeline.prototype.v1";
export const ACTIVE = ["routing", "working", "testing"];
export const LABELS = { backlog: "Backlog", queued: "Queued", routing: "Entering pipeline", working: "Implementing", testing: "Running checks", review: "Awaiting approval", merging: "Merging", done: "Done", failed: "Checks failed" };
export const CATALOG = [
  { id: "DEMO-101", title: "Define the checkout contract", repos: ["contracts", "api"], priority: 3, depends: [], column: "Ready", description: "Agree on request and response types, then update the API schema. The web checkout depends on this contract landing in both repositories." },
  { id: "DEMO-102", title: "Build the checkout endpoint", repos: ["api"], priority: 3, depends: ["DEMO-101"], column: "Ready", description: "Implement the checkout endpoint against the shared contract. Cover validation and idempotency before creating the pull request." },
  { id: "DEMO-103", title: "Connect the checkout screen", repos: ["web", "api"], priority: 2, depends: ["DEMO-102"], column: "Ready", description: "Connect the checkout form to the new endpoint and handle the success response across the web and API repositories." },
  { id: "DEMO-104", title: "Cover the empty cart state", repos: ["web"], priority: 2, depends: [], column: "Ready", description: "Add the empty cart screen, keyboard navigation and an accessible path back to browsing. This can run independently of the API work." },
  { id: "DEMO-105", title: "Document local development", repos: ["docs"], priority: 1, depends: [], column: "Ready", description: "Document how to run the repositories together and add a troubleshooting guide for local setup." },
  { id: "DEMO-106", title: "Add request tracing", repos: ["api"], priority: 2, depends: [], column: "Backlog", description: "Add request identifiers and structured tracing around checkout calls. Include tests for propagation between services." },
  { id: "DEMO-107", title: "Improve order confirmation", repos: ["web"], priority: 1, depends: ["DEMO-103"], column: "Backlog", description: "Show a useful order summary after checkout. Wait for the connected checkout screen to land first." },
  { id: "DEMO-108", title: "Refresh repository setup guides", repos: ["docs", "contracts"], priority: 1, depends: [], column: "Backlog", description: "Keep setup instructions and schema generation examples aligned across the documentation and contracts repositories." },
];

export function createPipeline(context, now = Date.now()) {
  return { version: 1, context, running: false, watch: false, column: "Ready", parallel: 3, reviewLimit: 5, delivery: "pr", quota: 72, reserve: 15,
    lastTick: now, sequence: 0, failNext: false, events: [], plan: "Ready to plan. Start the pipeline to choose independent work.",
    tasks: CATALOG.map((item, index) => ({ ...item, repos: [...item.repos], depends: [...item.depends], status: index < 5 ? "queued" : "backlog", source: index < 5 ? "Picked" : null, slot: null, elapsed: 0, approvals: [], attempts: 0 })) };
}

function event(state, message, task = null) {
  state.events = [{ id: ++state.sequence, message, task }, ...state.events].slice(0, 30);
}
export const activeTasks = state => state.tasks.filter(task => ACTIVE.includes(task.status));
export const outstanding = state => state.tasks.filter(task => [...ACTIVE, "review", "merging"].includes(task.status));
export const outstandingCount = state => outstanding(state).reduce((count, task) => count + task.repos.length, 0);
export const dependencies = (state, task) => task.depends.filter(id => state.tasks.find(row => row.id === id)?.status !== "done");
export function waitingReason(state, task) {
  const waits = dependencies(state, task);
  if (waits.length) return `Waiting for ${waits.join(", ")} to merge`;
  if (!state.running) return "Intake paused";
  if (state.quota - 8 < state.reserve) return "Waiting for quota above the reserve";
  if (outstandingCount(state) + task.repos.length > state.reviewLimit) return "Outstanding PR limit reached";
  if (activeTasks(state).length >= state.parallel) return "Waiting for a work slot";
  return "Ready for the planner";
}

function enqueue(state, ids, source) {
  for (const task of state.tasks) {
    if (!ids.includes(task.id) || task.status !== "backlog") continue;
    task.status = "queued"; task.source = source;
    event(state, `${task.id} joined the queue · ${source}`, task.id);
  }
}

// All mutations go through one reducer; multiple views share one pipeline.
export function reduce(state, action, now = Date.now()) {
  const next = JSON.parse(JSON.stringify(state));
  switch (action.type) {
    case "run":
      next.running = !next.running;
      event(next, next.running ? "Planner started. Looking for independent work." : "Intake paused. Active work will finish.");
      break;
    case "add": enqueue(next, action.ids ?? [], "Picked"); break;
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
    case "quota": next.quota = Math.max(0, Math.min(100, Number(action.value) || 0)); break;
    case "reserve": next.reserve = Math.max(0, Math.min(50, Number(action.value) || 0)); break;
    case "fail": next.failNext = true; event(next, "The next example check will fail."); break;
    case "approve": {
      const task = next.tasks.find(row => row.id === action.id);
      if (task?.status === "review" && task.repos.includes(action.repo) && !task.approvals.includes(action.repo)) {
        task.approvals.push(action.repo); event(next, `${task.id} · ${action.repo} PR approved.`, task.id);
      }
      break;
    }
    case "retry": {
      const task = next.tasks.find(row => row.id === action.id);
      if (task?.status === "failed") { task.status = "queued"; task.elapsed = 0; task.approvals = []; task.error = null; event(next, `${task.id} returned to the queue.`, task.id); }
      break;
    }
    case "remove": {
      const task = next.tasks.find(row => row.id === action.id);
      if (task?.status === "queued") { task.status = "backlog"; task.source = null; }
      break;
    }
    case "reset": return createPipeline(next.context, now);
    case "tick": break;
    default: return state;
  }
  if (next.watch) enqueue(next, next.tasks.filter(task => task.status === "backlog" && task.column === next.column).map(task => task.id), `Watch · ${next.column}`);
  if (action.type === "tick") {
    // No catch-up after app shutdown or sleep. Simulated work resumes from its saved stage.
    const delta = Math.max(0, Math.min(1200, now - next.lastTick));
    if (delta < 500) return state;
    next.lastTick = now;
    for (const task of next.tasks) {
      if (![...ACTIVE, "merging"].includes(task.status)) continue;
      task.elapsed += delta;
      const duration = { routing: 2200, working: 9500, testing: 5500, merging: 3500 }[task.status];
      if (task.elapsed < duration) continue;
      const previous = task.status;
      task.elapsed = 0;
      if (previous === "routing") task.status = "working";
      else if (previous === "working") task.status = "testing";
      else if (previous === "testing") {
        task.slot = null;
        if (next.failNext) {
          task.status = "failed"; task.error = "Example contract test failed. Inspect the task, then retry."; next.failNext = false;
          event(next, `${task.id} needs attention · checks failed.`, task.id);
        } else {
          task.status = "review"; task.delivery = next.delivery;
          event(next, `${task.id} checks passed · ${task.repos.length} example PR${task.repos.length === 1 ? "" : "s"} ready.`, task.id);
        }
      } else if (previous === "merging") { task.status = "done"; event(next, `${task.id} merged across ${task.repos.join(" + ")}.`, task.id); }
    }
  }
  // One integration at a time per repository, including cross-repository tasks.
  const locked = new Set(next.tasks.filter(task => task.status === "merging").flatMap(task => task.repos));
  for (const task of next.tasks) {
    if (task.status !== "review" || !(task.delivery === "direct" || task.repos.every(repo => task.approvals.includes(repo)))) continue;
    if (task.repos.some(repo => locked.has(repo))) continue;
    task.status = "merging"; task.elapsed = 0; task.repos.forEach(repo => locked.add(repo));
    event(next, `${task.id} entering the merge queue.`, task.id);
  }
  const picked = [];
  if (next.running) {
    const candidates = next.tasks.filter(task => task.status === "queued" && dependencies(next, task).length === 0)
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    for (const task of candidates) {
      if (activeTasks(next).length >= next.parallel || next.quota - 8 < next.reserve) break;
      if (outstandingCount(next) + task.repos.length > next.reviewLimit) continue;
      const used = new Set(activeTasks(next).map(row => row.slot));
      let slot = 0; while (used.has(slot)) slot++;
      task.status = "routing"; task.slot = slot; task.elapsed = 0; task.attempts++; task.approvals = [];
      next.quota -= 8; picked.push(task.id);
      event(next, `${task.id} entering slot ${slot + 1} · ${task.repos.join(" + ")}`, task.id);
    }
  }
  const queued = next.tasks.filter(task => task.status === "queued");
  const blocked = queued.filter(task => dependencies(next, task).length);
  if (picked.length) next.plan = `Chose ${picked.join(" + ")} by priority. ${blocked.length ? `Holding ${blocked.map(task => task.id).join(", ")} until dependencies merge.` : "These tasks can proceed independently."}`;
  else if (!next.running) next.plan = "Intake paused. Active tasks and approved merges can finish.";
  else if (queued.length && next.quota - 8 < next.reserve) next.plan = "Holding new work to protect your quota reserve. Reset the example quota to resume.";
  else if (queued.length && outstandingCount(next) >= next.reviewLimit) next.plan = "Holding new work until the outstanding PR count drops. Review a task to continue.";
  else if (queued.length && !activeTasks(next).length) next.plan = `${queued[0].id}: ${waitingReason(next, queued[0])}.`;
  else if (!queued.length && !outstanding(next).length) next.plan = next.watch ? `Queue clear. Watching ${next.column} for the next task.` : "Queue clear. Add tasks or watch a column to continue.";
  return next;
}
