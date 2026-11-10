import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const model = await import(`data:text/javascript,${encodeURIComponent(await readFile(new URL("../mods/pipeline/pipeline-model.js", import.meta.url), "utf8"))}`);
globalThis.__pipelineLiveModel = model;
const liveSource = (await readFile(new URL("../mods/pipeline/pipeline-live.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
const live = await import(`data:text/javascript,${encodeURIComponent(`const { STORE, SOURCES, newer, reduce, CHECK_FIXES, agentRun, tuningFor, tuningLabel } = globalThis.__pipelineLiveModel;\n${liveSource}`)}`);
const { STORE, LIVE, createLive, createPipeline, reduce, activeTasks } = model;
const context = { id: "project", name: "shop", cwd: "/work/shop", on: null };
const id = `${LIVE}project`;
const row = (state, taskId) => state.tasks.find(task => task.id === taskId);

function host(state, overrides = {}) {
  const world = { store: { [id]: state }, calls: [], agents: [], terminals: [], panes: [], spaces: [], started: [], scripts: [] };
  world.host = {
    shared: key => key === STORE ? world.store : undefined, setShared: (_key, value) => { world.store = value; },
    agents: () => world.agents, terminals: () => world.terminals, panes: () => world.panes, now: () => 1000,
    run: (name, args) => world.calls.push([name, args]),
    knownAgents: async () => [{ name: "Codex", run: ["codex"], installed: false }, { key: "claude", name: "Claude Code", run: ["claude"], installed: true }],
    async worktree(_context, payload) {
      world.scripts.push(["worktree", payload]);
      if (payload.op === "inspect") return { base: "a".repeat(40), branch: "main", workspaces: [{ root: `/wt/${payload.tickets[0].key}`, branch: `pipeline/${payload.tickets[0].key}-abc` }] };
      return { root: `/wt/${payload.ticket.key}`, cwd: `/wt/${payload.ticket.key}`, branch: `pipeline/${payload.ticket.key}-abc` };
    },
    async delivery(_context, payload) { world.scripts.push(["delivery", payload]); return { target: "main" }; },
    start: (_context, task, workspace, agent, space) => { world.started.push({ task: task.id, workspace, agent: agent.name, space }); return space ? "tab" : "space"; },
    keys: async (terminal, keys) => world.calls.push(["keys", terminal, ...keys]),
    locate: async () => ({ space: "s9", tab: "tb9", terminal: "t9" }),
    ...overrides,
  };
  world.state = () => world.store[id];
  return world;
}
async function step(runner) {
  let job;
  runner.step({ spawn: fn => { job = fn({ sleep: async () => {} }); } });
  await job;
}
const typed = (...titles) => titles.reduce((state, title) => reduce(state, { type: "create", title }, 0), createLive(context, 0));

test("typed live tasks queue for the project's repository and never touch example actions", () => {
  let state = typed("Add a dark mode toggle");
  const task = row(state, "T-1");
  assert.deepEqual([task.status, task.repos, task.source], ["queued", ["shop"], "Typed"]);
  state = reduce(state, { type: "describe", id: "T-1", text: "Use the system preference first." }, 0);
  assert.equal(row(state, "T-1").description, "Use the system preference first.");
  for (const action of [{ type: "generate" }, { type: "speed", value: 4 }, { type: "quota", value: 0 }, { type: "answer", id: "T-1", value: "x" }, { type: "reset" }]) {
    assert.equal(reduce(state, action, 0), state, action.type);
  }
  state = reduce(state, { type: "remove", id: "T-1" }, 0);
  assert.equal(state.tasks.length, 0);
});

test("live dispatch fills parallel slots without spending simulated quota", () => {
  let state = reduce(typed("One", "Two", "Three"), { type: "run" }, 0);
  assert.deepEqual(activeTasks(state).map(task => task.id), ["T-1", "T-2"]);
  assert.equal(state.quota, 100);
  assert.match(state.plan, /Starting agents for T-1 \+ T-2/);
});

test("a launch makes a worktree, starts the chosen agent there and tracks its terminal", async () => {
  const world = host(reduce(typed("Add a dark mode toggle"), { type: "run" }, 0));
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  const task = row(world.state(), "T-1");
  assert.equal(task.status, "working");
  assert.deepEqual([task.terminal, task.space, task.agent], ["t9", "s9", "Claude Code"]);
  assert.equal(task.workspace.branch, "pipeline/T-1-add-a-dark-mode-toggle-abc");
  assert.deepEqual(world.scripts.map(([, payload]) => payload.op), ["inspect", "create"]);
  assert.equal(world.scripts[0][1].provider, "pipeline");
  assert.deepEqual(world.started, [{ task: "T-1", workspace: task.workspace, agent: "Claude Code", space: undefined }]);
  assert.equal(task.own, "space", "without a known space, the agent gets its own");
  assert.match(live.prompt(task, task.workspace), /^Add a dark mode toggle\n\nHerdr Pipeline made an isolated Git worktree[\s\S]*merges it into main\.$/);
});

test("a chosen agent wins over the first installed one, and a missing agent fails the launch clearly", async () => {
  let world = host(reduce(reduce(typed("A"), { type: "agent", value: { name: "Codex", run: ["codex", "--yolo"] } }, 0), { type: "run" }, 0));
  await step(new live.LiveRunner(world.host));
  assert.equal(world.started[0].agent, "Codex");
  world = host(reduce(typed("A"), { type: "run" }, 0), { knownAgents: async () => [] });
  await step(new live.LiveRunner(world.host));
  assert.deepEqual([row(world.state(), "T-1").status, row(world.state(), "T-1").slot], ["failed", null]);
  assert.match(row(world.state(), "T-1").error, /No coding agent is installed/);
});

test("a model and effort chosen for an agent are passed as its flags and noted on the task", async () => {
  let state = reduce(typed("A"), { type: "tune", key: "claude", model: " opus ", effort: "high" }, 0);
  assert.equal(model.tuningFor(reduce(state, { type: "tune", key: "claude", effort: "ultra" }, 0), "claude").effort, null, "an effort Claude Code lacks is dropped");
  assert.equal(model.tuningFor(reduce(state, { type: "tune", key: "codex", effort: "ultra" }, 0), "codex").effort, "ultra", "Codex levels come from its own model list");
  const world = host(reduce(state, { type: "run" }, 0), { start: (_c, _t, _w, agent) => { world.run = agent.run; return "space"; } });
  await step(new live.LiveRunner(world.host));
  assert.deepEqual(world.run, ["claude", "--model", "opus", "--effort", "high"]);
  assert.equal(row(world.state(), "T-1").tuning, "opus · high effort");
  assert.deepEqual(model.agentRun(reduce(state, { type: "tune", key: "codex", model: "gpt-5", effort: "xhigh" }, 0), { key: "codex", run: ["codex"] }),
    ["codex", "-m", "gpt-5", "-c", 'model_reasoning_effort="xhigh"']);
  assert.deepEqual(model.agentRun(state, { key: "aider", run: ["aider"] }), ["aider"], "unknown agents start as they are");
});

test("Codex models are read from its own cache, hidden ones left out, in its order", () => {
  const cache = JSON.stringify({ models: [
    { slug: "gpt-b", display_name: "GPT-B", visibility: "list", priority: 2, supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }] },
    { slug: "internal", visibility: "hide", priority: 0 },
    { slug: "gpt-a", display_name: "GPT-A", visibility: "list", priority: 1, supported_reasoning_levels: [{ effort: "ultra" }, { effort: "bad level" }] }] });
  assert.deepEqual(model.codexModels(cache), [{ slug: "gpt-a", name: "GPT-A", efforts: ["ultra"] }, { slug: "gpt-b", name: "GPT-B", efforts: ["low", "high"] }]);
  assert.deepEqual(model.codexModels("not json"), []);
});

test("an unconfirmed start is never replayed after a restart", async () => {
  const state = reduce(typed("A", "B"), { type: "run" }, 0);
  Object.assign(row(state, "T-1"), { launch: "starting" });
  Object.assign(row(state, "T-2"), { launch: "creating", workspace: { root: "/wt/b", cwd: "/wt/b", branch: "pipeline/b", base: "b".repeat(40), target: "main" } });
  const world = host(state);
  const runner = new live.LiveRunner(world.host);
  runner.start();
  assert.equal(row(world.state(), "T-1").status, "failed");
  assert.match(row(world.state(), "T-1").error, /Herdr restarted/);
  await step(runner);
  assert.equal(row(world.state(), "T-2").status, "working", "a launch interrupted before starting resumes with its worktree");
  assert.deepEqual(world.scripts, [], "the existing worktree is reused");
});

test("agent status maps onto the task, and a closed terminal stops it", async () => {
  const world = host(reduce(typed("A"), { type: "run" }, 0));
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  world.panes = [{ terminal: "t9" }];
  const statusAfter = async agent => { world.agents = agent ? [{ address: "t9", status: agent }] : []; await step(runner); return row(world.state(), "T-1"); };
  assert.equal((await statusAfter("idle")).status, "working", "idle before any work is just starting up");
  assert.equal((await statusAfter("blocked")).status, "input");
  assert.equal((await statusAfter("working")).status, "working");
  const review = await statusAfter("idle");
  assert.deepEqual([review.status, review.slot], ["review", null]);
  assert.equal(world.state().tasks.filter(model.needsApproval).length, 1);
  const again = await statusAfter("working");
  assert.deepEqual([again.status, again.slot], ["working", 0], "feedback brings it back into a slot");
  world.panes = [];
  const gone = await statusAfter(null);
  assert.equal(gone.status, "failed");
  assert.match(gone.error, /terminal closed/);
});

test("merging lands the branch, closes the agent's space and removes the worktree", async () => {
  const world = host(reduce(typed("A"), { type: "run" }, 0));
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  world.panes = [{ terminal: "t9" }]; world.agents = [{ address: "t9", status: "working" }];
  await step(runner);
  world.agents = [{ address: "t9", status: "done" }];
  await step(runner);
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "T-1" }, 0) };
  assert.equal(row(world.state(), "T-1").status, "merging");
  world.scripts = [];
  await step(runner);
  const task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.workspace, task.terminal], ["done", null, null]);
  assert.deepEqual(world.scripts.map(([, payload]) => [payload.op, payload.force]), [["merge", undefined], ["remove", false]]);
  assert.equal(world.scripts[0][1].title, "T-1 A");
  assert.deepEqual(world.calls.at(-1), ["space.close", { id: "s9", confirmed: true }]);
  assert.match(world.state().events[0].message + world.state().events[1].message, /merged into main/);
});

test("a refused merge returns the task to review with the reason", async () => {
  const world = host(reduce(typed("A"), { type: "run" }, 0), { delivery: async () => { throw new Error("Your project folder has uncommitted changes on main."); } });
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  world.panes = [{ terminal: "t9" }]; world.agents = [{ address: "t9", status: "working" }];
  await step(runner);
  world.agents = [{ address: "t9", status: "done" }];
  await step(runner);
  world.store = { [id]: reduce(world.state(), { type: "approveAll" }, 0) };
  await step(runner);
  const task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.merge], ["review", false]);
  assert.match(task.error, /uncommitted changes/);
  assert.ok(task.workspace, "nothing is cleaned up");
});

test("discarding stops the agent and force-removes its worktree and branch", async () => {
  const world = host(reduce(typed("A"), { type: "run" }, 0));
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  world.store = { [id]: reduce(world.state(), { type: "discard", id: "T-1" }, 0) };
  world.scripts = [];
  await step(runner);
  assert.equal(world.state().tasks.length, 0);
  assert.deepEqual(world.scripts.map(([, payload]) => [payload.op, payload.force]), [["remove", true]]);
  assert.deepEqual(world.calls.at(-1), ["space.close", { id: "s9", confirmed: true }]);
});

test("a task discarded while its worktree is being made never starts an agent", async () => {
  let world;
  world = host(reduce(typed("A"), { type: "run" }, 0), {
    async worktree(_context, payload) {
      if (payload.op === "inspect") {
        world.store = { [id]: reduce(world.state(), { type: "discard", id: "T-1" }, 0) };
        return { base: "a".repeat(40), branch: "main", workspaces: [{ root: "/wt/a", branch: "pipeline/a" }] };
      }
      throw new Error("must not create");
    },
  });
  await step(new live.LiveRunner(world.host));
  assert.deepEqual(world.started, []);
  assert.equal(row(world.state(), "T-1").planned.branch, "pipeline/a", "a discard can still find what it planned");
});

test("only one job runs at a time", () => {
  const world = host(reduce(typed("A", "B"), { type: "run" }, 0));
  const runner = new live.LiveRunner(world.host);
  const jobs = [];
  runner.step({ spawn: fn => jobs.push(fn) });
  runner.step({ spawn: fn => jobs.push(fn) });
  assert.equal(jobs.length, 1);
});

test("an agent stuck on its folder-trust prompt shows as needing you, and recovers when it starts", async () => {
  const world = host(reduce(typed("A"), { type: "run" }, 0), { read: async () => "Quick safety check: Is this a project you created or one you trust?\n❯ No, exit\n  Yes, I trust this folder" });
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  world.panes = [{ terminal: "t9" }]; world.agents = [{ address: "t9", status: null }];
  const spawned = [];
  runner.step({ spawn: fn => spawned.push(fn()) });
  await Promise.all(spawned);
  const task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.reason], ["input", "trust"]);
  assert.match(world.state().events[0].message, /trust the new worktree/);
  world.agents = [{ address: "t9", status: "working" }];
  await step(runner);
  assert.deepEqual([row(world.state(), "T-1").status, row(world.state(), "T-1").reason], ["working", null]);
});

test("screens are only read for agents that have not reported yet, at most every three seconds", async () => {
  let reads = 0, now = 0;
  const world = host(reduce(typed("A"), { type: "run" }, 0), { read: async () => { reads++; return "starting…"; }, now: () => now });
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  world.panes = [{ terminal: "t9" }];
  const tick = async () => { const spawned = []; runner.step({ spawn: fn => spawned.push(fn({ sleep: async () => {} })) }); await Promise.all(spawned); };
  now = 5000; await tick(); now = 6000; await tick(); now = 8100; await tick();
  assert.equal(reads, 2);
  assert.equal(row(world.state(), "T-1").status, "working");
  world.agents = [{ address: "t9", status: "working" }];
  now = 20000; await tick();
  assert.equal(reads, 2);
});

test("agents open as tabs in the space Start was pressed in, and only that tab closes afterwards", async () => {
  const world = host(reduce(typed("A"), { type: "run", space: "sp-project" }, 0));
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  assert.equal(world.started[0].space, "sp-project");
  assert.equal(row(world.state(), "T-1").own, "tab");
  world.store = { [id]: reduce(world.state(), { type: "discard", id: "T-1" }, 0) };
  await step(runner);
  assert.deepEqual(world.calls.at(-1), ["tab.close", { id: "tb9", confirmed: true }]);
});

test("Trust picks the yes option from wherever the menu's marker is", () => {
  assert.deepEqual(live.trustKeys("Is this a project you trust?\n ❯ No, exit\n   Yes, I trust this folder\n Enter to confirm"), ["down", "enter"]);
  assert.deepEqual(live.trustKeys("> 1. Yes, allow Codex to work in this folder\n  2. No, quit"), ["enter"]);
  assert.equal(live.trustKeys("Working on it…"), null);
});

test("with auto-trust on, the prompt is answered without stopping the task", async () => {
  const screen = "Quick safety check: Is this a project you created or one you trust?\n ❯ No, exit\n   Yes, I trust this folder";
  const world = host(reduce(reduce(typed("A"), { type: "autoTrust" }, 0), { type: "run" }, 0), { read: async () => screen });
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  world.panes = [{ terminal: "t9" }];
  const spawned = [];
  runner.step({ spawn: fn => spawned.push(fn()) });
  await Promise.all(spawned);
  assert.deepEqual(world.calls.at(-1), ["keys", "t9", "down", "enter"]);
  assert.equal(row(world.state(), "T-1").status, "working");
  assert.match(world.state().events[0].message, /trusted its new worktree automatically/);
});

const ticket = (n, extra = {}) => ({ uuid: `plane:p:${n}`, identifier: `HMOD-${n}`, title: `Ticket ${n}`, description: `Do thing ${n}.`, url: `https://plane.test/HMOD-${n}/`,
  status: "Ready", statusType: "unstarted", priority: { name: "High" }, ...extra });

test("Plane tickets queue under their own keys with their description, once while active", () => {
  let state = reduce(createLive(context, 0), { type: "addTickets", provider: "plane", issues: [ticket(31), ticket(32, { priority: { name: "None" } })], source: "Plane" }, 0);
  assert.deepEqual(state.tasks.map(task => [task.id, task.priority, task.source]), [["HMOD-31", 3, "Plane"], ["HMOD-32", 1, "Plane"]]);
  assert.equal(row(state, "HMOD-31").description, "Do thing 31.");
  assert.equal(row(state, "HMOD-31").ticket.url, "https://plane.test/HMOD-31/");
  assert.equal(reduce(state, { type: "addTickets", provider: "plane", issues: [ticket(31)] }, 0), state, "an active ticket is not queued twice");
  row(state, "HMOD-31").status = "done";
  state = reduce(state, { type: "addTickets", provider: "plane", issues: [ticket(31)] }, 0);
  assert.equal(row(state, "HMOD-31-2").title, "Ticket 31", "a finished ticket can be picked again under a fresh id");
  assert.equal(reduce(createLive(context, 0), { type: "addTickets", provider: "plane", issues: [ticket(1)] }, 0).tasks.length, 1);
  assert.equal(reduce(createPipeline(context, 0), { type: "addTickets", provider: "plane", issues: [ticket(1)] }, 0).tasks.length, 8, "the simulation ignores Plane");
});

test("a watched state claims each ticket once, so merged tickets left in it are not queued again", () => {
  let state = reduce(createLive(context, 0), { type: "watchTickets", provider: "plane", state: { id: "ready", name: "Ready" } }, 0);
  assert.match(state.events[0].message, /Watching Plane for tickets in Ready/);
  state = reduce(state, { type: "addTickets", provider: "plane", issues: [ticket(5)], source: "Plane · Ready", watched: true }, 0);
  row(state, "HMOD-5").status = "done";
  assert.equal(reduce(state, { type: "addTickets", provider: "plane", issues: [ticket(5)], watched: true }, 0), state);
  assert.equal(reduce(state, { type: "watchTickets", provider: "plane", state: { id: "ready", name: "Ready" } }, 0), state);
  assert.equal(reduce(state, { type: "watchTickets", provider: "plane", state: null }, 0).watching.plane, null);
});

test("the plan prompt names the ticket and keeps Plane read-only", () => {
  const state = reduce(createLive(context, 0), { type: "addTickets", provider: "plane", issues: [ticket(7)] }, 0);
  const text = live.prompt(row(state, "HMOD-7"), { cwd: "/wt", branch: "pipeline/hmod-7", target: "main", base: "a".repeat(40) });
  assert.match(text, /^Plane ticket HMOD-7: Ticket 7\nhttps:\/\/plane\.test\/HMOD-7\/\n\nDo thing 7\./);
  assert.match(text, /Do not change its Plane status or assignee/);
});

test("the runner polls a watched state about once a minute and reports Plane problems", async () => {
  let now = 0, calls = [];
  const world = host(reduce(createLive(context, 0), { type: "watchTickets", provider: "plane", state: { id: "ready", name: "Ready" } }, 0), {
    now: () => now,
    tickets: async (provider, payload) => { calls.push({ provider, ...payload }); if (calls.length === 2) throw new Error("Plane is unreachable."); return { issues: [ticket(9)] }; },
  });
  const runner = new live.LiveRunner(world.host);
  const tick = async () => { const spawned = []; runner.step({ spawn: fn => spawned.push(fn({ sleep: async () => {} })) }); await Promise.all(spawned); };
  await tick();
  assert.deepEqual(calls[0], { provider: "plane", op: "issues", context: { cwd: "/work/shop", on: null }, state: "ready", scope: "all" });
  assert.equal(row(world.state(), "HMOD-9").source, "Plane · Ready");
  now = 30000; await tick();
  assert.equal(calls.length, 1);
  now = 61000; await tick();
  assert.equal(world.state().sourceErrors.plane, "Plane is unreachable.");
  world.store = { [id]: reduce(world.state(), { type: "watchTickets", provider: "plane", state: { id: "doing", name: "Doing" } }, 0) };
  now = 62000; await tick();
  assert.equal(calls.at(-1).state, "doing", "a new watch polls at once");
  assert.equal(world.state().sourceErrors.plane, null);
});

async function finished(world, runner, results) {
  world.panes = [{ terminal: "t9" }];
  world.agents = [{ address: "t9", status: "working" }]; await step(runner);
  world.agents = [{ address: "t9", status: "done" }];
  const spawned = [];
  runner.step({ spawn: fn => spawned.push(fn({ sleep: async () => {} })) });
  await Promise.all(spawned);
}
const checking = (overrides = {}) => {
  const results = [];
  const world = host(reduce(reduce(typed("A"), { type: "check", command: "npm test" }, 0), { type: "run" }, 0), {
    check: async (_context, cwd, command) => { world.checks.push([cwd, command]); return results.shift() ?? { code: 0, output: "ok" }; },
    send: async (terminal, text) => world.sent.push([terminal, text]), ...overrides });
  world.checks = []; world.sent = [];
  return { world, results };
};

test("a finished agent's work runs the check command in its worktree before review", async () => {
  const { world } = checking();
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  await finished(world, runner);
  assert.deepEqual(world.checks, [["/wt/T-1-a", "npm test"]]);
  const task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.checked, task.slot], ["review", "passed", null]);
  assert.match(world.state().events[0].message, /checks passed · ready for your review/);
});

test("failing checks go back to the agent twice, then stop and wait with the output", async () => {
  const { world, results } = checking();
  results.push({ code: 1, output: "\u001b[31mFAIL\u001b[0m one" }, { code: 1, output: "FAIL two" }, { code: 1, output: "FAIL three" });
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  await finished(world, runner);
  let task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.fixes, task.worked], ["working", 1, false]);
  assert.match(world.sent[0][1], /^The check command failed after your change:\n\$ npm test\nFAIL one\n/);
  world.agents = [{ address: "t9", status: "done" }];
  await step(runner);
  assert.equal(row(world.state(), "T-1").status, "working", "the stale done from before the message does not count");
  await finished(world, runner);
  await finished(world, runner);
  task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.reason, task.checkOutput, task.slot], ["failed", "checks", "FAIL three", null]);
  assert.equal(world.sent.length, 2);
  world.store = { [id]: reduce(world.state(), { type: "reviewAnyway", id: "T-1" }, 0) };
  assert.equal(row(world.state(), "T-1").status, "review");
  world.store = { [id]: reduce(world.state(), { type: "recheck", id: "T-1" }, 0) };
  assert.deepEqual([row(world.state(), "T-1").status, row(world.state(), "T-1").slot], ["testing", 0]);
});

test("with automatic fixing off, a failing check waits for you, and the agent can still be asked to fix it", async () => {
  const { world, results } = checking();
  world.store = { [id]: reduce(world.state(), { type: "check", fix: false }, 0) };
  results.push({ code: 2, output: "boom" });
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  await finished(world, runner);
  assert.equal(row(world.state(), "T-1").reason, "checks");
  assert.equal(world.sent.length, 0);
  world.store = { [id]: reduce(world.state(), { type: "fixing", id: "T-1" }, 0) };
  assert.deepEqual([row(world.state(), "T-1").status, row(world.state(), "T-1").slot], ["working", 0]);
});

test("a check result is dropped when the agent went back to work meanwhile", async () => {
  let release;
  const { world } = checking({ check: () => new Promise(resolve => { release = resolve; }) });
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  world.panes = [{ terminal: "t9" }];
  world.agents = [{ address: "t9", status: "working" }]; await step(runner);
  world.agents = [{ address: "t9", status: "done" }];
  const spawned = [];
  runner.step({ spawn: fn => spawned.push(fn({ sleep: async () => {} })) });
  assert.equal(row(world.state(), "T-1").status, "testing");
  world.agents = [{ address: "t9", status: "working" }];
  runner.step({ spawn: fn => spawned.push(fn({ sleep: async () => {} })) });
  release({ code: 0, output: "ok" });
  await Promise.all(spawned);
  assert.equal(row(world.state(), "T-1").status, "working");
});

test("check settings are per project and an empty command turns checks off", () => {
  let state = reduce(createLive(context, 0), { type: "check", command: "  make check  " }, 0);
  assert.deepEqual(state.check, { command: "make check", fix: true });
  assert.equal(reduce(state, { type: "check", command: "make check" }, 0), state);
  state = reduce(state, { type: "check", fix: false }, 0);
  assert.deepEqual(state.check, { command: "make check", fix: false });
  assert.equal(reduce(state, { type: "check", command: "" }, 0).check, null);
  assert.equal(live.tail("a\nb\nc", 2), "b\nc");
});

async function reviewed(world, runner) {
  await step(runner);
  world.panes = [{ terminal: "t9" }];
  world.agents = [{ address: "t9", status: "working" }]; await step(runner);
  world.agents = [{ address: "t9", status: "done" }]; await step(runner);
}
const prHost = (github = { state: "OPEN" }) => {
  let now = 0;
  const world = host(reduce(reduce(typed("Add a dark mode toggle"), { type: "deliver", value: "pr" }, 0), { type: "run" }, 0), {
    now: () => now,
    async delivery(_context, payload) {
      world.scripts.push(["delivery", payload]);
      if (payload.op === "publish") return { url: "https://github.com/me/shop/pull/12", number: 12 };
      if (payload.op === "pr_state") return typeof github === "function" ? github() : github;
      return {};
    },
  });
  world.clock = value => { now = value; };
  return world;
};
const settle = async runner => { const spawned = []; runner.step({ spawn: fn => spawned.push(fn({ sleep: async () => {} })) }); await Promise.all(spawned); };

test("with pull request delivery, approving pushes the branch and opens a PR into the start branch", async () => {
  const world = prHost();
  const runner = new live.LiveRunner(world.host);
  await reviewed(world, runner);
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "T-1" }, 0) };
  assert.match(world.state().events[0].message, /opening a pull request into main/);
  world.scripts = [];
  await step(runner);
  const publish = world.scripts[0][1];
  assert.deepEqual([publish.op, publish.target, publish.title, publish.branch], ["publish", "main", "Add a dark mode toggle", "pipeline/T-1-add-a-dark-mode-toggle-abc"]);
  assert.match(publish.body, /^Add a dark mode toggle\n\nOpened by Herdr Pipeline from pipeline\//);
  const task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.merge, task.pr], ["pr", false, { url: "https://github.com/me/shop/pull/12", number: 12 }]);
  assert.ok(task.workspace && task.terminal, "nothing is cleaned up while the PR is open");
});

test("a merged PR finishes the task and cleans up; a closed one returns it to review", async () => {
  let github = { state: "OPEN" };
  const world = prHost(() => github);
  const runner = new live.LiveRunner(world.host);
  await reviewed(world, runner);
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "T-1" }, 0) };
  await step(runner);
  world.scripts = [];
  world.clock(1000); await settle(runner);
  assert.equal(row(world.state(), "T-1").status, "pr");
  world.clock(30000); await settle(runner);
  assert.equal(world.scripts.filter(([, payload]) => payload.op === "pr_state").length, 1, "asked once a minute");
  github = { state: "MERGED" };
  world.clock(62000); await settle(runner);
  const task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.workspace, task.terminal], ["done", null, null]);
  assert.deepEqual(world.scripts.at(-1)[1].op === "remove" && world.scripts.at(-1)[1].force, true, "the merged branch is deleted locally");
  assert.match(world.state().events.find(event => /merged into/.test(event.message)).message, /merged into main on GitHub \(#12\)/);

  github = { state: "CLOSED" };
  const closed = prHost(() => github);
  const again = new live.LiveRunner(closed.host);
  await reviewed(closed, again);
  closed.store = { [id]: reduce(closed.state(), { type: "approve", id: "T-1" }, 0) };
  await step(again);
  closed.clock(1000); await settle(again);
  const back = row(closed.state(), "T-1");
  assert.deepEqual([back.status, back.pr, back.error], ["review", null, "Pull request #12 was closed without merging."]);
});

test("a refused publish stays in review with gh's reason", async () => {
  const world = prHost();
  world.host.delivery = async (_context, payload) => { if (payload.op === "publish") throw new Error("The GitHub CLI (gh) isn't installed here."); return {}; };
  const runner = new live.LiveRunner(world.host);
  await reviewed(world, runner);
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "T-1" }, 0) };
  await step(runner);
  assert.deepEqual([row(world.state(), "T-1").status, row(world.state(), "T-1").error], ["review", "The GitHub CLI (gh) isn't installed here."]);
});

test("Plane tasks title their PR with the ticket key and link the ticket", async () => {
  const world = prHost();
  world.store = { [id]: reduce(reduce(createLive(context, 0), { type: "deliver", value: "pr" }, 0), { type: "addTickets", provider: "plane", issues: [{ uuid: "plane:p:4", identifier: "HMOD-4", title: "Fix login", description: "Details.", url: "https://plane.test/HMOD-4/", status: "Ready", priority: { name: "High" } }] }, 0) };
  world.store = { [id]: reduce(world.state(), { type: "run" }, 0) };
  const runner = new live.LiveRunner(world.host);
  await reviewed(world, runner);
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "HMOD-4" }, 0) };
  world.scripts = [];
  await step(runner);
  assert.equal(world.scripts[0][1].title, "HMOD-4: Fix login");
  assert.match(world.scripts[0][1].body, /^Details\.\n\nPlane: https:\/\/plane\.test\/HMOD-4\//);
  assert.equal(reduce(world.state(), { type: "deliver", value: "pr" }, 0), world.state());
});

test("with pull requests opening automatically, finished work pushes without waiting for approval", async () => {
  const world = prHost();
  world.store = { [id]: reduce(world.state(), { type: "autoPr" }, 0) };
  const runner = new live.LiveRunner(world.host);
  await reviewed(world, runner);
  assert.equal(row(world.state(), "T-1").status, "pr");
  assert.equal(world.scripts.filter(([, payload]) => payload.op === "publish").length, 1);
  assert.ok(world.state().events.some(event => /opening a pull request into main/.test(event.message)));

  let state = reduce(reduce(reduce(typed("A"), { type: "deliver", value: "pr" }, 0), { type: "autoPr" }, 0), { type: "check", command: "npm test", fix: false }, 0);
  state = reduce(state, { type: "run" }, 0);
  const task = row(state, "T-1");
  Object.assign(task, { status: "testing", checkRun: 1, workspace: { root: "/wt/T-1", branch: "b", base: "a", target: "main" } });
  assert.equal(row(reduce(state, { type: "checkPassed", id: "T-1", run: 1 }, 0), "T-1").status, "merging");
  const failed = reduce(state, { type: "checkFailed", id: "T-1", run: 1, fix: false }, 0);
  assert.equal(row(reduce(failed, { type: "reviewAnyway", id: "T-1" }, 0), "T-1").status, "review", "failing checks still wait for you");
  assert.equal(reduce(createLive(context, 0), { type: "autoPr", value: false }, 0).autoPr, undefined);
});

test("a PR opened before the pr status existed is read as open", () => {
  const state = typed("A");
  Object.assign(row(state, "T-1"), { status: "merging", merge: false, pr: { url: "https://github.com/me/shop/pull/3", number: 3 } });
  assert.equal(row(model.migrate(state), "T-1").status, "pr");
  const settled = model.migrate(state);
  assert.equal(model.migrate(settled), settled);
});

test("Linear tickets queue with their provider, and the prompt keeps Linear read-only", () => {
  const issue = { uuid: "u-7", identifier: "PRO-7", title: "Ship it", description: "Full text.", url: "https://linear.test/PRO-7", status: "Todo", priority: { name: "Urgent" } };
  const state = reduce(createLive(context, 0), { type: "addTickets", provider: "linear", issues: [issue] }, 0);
  assert.deepEqual(row(state, "PRO-7").ticket, { provider: "linear", uuid: "u-7", key: "PRO-7", url: "https://linear.test/PRO-7", status: "Todo" });
  assert.equal(row(state, "PRO-7").source, "Linear");
  assert.equal(reduce(createLive(context, 0), { type: "addTickets", provider: "jira", issues: [issue] }, 0).tasks.length, 0);
  const text = live.prompt(row(state, "PRO-7"), { cwd: "/wt", branch: "pipeline/pro-7", target: "main", base: "a".repeat(40) });
  assert.match(text, /^Linear ticket PRO-7: Ship it\nhttps:\/\/linear\.test\/PRO-7\n\nFull text\./);
  assert.match(text, /Do not change its Linear status or assignee/);
});

test("a watched Linear state polls with its filter, reads only unseen tickets in full, and keeps Plane separate", async () => {
  let now = 0;
  const calls = [], described = [];
  const filter = { scope: "mine", project: { id: "p1", name: "Herdr" }, label: "My tickets · Herdr" };
  let state = reduce(createLive(context, 0), { type: "watchTickets", provider: "linear", state: { id: "Todo", name: "Todo" }, filter }, 0);
  state = reduce(state, { type: "addTickets", provider: "linear", issues: [{ uuid: "u-1", identifier: "PRO-1", title: "Old" }], watched: true }, 0);
  const world = host(state, {
    now: () => now,
    tickets: async (provider, payload) => { calls.push({ provider, ...payload }); return { issues: [{ uuid: "u-1", identifier: "PRO-1", title: "Old" }, { uuid: "u-2", identifier: "PRO-2", title: "New" }] }; },
    describe: async (provider, issues) => { described.push([provider, issues.map(issue => issue.identifier)]); return issues.map(issue => ({ ...issue, description: "Full." })); },
  });
  const runner = new live.LiveRunner(world.host);
  const tick = async () => { const spawned = []; runner.step({ spawn: fn => spawned.push(fn({ sleep: async () => {} })) }); await Promise.all(spawned); };
  await tick();
  assert.deepEqual(calls, [{ provider: "linear", op: "issues", scope: "mine", project: "p1", state: "Todo" }]);
  assert.deepEqual(described, [["linear", ["PRO-2"]]]);
  assert.equal(row(world.state(), "PRO-2").description, "Full.");
  assert.equal(row(world.state(), "PRO-2").source, "Linear · Todo");
  assert.equal(world.state().watching.plane, undefined);
  world.store = { [id]: reduce(world.state(), { type: "watchTickets", provider: "linear", state: { id: "Todo", name: "Todo" }, filter: { ...filter, scope: "unassigned" } }, 0) };
  now = 1000; await tick();
  assert.equal(calls.at(-1).scope, "unassigned", "a changed filter polls at once");
});

test("saved version 3 live pipelines move Plane fields onto the ticket", () => {
  const old = { ...createLive(context, 0), version: 3, watching: undefined, sourceErrors: undefined, watchPlane: { id: "ready", name: "Ready" }, planeError: "Down." };
  old.tasks = [{ id: "HMOD-1", title: "Fix", status: "queued", plane: { uuid: "plane:p:1", key: "HMOD-1", url: "https://plane.test/", status: "Ready" } }];
  const state = model.migrate(old, 0);
  assert.equal(state.version, model.VERSION);
  assert.deepEqual(state.watching, { plane: { id: "ready", name: "Ready" } });
  assert.deepEqual(state.sourceErrors, { plane: "Down." });
  assert.deepEqual(row(state, "HMOD-1").ticket, { provider: "plane", uuid: "plane:p:1", key: "HMOD-1", url: "https://plane.test/", status: "Ready" });
  assert.ok(!("plane" in row(state, "HMOD-1")) && !("watchPlane" in state));
  old.tasks.push({ id: "T-2", title: "Open", status: "merging", merge: false, pr: { number: 2 } });
  const both = model.migrate(old, 0);
  assert.deepEqual([both.version, row(both, "T-2").status, row(both, "HMOD-1").ticket.provider], [model.VERSION, "pr", "plane"], "both changes land in one pass");
});

test("a save from a newer Pipeline is never reset, changed or run", async () => {
  const future = { ...typed("Keep me"), version: model.VERSION + 1, running: true };
  assert.equal(model.migrate(future, 0), future);
  assert.equal(reduce(future, { type: "create", title: "Another" }, 0), future);
  const world = host(future);
  const runner = new live.LiveRunner(world.host);
  runner.step({ spawn: () => assert.fail("nothing runs for a newer save") });
  assert.equal(world.state(), future);
  assert.deepEqual(world.started, []);
});
