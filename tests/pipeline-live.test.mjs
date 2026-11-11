import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const model = await import(`data:text/javascript,${encodeURIComponent(await readFile(new URL("../mods/pipeline/pipeline-model.js", import.meta.url), "utf8"))}`);
globalThis.__pipelineLiveModel = model;
const liveFile = await readFile(new URL("../mods/pipeline/pipeline-live.js", import.meta.url), "utf8");
const liveImports = liveFile.match(/^import \{([^}]*)\} from "\.\/pipeline-model\.js";/m)[1];
const live = await import(`data:text/javascript,${encodeURIComponent(`const {${liveImports}} = globalThis.__pipelineLiveModel;\n${liveFile.replace(/^import .*;\n/gm, "")}`)}`);
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
    start: (_context, task, workspaces, agent, space) => { world.started.push({ task: task.id, workspaces, agent: agent.name, run: agent.run, space }); return space ? "tab" : "space"; },
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

test("a long typed task keeps its whole text: a short title on the card, everything in its details and the agent's prompt", () => {
  const text = "When adding things to pipeline, texts get cut... think of a nice way to handle this. Maybe split the title from the rest so nothing is lost";
  const state = typed(text), task = row(state, "T-1");
  assert.equal(task.title, "When adding things to pipeline, texts get cut...");
  assert.equal(task.description, text);
  assert.match(state.events[0].message, /T-1 joined the queue · the whole text is in its details\./);
  const ws = { name: "shop", cwd: "/wt", branch: "pipeline/T-1", target: "main", base: "a".repeat(40) };
  assert.ok(live.prompt(task, ws).startsWith(`When adding things to pipeline, texts get cut...\n\n${text}\n\nHerdr Pipeline`));
  const words = model.typedTask(`Make the onboarding flow remember where the person left off and resume there when they come back later`);
  assert.equal(words.title, "Make the onboarding flow remember where the person left off and resume there when they…");
  assert.ok(model.typedTask("x".repeat(300)).title.length <= model.TITLE);
  assert.deepEqual(model.typedTask("  Add   a toggle "), { title: "Add a toggle", description: "" });
});

test("a launch makes a worktree, starts the chosen agent there and tracks its terminal", async () => {
  const world = host(reduce(typed("Add a dark mode toggle"), { type: "run" }, 0));
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  const task = row(world.state(), "T-1");
  assert.equal(task.status, "working");
  assert.deepEqual([task.terminal, task.space, task.agent], ["t9", "s9", "Claude Code"]);
  assert.equal(task.workspaces.shop.branch, "pipeline/T-1-add-a-dark-mode-toggle-abc");
  assert.equal(task.workspaces.shop.source, "/work/shop");
  assert.deepEqual(world.scripts.map(([, payload]) => payload.op), ["inspect", "create"]);
  assert.equal(world.scripts[0][1].provider, "pipeline");
  assert.deepEqual(world.started, [{ task: "T-1", workspaces: model.workspacesOf(task), agent: "Claude Code", run: ["claude"], space: undefined }]);
  assert.equal(task.own, "space", "without a known space, the agent gets its own");
  assert.match(live.prompt(task, model.workspacesOf(task)), /^Add a dark mode toggle\n\nHerdr Pipeline made an isolated Git worktree[\s\S]*merges it into main\.$/);
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
  Object.assign(row(state, "T-2"), { launch: "creating", workspaces: { shop: { root: "/wt/b", cwd: "/wt/b", branch: "pipeline/b", base: "b".repeat(40), target: "main", source: "/work/shop" } } });
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
  assert.deepEqual([task.status, task.workspaces, task.terminal], ["done", null, null]);
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
  assert.ok(task.workspaces, "nothing is cleaned up");
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

test("closing a pipeline stops intake, removes the queue and discards started work, leaving open PRs", async () => {
  let state = reduce(typed("A", "B", "C", "D"), { type: "run" }, 0);
  state = reduce(state, { type: "schedule", start: "9:00" }, 0);
  const world = host(state);
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  state = world.state();
  row(state, "T-2").status = "pr";
  state = reduce(state, { type: "close" }, 0);
  assert.equal(state.running, false);
  assert.equal(state.schedule, null);
  assert.deepEqual(state.tasks.map(task => [task.id, task.discard]), [["T-1", true], ["T-2", false]]);
  assert.equal(reduce(state, { type: "close" }, 0).tasks.length, 2);
  world.store = { [id]: state };
  world.scripts = [];
  await step(runner);
  assert.deepEqual(world.state().tasks.map(task => task.id), ["T-2"]);
  assert.deepEqual(world.scripts.map(([, payload]) => [payload.op, payload.force]), [["remove", true]]);
  const example = reduce(createPipeline(context, 0), { type: "run" }, 0);
  assert.equal(reduce(example, { type: "close" }, 0), example);
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
  assert.equal(row(world.state(), "T-1").planned.shop.branch, "pipeline/a", "a discard can still find what it planned");
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

test("an agent's menu is read off its screen: the question, what it is about, and the keys for each answer", () => {
  const dashes = "╌".repeat(40), rule = "─".repeat(40);
  const permission = ["❯ Run this exact bash command: date > stamp.txt.", "⏺ Writing current date to stamp.txt", rule, " Bash command", "", " Write current date to stamp.txt", dashes,
    " date > stamp.txt", dashes, " Do you want to proceed?", " ❯ 1. Yes", "   2. Yes, and always allow access to qa/ from this project", "   3. No", "", " Esc to cancel · Tab to amend"].join("\n");
  assert.deepEqual(live.screenQuestion(permission), { text: "Do you want to proceed?", context: ["Bash command", "Write current date to stamp.txt", "date > stamp.txt"],
    options: ["Yes", "Yes, and always allow access to qa/ from this project", "No"], marked: 0, typed: -1 });
  assert.deepEqual(live.answerKeys(permission, "No"), ["down", "down", "enter"]);
  assert.deepEqual(live.answerKeys(permission, "Maybe"), null);
  assert.deepEqual(live.replyKeys(permission), ["esc"]);
  const question = [rule, " ☐ Color", "", "Which color do you prefer?", "", "  1. Red", "     The color red", "❯ 2. Blue", "  3. Type something.", rule, "  4. Chat about this", "", "Enter to select · ↑/↓ to navigate · Esc to cancel"].join("\n");
  assert.deepEqual(live.screenQuestion(question), { text: "Which color do you prefer?", context: ["☐ Color"], options: ["Red", "Blue", "Type something.", "Chat about this"], marked: 1, typed: 2 });
  assert.deepEqual(live.answerKeys(question, "Red"), ["up", "enter"]);
  assert.deepEqual(live.replyKeys(question), ["down"]);
  assert.equal(live.screenQuestion("Plan:\n1. Read the code\n2. Fix it\n❯ "), null, "a numbered list without a selection is not a menu");
  assert.deepEqual(live.replyKeys("❯ "), []);
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

test("the Try it command is per project, and its tab closes with the task", async () => {
  let state = reduce(createLive(context, 0), { type: "tryout", command: "  npm run dev  " }, 0);
  assert.equal(state.tryout, "npm run dev");
  assert.equal(reduce(state, { type: "tryout", command: "npm run dev" }, 0), state);
  assert.equal(reduce(state, { type: "tryout", command: "" }, 0).tryout, null);
  assert.equal(reduce(createPipeline(0), { type: "tryout", command: "npm run dev" }, 0).tryout, undefined);
  const world = host(reduce(reduce(state, { type: "create", title: "A" }, 0), { type: "run", space: "sp-project" }, 0));
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  world.store = { [id]: reduce(world.state(), { type: "tried", id: "T-1", tab: "tb-try" }, 0) };
  assert.equal(row(world.state(), "T-1").tried, "tb-try");
  world.store = { [id]: reduce(world.state(), { type: "discard", id: "T-1" }, 0) };
  await step(runner);
  assert.deepEqual(world.calls.filter(call => call[0] === "tab.close").map(call => call[1].id), ["tb-try", "tb9"]);
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
  assert.equal(publish.body, "Add a dark mode toggle", "without a ticket or a description from the agent, the body is just the title");
  assert.equal(publish.commit, false, "leftovers are never committed unless asked");
  const task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.merge, task.prs], ["pr", false, { shop: { url: "https://github.com/me/shop/pull/12", number: 12 } }]);
  assert.ok(task.workspaces && task.terminal, "nothing is cleaned up while the PR is open");
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
  assert.deepEqual([task.status, task.workspaces, task.terminal], ["done", null, null]);
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
  assert.deepEqual([back.status, back.prs, back.error], ["review", null, "Pull request #12 was closed without merging."]);
});

test("an open PR keeps what it waits for from GitHub, without rewriting state when nothing changed", async () => {
  const waiting = { draft: false, mergeable: "MERGEABLE", mergeState: "BLOCKED", review: "REVIEW_REQUIRED", failed: 1, failing: ["test"], pending: 0, passed: 3 };
  let github = { state: "OPEN", status: waiting };
  const world = prHost(() => github);
  const runner = new live.LiveRunner(world.host);
  await reviewed(world, runner);
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "T-1" }, 0) };
  await step(runner);
  world.clock(1000); await settle(runner);
  const task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.prs.shop.status], ["pr", waiting]);
  assert.equal(model.prNeeds(task).label, "Checks failing · 1");
  const before = world.state();
  github = { state: "OPEN", status: { ...waiting } };
  world.clock(62000); await settle(runner);
  assert.equal(world.state(), before, "the same answer leaves the store alone");
  github = { state: "OPEN", status: { ...waiting, failed: 0, failing: [], passed: 4, review: "APPROVED", mergeState: "CLEAN" } };
  world.clock(123000); await settle(runner);
  assert.equal(model.prNeeds(row(world.state(), "T-1")).label, "Ready to merge");
  assert.equal(reduce(world.state(), { type: "prStatus", id: "T-1", repo: "shop", url: "https://github.com/me/shop/pull/99", status: waiting }, 0), world.state(), "another PR's answer is ignored");
});

test("a PR's most pressing need comes first", () => {
  const needs = status => model.prNeeds({ repos: ["shop"], prs: { shop: { number: 3, status: status && { draft: false, mergeable: "MERGEABLE", mergeState: "CLEAN", review: null, failed: 0, failing: [], pending: 0, passed: 0, ...status } } }, workspaces: { shop: { target: "main" } } });
  assert.deepEqual(needs(null), { label: "PR #3 open", tone: "wait" });
  assert.equal(needs({ draft: true, failed: 2 }).label, "Draft · mark it ready");
  assert.deepEqual(needs({ mergeable: "CONFLICTING", failed: 2 }), { label: "Conflicts with main", tone: "blocked" });
  assert.equal(needs({ failed: 2, review: "CHANGES_REQUESTED" }).label, "Checks failing · 2");
  assert.equal(needs({ review: "CHANGES_REQUESTED", pending: 1 }).label, "Changes requested");
  assert.equal(needs({ pending: 2, review: "REVIEW_REQUIRED" }).label, "Checks running · 2");
  assert.equal(needs({ review: "REVIEW_REQUIRED", mergeState: "BLOCKED" }).label, "Waiting for review");
  assert.equal(needs({ mergeState: "BEHIND" }).label, "Behind main");
  assert.equal(needs({ mergeState: "BLOCKED" }).label, "Blocked by branch rules");
  assert.equal(needs({ mergeState: "UNKNOWN" }).label, "GitHub is checking it");
  assert.deepEqual(needs({ review: "APPROVED", passed: 4 }), { label: "Ready to merge", tone: "ready" });
  const list = model.prChecklist({ status: { draft: false, mergeable: "MERGEABLE", mergeState: "BEHIND", review: "APPROVED", failed: 1, failing: ["lint"], pending: 0, passed: 2 } }, "main");
  assert.deepEqual(list.map(item => [item.name, item.value, item.tone]), [["Checks", "1 failing: lint", "blocked"], ["Review", "Approved", "ready"], ["Merge", "Behind main. Update the branch", "wait"]]);
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

test("leftovers stop a publish; Commit them anyway retries with committing allowed, once", async () => {
  const world = prHost(), refused = "The task's worktree has uncommitted changes, so its agent may still be working. Ask it to commit them, or commit them anyway.";
  const publishes = [];
  world.host.delivery = async (_context, payload) => {
    if (payload.op !== "publish") return {};
    publishes.push(payload.commit);
    if (!payload.commit) throw new Error(refused);
    return { url: "https://github.com/me/shop/pull/12", number: 12 };
  };
  const runner = new live.LiveRunner(world.host);
  await reviewed(world, runner);
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "T-1" }, 0) };
  await step(runner);
  assert.deepEqual([row(world.state(), "T-1").status, row(world.state(), "T-1").error], ["review", refused]);
  const asked = reduce(world.state(), { type: "resolving", id: "T-1", ask: "commit" }, 0);
  assert.equal(row(asked, "T-1").error, null);
  assert.match(asked.events[0].message, /asked its agent to commit what it left/);
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "T-1", commit: true }, 0) };
  await step(runner);
  assert.deepEqual(publishes, [false, true]);
  assert.deepEqual([row(world.state(), "T-1").status, row(world.state(), "T-1").commit], ["pr", false], "the permission is spent once the PR opens");
});

test("in pull request mode the prompt hands the branch name and description to the repository's conventions", () => {
  const state = reduce(createLive(context, 0), { type: "addTickets", provider: "plane", issues: [ticket(7)] }, 0), task = row(state, "HMOD-7");
  const ws = { cwd: "/wt", branch: "hmod-7-ticket-7", target: "main", base: "a".repeat(40), prBody: "/repo/.git/worktrees/hmod-7/herdr-pr.md" };
  const text = live.prompt(task, ws, "pr");
  assert.match(text, /Don't push or open a pull request: once the person approves in Pipeline, it pushes the branch and opens one into main\./);
  assert.match(text, /rename the branch with `git branch -m`/);
  assert.match(text, /\/repo\/\.git\/worktrees\/hmod-7\/herdr-pr\.md/);
  assert.match(text, /a few bullets of what changed, and the ticket link\./);
  assert.doesNotMatch(live.prompt(task, ws, "merge"), /herdr-pr\.md|git branch -m/, "a local merge needs neither");
  assert.match(live.prompt(task, { ...ws, prBody: undefined }, "pr"), /git rev-parse --git-path herdr-pr\.md/, "a worktree made before this asks Git for the path");
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
  assert.equal(world.scripts[0][1].body, "Plane: https://plane.test/HMOD-4/", "the fallback body is the ticket link, not the whole ticket");
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
  Object.assign(task, { status: "testing", checkRun: 1, workspaces: { shop: { root: "/wt/T-1", branch: "b", base: "a", target: "main" } } });
  assert.equal(row(reduce(state, { type: "checkPassed", id: "T-1", run: 1 }, 0), "T-1").status, "merging");
  const failed = reduce(state, { type: "checkFailed", id: "T-1", run: 1, fix: false }, 0);
  assert.equal(row(reduce(failed, { type: "reviewAnyway", id: "T-1" }, 0), "T-1").status, "review", "failing checks still wait for you");
  assert.equal(reduce(createLive(context, 0), { type: "autoPr", value: false }, 0).autoPr, undefined);
});

test("with merging automatic, finished work merges without waiting for approval", async () => {
  const world = host(reduce(reduce(typed("A"), { type: "autoMerge" }, 0), { type: "run" }, 0));
  const runner = new live.LiveRunner(world.host);
  await reviewed(world, runner);
  assert.equal(row(world.state(), "T-1").status, "done");
  assert.deepEqual(world.scripts.filter(([kind]) => kind === "delivery").map(([, payload]) => payload.op), ["merge", "remove"]);

  let state = reduce(reduce(typed("A"), { type: "autoMerge" }, 0), { type: "check", command: "npm test", fix: false }, 0);
  state = reduce(state, { type: "run" }, 0);
  Object.assign(row(state, "T-1"), { status: "testing", checkRun: 1, workspaces: { shop: { root: "/wt/T-1", branch: "b", base: "a", target: "main" } } });
  assert.equal(row(reduce(state, { type: "checkPassed", id: "T-1", run: 1 }, 0), "T-1").status, "merging");
  const failed = reduce(state, { type: "checkFailed", id: "T-1", run: 1, fix: false }, 0);
  assert.equal(row(reduce(failed, { type: "reviewAnyway", id: "T-1" }, 0), "T-1").status, "review", "failing checks still wait for you");
  Object.assign(row(state, "T-1"), { status: "merging", merge: true });
  assert.equal(row(reduce(state, { type: "mergeFailed", id: "T-1", error: "dirty" }, 0), "T-1").status, "review", "a refused merge waits for you");
  assert.equal(reduce(createLive(context, 0), { type: "autoMerge", value: false }, 0).autoMerge, undefined);
  assert.equal(reduce(createPipeline(context, 0), { type: "autoMerge" }, 0).autoMerge, undefined);
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
  world.store = { [id]: reduce(world.state(), { type: "watchTickets", provider: "linear", state: { id: "Todo", name: "Todo" }, filter: { scope: "all", team: { id: "acme-id", name: "Acme" }, project: null } }, 0) };
  now = 2000; await tick();
  assert.deepEqual(calls.at(-1), { provider: "linear", op: "issues", scope: "all", team: "acme-id", state: "Todo" });
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

const blocked = (key, ...blockers) => ({ uuid: `u-${key}`, identifier: key, title: `Ticket ${key}`, status: "Todo", blockers });

test("a ticket blocked by another ticket in the pipeline starts once that task merges", () => {
  let state = reduce(createLive(context, 0), { type: "addTickets", provider: "linear", issues: [
    blocked("PRO-2", { key: "PRO-1", title: "Base", closed: false }), blocked("PRO-1")] }, 0);
  state = reduce(state, { type: "run" }, 0);
  assert.deepEqual(activeTasks(state).map(task => task.id), ["PRO-1"]);
  assert.equal(model.waitingReason(state, row(state, "PRO-2")), "Waiting for PRO-1 to merge");
  assert.match(state.plan, /Holding PRO-2 until what it waits for is done/);
  Object.assign(row(state, "PRO-1"), { status: "merging", slot: null });
  state = reduce(state, { type: "merged", id: "PRO-1", target: "main" }, 0);
  assert.equal(row(state, "PRO-2").status, "routing");
});

test("a blocker outside the pipeline holds its task until the tracker says it closed", () => {
  let state = reduce(createLive(context, 0), { type: "addTickets", provider: "linear", issues: [
    blocked("PRO-5", { key: "PRO-9", title: "Elsewhere", closed: false, url: "https://linear.test/PRO-9" }, { key: "PRO-8", closed: true }, { key: null, closed: null })] }, 0);
  state = reduce(state, { type: "run" }, 0);
  assert.equal(row(state, "PRO-5").status, "queued");
  assert.equal(model.waitingReason(state, row(state, "PRO-5")), "Waiting for PRO-9, a ticket Pipeline can't read to close in Linear");
  state = reduce(state, { type: "blockers", id: "PRO-5", blockers: [{ key: "PRO-9", title: "Elsewhere", closed: true }] }, 0);
  assert.equal(row(state, "PRO-5").status, "routing");
  assert.ok(state.events.some(item => item.message === "PRO-5 · PRO-9 closed in Linear."));
  assert.equal(reduce(state, { type: "blockers", id: "PRO-5", blockers: [] }, 0), state, "only queued tasks take new blockers");
});

test("typed tasks can wait for each other, never in a circle, and a removed one frees its dependents", () => {
  let state = typed("Schema", "Endpoint");
  state = reduce(state, { type: "link", id: "T-2", on: "T-1" }, 0);
  assert.deepEqual(row(state, "T-2").depends, ["T-1"]);
  assert.equal(reduce(state, { type: "link", id: "T-1", on: "T-2" }, 0), state, "a circle is refused");
  assert.equal(model.canWaitFor(state, row(state, "T-1"), row(state, "T-2")), false);
  state = reduce(state, { type: "run" }, 0);
  assert.deepEqual(activeTasks(state).map(task => task.id), ["T-1"]);
  state = typed("Schema", "Endpoint");
  state = reduce(reduce(state, { type: "link", id: "T-2", on: "T-1" }, 0), { type: "remove", id: "T-1" }, 0);
  assert.deepEqual(row(state, "T-2").depends, []);
  assert.match(state.events[0].message, /T-2 no longer waits for T-1, which was removed/);
});

test("Start anyway lets a waiting task go, and Wait again holds it once more", () => {
  let state = reduce(createLive(context, 0), { type: "addTickets", provider: "linear", issues: [blocked("PRO-5", { key: "PRO-9", closed: false })] }, 0);
  assert.equal(reduce(typed("A"), { type: "unblock", id: "T-1", value: true }, 0).tasks[0].unblocked, undefined, "nothing to skip");
  state = reduce(state, { type: "unblock", id: "PRO-5", value: true }, 0);
  assert.deepEqual(model.dependencies(state, row(state, "PRO-5")), []);
  state = reduce(state, { type: "unblock", id: "PRO-5", value: false }, 0);
  assert.deepEqual(model.dependencies(state, row(state, "PRO-5")), ["PRO-9"]);
  state = reduce(reduce(state, { type: "unblock", id: "PRO-5", value: true }, 0), { type: "run" }, 0);
  assert.equal(row(state, "PRO-5").status, "routing");
});

test("the runner asks the tracker about outside blockers once a minute, only for tasks waiting on them", async () => {
  let now = 0;
  const asked = [];
  let state = reduce(createLive(context, 0), { type: "addTickets", provider: "linear", issues: [
    blocked("PRO-5", { key: "PRO-9", closed: false }), blocked("PRO-6", { key: "PRO-5", closed: false }), blocked("PRO-7")] }, 0);
  const world = host(state, { now: () => now, blockers: async (provider, issues) => {
    asked.push([provider, issues.map(issue => issue.uuid)]);
    return new Map([["u-PRO-5", [{ key: "PRO-9", closed: asked.length > 1 }]]]);
  } });
  const runner = new live.LiveRunner(world.host);
  const tick = async () => { const spawned = []; runner.step({ spawn: fn => spawned.push(fn({ sleep: async () => {} })) }); await Promise.all(spawned); };
  await tick(); now = 30000; await tick();
  assert.deepEqual(asked, [["linear", ["u-PRO-5"]]]);
  now = 61000; await tick();
  assert.equal(asked.length, 2);
  assert.equal(row(world.state(), "PRO-5").blockers[0].closed, true);
});

test("with pull requests, a task that waited starts from origin so it has its blocker's merge", async () => {
  let state = reduce(typed("Schema", "Endpoint"), { type: "deliver", value: "pr" }, 0);
  state = reduce(state, { type: "link", id: "T-2", on: "T-1" }, 0);
  Object.assign(row(state, "T-1"), { status: "done" });
  let world = host(reduce(state, { type: "run" }, 0));
  await step(new live.LiveRunner(world.host));
  assert.equal(world.scripts[0][1].remote, true);
  world = host(reduce(reduce(typed("Solo"), { type: "deliver", value: "pr" }, 0), { type: "run" }, 0));
  await step(new live.LiveRunner(world.host));
  assert.equal(world.scripts[0][1].remote, undefined, "work that waited for nothing starts from the project folder");
});

const updating = (settings, updateTicket) => {
  const world = prHost(), calls = [];
  let state = reduce(reduce(createLive(context, 0), { type: "deliver", value: "pr" }, 0), { type: "addTickets", provider: "plane", issues: [ticket(4, { title: "Fix login" })] }, 0);
  if (settings) state = reduce(state, { type: "ticketUpdates", provider: "plane", ...settings }, 0);
  world.store = { [id]: reduce(state, { type: "run" }, 0) };
  world.host.updateTicket = async (provider, row, update) => { calls.push([provider, row.uuid, update.kind, update.state?.id ?? update.url, update.title]); return updateTicket ? updateTicket(update, calls) : { changed: true }; };
  world.updates = calls; world.panes = [{ terminal: "t9" }]; world.host.read = async () => "";
  return world;
};

test("ticket updates are off by default, so a ticket's work leaves its tracker alone", async () => {
  const world = updating(null);
  const runner = new live.LiveRunner(world.host);
  await reviewed(world, runner);
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "HMOD-4" }, 0) };
  await settle(runner); await settle(runner);
  assert.equal(row(world.state(), "HMOD-4").status, "pr");
  assert.deepEqual(world.updates, []);
  assert.equal(row(world.state(), "HMOD-4").ticket.pending, undefined);
});

test("ticket update settings are per provider and say what they will do", () => {
  let state = reduce(createLive(context, 0), { type: "ticketUpdates", provider: "plane", start: { id: "doing", name: "In Progress" } }, 0);
  assert.deepEqual(state.ticketUpdates.plane, { start: { id: "doing", name: "In Progress" }, merge: null, link: false });
  assert.match(state.events[0].message, /^Plane tickets move to In Progress when their agent starts\.$/);
  assert.equal(reduce(state, { type: "ticketUpdates", provider: "plane", start: { id: "doing", name: "In Progress" } }, 0), state);
  state = reduce(state, { type: "ticketUpdates", provider: "linear", merge: { id: "Done", name: "Done" }, link: true }, 0);
  assert.match(state.events[0].message, /^Linear tickets move to Done when their work merges and get their pull request linked\.$/);
  state = reduce(state, { type: "ticketUpdates", provider: "plane", start: null }, 0);
  assert.match(state.events[0].message, /no longer updates Plane tickets/);
  assert.equal(reduce(state, { type: "ticketUpdates", provider: "jira", link: true }, 0), state);
  assert.equal(reduce(createPipeline(context, 0), { type: "ticketUpdates", provider: "plane", link: true }, 0).ticketUpdates, undefined);
  const linear = reduce(createLive(context, 0), { type: "addTickets", provider: "linear", issues: [{ uuid: "u-1", identifier: "PRO-1", title: "T", team: "Core" }] }, 0);
  assert.equal(row(linear, "PRO-1").ticket.team, "Core", "Linear states come from the teams of queued tickets");
});

test("a ticket moves when its agent starts, gets its pull request linked, and moves again on merge", async () => {
  let github = { state: "OPEN" };
  const world = updating({ start: { id: "doing", name: "In Progress" }, merge: { id: "done", name: "Done" }, link: true });
  world.host.delivery = async (_context, payload) => payload.op === "publish" ? { url: "https://github.com/me/shop/pull/12", number: 12 } : payload.op === "pr_state" ? github : {};
  const runner = new live.LiveRunner(world.host);
  await settle(runner);
  assert.equal(row(world.state(), "HMOD-4").status, "working");
  await settle(runner);
  assert.deepEqual(world.updates, [["plane", "plane:p:4", "start", "doing", undefined]]);
  let task = row(world.state(), "HMOD-4");
  assert.deepEqual([task.ticket.update.ok, task.ticket.update.text, task.ticket.status, task.ticket.pending], [true, "Moved to In Progress in Plane", "In Progress", []]);
  assert.ok(world.state().events.some(item => item.message === "HMOD-4 · moved to In Progress in Plane."));
  await settle(runner);
  assert.equal(world.updates.length, 1, "a made update is not repeated");
  world.agents = [{ address: "t9", status: "working" }]; await settle(runner);
  world.agents = [{ address: "t9", status: "done" }]; await settle(runner);
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "HMOD-4" }, 0) };
  await settle(runner); await settle(runner);
  assert.deepEqual(world.updates[1], ["plane", "plane:p:4", "link", "https://github.com/me/shop/pull/12", "PR #12: Fix login"]);
  assert.equal(row(world.state(), "HMOD-4").ticket.update.text, "Linked PR #12 in Plane");
  github = { state: "MERGED" }; world.clock(61000);
  await settle(runner); await settle(runner);
  task = row(world.state(), "HMOD-4");
  assert.equal(task.status, "done");
  assert.deepEqual(world.updates[2], ["plane", "plane:p:4", "merge", "done", undefined]);
  assert.equal(task.ticket.update.text, "Moved to Done in Plane");
});

test("a failed update never changes the task, waits for Try again, and a moved ticket isn't moved again on retry", async () => {
  let fail = true;
  const world = updating({ start: { id: "doing", name: "In Progress" } }, () => {
    if (fail) throw Object.assign(new Error("Pipeline needs write access to Linear. Connect a key with Write permission."), { kind: "write_access" });
    return { changed: false };
  });
  const runner = new live.LiveRunner(world.host);
  await settle(runner); await settle(runner);
  let task = row(world.state(), "HMOD-4");
  assert.equal(task.status, "working");
  assert.deepEqual([task.ticket.update.ok, task.ticket.update.errorKind, task.ticket.failed.map(update => update.kind)], [false, "write_access", ["start"]]);
  assert.match(world.state().events[0].message, /^HMOD-4 · couldn't update Plane · Pipeline needs write access/);
  await settle(runner); await settle(runner);
  assert.equal(world.updates.length, 1, "failures are not retried by themselves");
  fail = false;
  world.store = { [id]: reduce(world.state(), { type: "ticketRetry", id: "HMOD-4" }, 0) };
  assert.equal(reduce(world.state(), { type: "ticketRetry", id: "HMOD-4" }, 0), world.state(), "nothing failed is waiting");
  await settle(runner);
  task = row(world.state(), "HMOD-4");
  assert.deepEqual([world.updates.length, task.ticket.update.text, task.ticket.failed], [2, "Already In Progress in Plane", []]);
  let state = reduce(world.state(), { type: "launchFailed", id: "HMOD-4", error: "Closed." }, 0);
  state = reduce(state, { type: "retry", id: "HMOD-4" }, 0);
  assert.equal(row(state, "HMOD-4").status, "routing");
  state = reduce(state, { type: "launched", id: "HMOD-4", space: "s", tab: "t", terminal: "t9" }, 0);
  assert.deepEqual(row(state, "HMOD-4").ticket.pending, [], "a retried task doesn't move its ticket again");
});

test("a result for an update that is no longer pending changes nothing", () => {
  let state = reduce(createLive(context, 0), { type: "addTickets", provider: "plane", issues: [ticket(1)] }, 0);
  state = reduce(state, { type: "ticketUpdates", provider: "plane", start: { id: "doing", name: "Doing" } }, 0);
  assert.equal(reduce(state, { type: "ticketUpdated", id: "HMOD-1", n: 1, ok: true }, 0), state);
  state = reduce(reduce(state, { type: "run" }, 0), { type: "launched", id: "HMOD-1", space: "s", tab: "t", terminal: "t9" }, 0);
  const n = row(state, "HMOD-1").ticket.pending[0].n;
  assert.equal(reduce(state, { type: "ticketUpdated", id: "HMOD-1", n: n + 1, ok: true }, 0), state);
  assert.equal(row(reduce(state, { type: "discarded", id: "HMOD-1" }, 0), "HMOD-1"), undefined);
});

const across = (...titles) => {
  let state = reduce(typed(...titles), { type: "addRepository", path: "/work/api" }, 0);
  for (const task of state.tasks) state = reduce(state, { type: "repos", id: task.id, repo: "api" }, 0);
  return state;
};
const RUN = "abc123abc123";
function multi(state, overrides = {}) {
  const world = host(state, {
    async worktree(at, payload) {
      const repo = at.cwd.split("/").pop(), key = (payload.tickets?.[0] ?? payload.ticket).key, run = payload.runId ?? RUN;
      world.scripts.push(["worktree", { ...payload, at: at.cwd }]);
      if (payload.op === "inspect") return { base: "a".repeat(40), branch: "main", runId: run, workspaces: [{ root: `/wt/${repo}/${key}`, branch: `pipeline/${key}-${run}` }] };
      return { root: `/wt/${repo}/${key}`, cwd: `/wt/${repo}/${key}`, branch: payload.plan.workspaces[0].branch };
    },
    ...overrides,
  });
  return world;
}

test("Live settings keep the project repository first and add others once, with unique names", () => {
  let state = createLive(context, 0);
  assert.deepEqual(state.repositories, [{ name: "shop", path: "/work/shop" }]);
  state = reduce(state, { type: "addRepository", path: "/work/api/" }, 0);
  state = reduce(state, { type: "addRepository", path: "/other/shop" }, 0);
  assert.deepEqual(state.repositories.map(repo => [repo.name, repo.path]), [["shop", "/work/shop"], ["api", "/work/api"], ["shop-2", "/other/shop"]]);
  assert.equal(reduce(state, { type: "addRepository", path: "/work/api" }, 0), state, "a repository is added once");
  assert.equal(reduce(state, { type: "removeRepository", name: "shop" }, 0), state, "the project repository stays");
  assert.equal(reduce(createPipeline(context, 0), { type: "addRepository", path: "/x" }, 0).repositories, undefined);

  state = reduce(state, { type: "create", title: "Checkout" }, 0);
  state = reduce(state, { type: "addTickets", provider: "linear", issues: [{ uuid: "u-1", identifier: "PRO-1", title: "Ticket" }] }, 0);
  assert.deepEqual([row(state, "T-1").repos, row(state, "PRO-1").repos], [["shop"], ["shop"]], "new tasks start with the project repository only");
  state = reduce(reduce(state, { type: "repos", id: "T-1", repo: "api" }, 0), { type: "repos", id: "T-1", repo: "shop-2" }, 0);
  assert.deepEqual(row(state, "T-1").repos, ["shop", "api", "shop-2"]);
  state = reduce(state, { type: "repos", id: "T-1", repo: "shop" }, 0);
  assert.deepEqual(row(state, "T-1").repos, ["api", "shop-2"], "a task may leave the project repository out");
  assert.equal(reduce(state, { type: "repos", id: "T-1", repo: "web" }, 0), state, "only known repositories");
  state = reduce(state, { type: "removeRepository", name: "api" }, 0);
  assert.deepEqual(row(state, "T-1").repos, ["shop-2"], "a removed repository leaves queued tasks");
  state = reduce(state, { type: "removeRepository", name: "shop-2" }, 0);
  assert.deepEqual(row(state, "T-1").repos, ["shop"], "a task left with none falls back to the project");
  assert.equal(reduce(state, { type: "repos", id: "T-1", repo: "shop" }, 0), state, "a task keeps at least one");
});

test("a task across repositories gets a worktree in each on one branch, and its agent opens them all", async () => {
  const world = multi(reduce(across("Add checkout"), { type: "run" }, 0));
  await step(new live.LiveRunner(world.host));
  const task = row(world.state(), "T-1");
  assert.equal(task.status, "working");
  assert.deepEqual(world.scripts.map(([, payload]) => [payload.op, payload.at, payload.runId]),
    [["inspect", "/work/shop", undefined], ["create", "/work/shop", undefined], ["inspect", "/work/api", RUN], ["create", "/work/api", undefined]]);
  assert.deepEqual(Object.keys(task.workspaces), ["shop", "api"]);
  assert.equal(task.workspaces.api.branch, task.workspaces.shop.branch, "the same branch name in each repository");
  assert.equal(task.workspaces.api.source, "/work/api");
  assert.deepEqual(world.started[0].workspaces.map(ws => ws.name), ["shop", "api"], "the agent starts in the first repository");
  assert.deepEqual(world.started[0].run, ["claude", "--add-dir=/wt/api/T-1-add-checkout"]);
  assert.match(live.prompt(task, world.started[0].workspaces), new RegExp(["each repository this task touches, all on the branch pipeline/T-1-add-checkout-abc123abc123:",
    "- shop: /wt/shop/T-1-add-checkout, started from main at aaaaaaa", "- api: /wt/api/T-1-add-checkout, started from main at aaaaaaa", "Your working folder is shop's worktree"].join("\n")));
  assert.match(world.state().events.find(item => /started on/.test(item.message)).message, /pipeline\/T-1-add-checkout-abc123abc123 in shop \+ api\.$/);
  const limited = reduce(reduce(across("A", "B", "C"), { type: "reviewLimit", value: 5 }, 0), { type: "run" }, 0);
  assert.deepEqual([model.outstandingCount(limited), model.waitingReason(limited, row(limited, "T-3"))], [4, "Too many branches waiting for your review"], "the review limit counts repositories");
  assert.deepEqual(model.agentRun(createLive(context, 0), { key: "codex", run: ["codex"] }, ["/wt/x"]), ["codex", "--add-dir=/wt/x"]);
  assert.deepEqual(model.agentRun(createLive(context, 0), { key: "aider", run: ["aider"] }, ["/wt/x"]), ["aider"], "other agents find the paths in their first message");
});

test("a launch that stopped part way reuses the worktrees it made and the same branch name", async () => {
  const state = reduce(reduce(across("A"), { type: "deliver", value: "pr" }, 0), { type: "run" }, 0);
  Object.assign(row(state, "T-1"), { depends: ["T-0"], unblocked: true,
    workspaces: { shop: { root: "/wt/shop/x", cwd: "/wt/shop/x", branch: "pipeline/x-feedfeedfeed", base: "b".repeat(40), target: "main", source: "/work/shop", run: "feedfeedfeed" } } });
  const world = multi(state);
  await step(new live.LiveRunner(world.host));
  assert.deepEqual(world.scripts.map(([, payload]) => [payload.op, payload.at, payload.runId, payload.remote]),
    [["inspect", "/work/api", "feedfeedfeed", true], ["create", "/work/api", undefined, undefined]], "a task that waited fetches every repository from origin");
  assert.equal(row(world.state(), "T-1").status, "working");
});

test("checks run in every repository's worktree, and a failure names the repository", async () => {
  const results = { "/wt/shop/T-1-a": { code: 0, output: "shop ok" }, "/wt/api/T-1-a": { code: 1, output: "FAIL api" } };
  const world = multi(reduce(reduce(across("A"), { type: "check", command: "npm test" }, 0), { type: "run" }, 0), {
    check: async (_context, cwd) => { world.checks.push(cwd); return results[cwd]; }, send: async (terminal, text) => world.sent.push(text) });
  world.checks = []; world.sent = [];
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  await finished(world, runner);
  assert.deepEqual(world.checks, ["/wt/shop/T-1-a", "/wt/api/T-1-a"]);
  let task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.checkRepos, task.checkOutput], ["working", ["api"], "api: failed\nFAIL api"]);
  assert.match(world.sent[0], /^The check command failed after your change:\n\$ npm test\napi: failed\nFAIL api/, "fixes go to the one agent");
  assert.match(world.state().events[0].message, /T-1 checks failed in api · sent the output back/);
  results["/wt/api/T-1-a"] = { code: 0, output: "api ok" };
  await finished(world, runner);
  task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.checked, task.checkOutput], ["review", "passed", "shop: passed\nshop ok\n\napi: passed\napi ok"]);
});

async function acrossInReview(world, runner) {
  await step(runner);
  world.panes = [{ terminal: "t9" }];
  world.agents = [{ address: "t9", status: "working" }]; await step(runner);
  world.agents = [{ address: "t9", status: "done" }]; await step(runner);
}

test("merging lands every repository or none, and says which landed when a fast-forward still fails", async () => {
  let reply = { target: "main", targets: { shop: "main", api: "main" }, merged: ["shop", "api"], failed: null };
  const world = multi(reduce(across("A"), { type: "run" }, 0), {
    async delivery(_at, payload) { world.scripts.push(["delivery", { ...payload, at: _at.cwd }]); if (payload.op === "merge") { if (reply instanceof Error) throw reply; return reply; } return {}; } });
  const runner = new live.LiveRunner(world.host);
  await acrossInReview(world, runner);
  assert.equal(row(world.state(), "T-1").status, "review");
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "T-1" }, 0) };
  assert.match(world.state().events[0].message, /T-1 · merging into main in shop \+ api\./);
  reply = { target: "main", targets: { shop: "main", api: "main" }, merged: ["shop"], failed: { name: "api", error: "main moved in a way the branch can't fast-forward onto." } };
  world.scripts = [];
  await step(runner);
  const merge = world.scripts[0][1];
  assert.deepEqual(merge.repos.map(repo => [repo.name, repo.root, repo.worktree, repo.base]), [["shop", "/work/shop", "/wt/shop/T-1-a", "a".repeat(40)], ["api", "/work/api", "/wt/api/T-1-a", "a".repeat(40)]]);
  let task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.approvals], ["review", []]);
  assert.equal(task.error, "shop merged, but api did not: main moved in a way the branch can't fast-forward onto. Merging again finishes api; shop won't merge twice.");
  assert.equal(world.scripts.length, 1, "nothing is cleaned up");
  reply = { target: "main", targets: { shop: "main", api: "main" }, merged: ["shop", "api"], failed: null };
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "T-1" }, 0) };
  world.scripts = [];
  await step(runner);
  task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.workspaces], ["done", null]);
  assert.match(world.state().events.find(item => /merged into/.test(item.message)).message, /T-1 merged into main in shop \+ api\./);
  assert.deepEqual(world.scripts.slice(1).map(([, payload]) => [payload.op, payload.at, payload.root, payload.worktree, payload.force]),
    [["remove", "/work/shop", "/work/shop", "/wt/shop/T-1-a", false], ["remove", "/work/api", "/work/api", "/wt/api/T-1-a", false]], "every worktree and branch is removed");
});

test("one integration at a time per repository: a second task waits while the first merges", () => {
  let state = reduce(reduce(across("A", "B"), { type: "create", title: "C" }, 0), { type: "run" }, 0);
  for (const taskId of ["T-1", "T-2", "T-3"]) Object.assign(row(state, taskId), { status: "review", slot: null });
  state = reduce(state, { type: "approve", id: "T-1" }, 0);
  state = reduce(state, { type: "approve", id: "T-2" }, 0);
  assert.deepEqual(["T-1", "T-2"].map(taskId => row(state, taskId).status), ["merging", "review"], "T-2 shares shop and api with T-1");
  assert.equal(model.needsApproval(row(state, "T-2")), false, "approved, so it no longer waits for you");
  assert.equal(reduce(state, { type: "approve", id: "T-2" }, 0), state);
  state = reduce(state, { type: "removeRepository", name: "api" }, 0);
  state = reduce(state, { type: "merged", id: "T-1", target: "main" }, 0);
  assert.equal(row(state, "T-2").status, "merging", "it goes once the repositories are free");
  state = reduce(state, { type: "approve", id: "T-3" }, 0);
  assert.equal(row(state, "T-3").status, "review", "T-3 only touches shop, which T-2 holds");
  state = reduce(state, { type: "mergeFailed", id: "T-2", error: "conflict" }, 0);
  assert.deepEqual([row(state, "T-2").status, row(state, "T-3").status], ["review", "merging"]);
  assert.equal(model.needsApproval(row(state, "T-2")), true, "a refused merge waits for you again");
});

const prsAcross = github => {
  let now = 0, n = 11;
  const world = multi(reduce(reduce(across("Add checkout"), { type: "deliver", value: "pr" }, 0), { type: "run" }, 0), {
    now: () => now,
    async delivery(at, payload) {
      world.scripts.push(["delivery", { ...payload, at: at.cwd }]);
      const repo = at.cwd.split("/").pop();
      if (payload.op === "publish") return world.skip?.includes(repo) ? { skipped: true } : { url: `https://github.com/me/${repo}/pull/${++n}`, number: n };
      if (payload.op === "pr_state") return github(repo, payload.url);
      return {};
    },
  });
  world.clock = value => { now = value; };
  return world;
};

test("pull requests open one per repository, each body linking the others", async () => {
  const world = prsAcross(() => ({ state: "OPEN" }));
  const runner = new live.LiveRunner(world.host);
  await acrossInReview(world, runner);
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "T-1" }, 0) };
  assert.match(world.state().events[0].message, /opening pull requests into main in shop \+ api/);
  world.scripts = [];
  await step(runner);
  const calls = world.scripts.map(([, payload]) => payload);
  assert.deepEqual(calls.map(payload => [payload.op, payload.at, payload.optional ?? payload.url]),
    [["publish", "/work/shop", true], ["publish", "/work/api", true], ["pr_edit", "/work/shop", "https://github.com/me/shop/pull/12"], ["pr_edit", "/work/api", "https://github.com/me/api/pull/13"]]);
  assert.equal(calls[2].note, "2 repositories. Merge these too:\n- api: https://github.com/me/api/pull/13");
  assert.match(calls[3].note, /- shop: https:\/\/github\.com\/me\/shop\/pull\/12$/);
  const task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.prs], ["pr", { shop: { url: "https://github.com/me/shop/pull/12", number: 12 }, api: { url: "https://github.com/me/api/pull/13", number: 13 } }]);
  assert.equal(model.prNeeds(task).label, "2 PRs open");
  assert.match(world.state().events[0].message, /pull requests open: shop #12, api #13\. It finishes when every one is merged on GitHub/);

  const skipped = prsAcross(() => ({ state: "OPEN" }));
  skipped.skip = ["api"];
  const again = new live.LiveRunner(skipped.host);
  await acrossInReview(skipped, again);
  skipped.store = { [id]: reduce(skipped.state(), { type: "approve", id: "T-1" }, 0) };
  skipped.scripts = [];
  await step(again);
  assert.deepEqual(Object.keys(row(skipped.state(), "T-1").prs), ["shop"], "a repository the agent left alone gets no pull request");
  assert.equal(skipped.scripts.filter(([, payload]) => payload.op === "pr_edit").length, 0);
  skipped.skip = ["api", "shop"];
  const none = reduce(reduce(skipped.state(), { type: "prClosed", id: "T-1", repo: "shop" }, 0), { type: "approve", id: "T-1" }, 0);
  skipped.store = { [id]: none };
  await step(again);
  assert.match(row(skipped.state(), "T-1").error, /no changes to open a pull request for/);
});

test("the card shows the most pressing need across pull requests; the task finishes when every one merged", async () => {
  const states = { shop: { state: "OPEN", status: { draft: false, mergeable: "MERGEABLE", mergeState: "CLEAN", review: "APPROVED", failed: 0, failing: [], pending: 0, passed: 2 } },
    api: { state: "OPEN", status: { draft: false, mergeable: "MERGEABLE", mergeState: "BLOCKED", review: "REVIEW_REQUIRED", failed: 1, failing: ["test"], pending: 0, passed: 1 } } };
  const world = prsAcross(repo => states[repo]);
  const runner = new live.LiveRunner(world.host);
  await acrossInReview(world, runner);
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "T-1" }, 0) };
  await step(runner);
  world.clock(1000); await settle(runner);
  let task = row(world.state(), "T-1");
  assert.deepEqual([model.prNeeds(task).label, model.prNeeds(task).tone], ["api · Checks failing · 1", "blocked"]);
  assert.equal(model.prChecklist(task.prs.api, "main")[0].value, "1 failing: test", "the inspector lists each PR on its own");
  states.api = { state: "OPEN", status: { ...states.shop.status } };
  world.clock(62000); await settle(runner);
  assert.equal(model.prNeeds(row(world.state(), "T-1")).label, "Ready to merge");
  states.shop = { state: "MERGED" };
  world.clock(123000); await settle(runner);
  task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.prs.shop.merged, model.prNeeds(task).label], ["pr", true, "Ready to merge"]);
  assert.match(world.state().events[0].message, /shop #12 merged on GitHub\. Waiting for api #13\./);
  world.scripts = [];
  world.clock(184000); await settle(runner);
  assert.equal(world.scripts.filter(([, payload]) => payload.op === "pr_state").length, 1, "a merged PR is no longer asked about");
  states.api = { state: "MERGED" };
  world.clock(245000); await settle(runner);
  task = row(world.state(), "T-1");
  assert.deepEqual([task.status, task.workspaces], ["done", null]);
  assert.match(world.state().events.find(item => /merged on GitHub:/.test(item.message)).message, /T-1 merged on GitHub: shop #12, api #13\./);
  assert.deepEqual(world.scripts.filter(([, payload]) => payload.op === "remove").map(([, payload]) => [payload.root, payload.force]), [["/work/shop", true], ["/work/api", true]]);
});

test("a pull request closed without merging sends the task back to review with the others left open", async () => {
  const states = { shop: { state: "OPEN" }, api: { state: "OPEN" } };
  const world = prsAcross(repo => states[repo]);
  const runner = new live.LiveRunner(world.host);
  await acrossInReview(world, runner);
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "T-1" }, 0) };
  await step(runner);
  states.api = { state: "CLOSED" };
  world.clock(1000); await settle(runner);
  let task = row(world.state(), "T-1");
  assert.deepEqual([task.status, Object.keys(task.prs), task.approvals], ["review", ["shop"], []]);
  assert.match(task.error, /^api's pull request #13 was closed without merging\. The others are left as they are/);
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "T-1" }, 0) };
  world.scripts = [];
  await step(runner);
  task = row(world.state(), "T-1");
  assert.deepEqual(Object.keys(task.prs), ["shop", "api"]);
  assert.equal(task.prs.api.number, 15, "a new pull request for the closed one");
  states.shop = { state: "MERGED" };
  world.clock(62000); await settle(runner);
  world.store = { [id]: reduce(world.state(), { type: "prClosed", id: "T-1", repo: "api", url: task.prs.api.url }, 0) };
  world.store = { [id]: reduce(world.state(), { type: "approve", id: "T-1" }, 0) };
  world.scripts = [];
  await step(runner);
  assert.deepEqual(world.scripts.filter(([, payload]) => payload.op === "publish").map(([, payload]) => payload.at), ["/work/api"], "a merged repository isn't published again");
});

test("discarding a task across repositories removes every worktree and branch, even when one fails", async () => {
  let fail = true;
  const world = multi(reduce(across("A"), { type: "run" }, 0), {
    async delivery(at, payload) { world.scripts.push(["delivery", { ...payload, at: at.cwd }]); if (fail && at.cwd === "/work/shop") throw new Error("busy"); return {}; } });
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  world.store = { [id]: reduce(world.state(), { type: "discard", id: "T-1" }, 0) };
  world.scripts = [];
  await step(runner);
  assert.deepEqual(world.scripts.map(([, payload]) => [payload.op, payload.at, payload.force]), [["remove", "/work/shop", true], ["remove", "/work/api", true]]);
  assert.equal(row(world.state(), "T-1").error, "shop: busy");
  fail = false;
  world.store = { [id]: reduce(world.state(), { type: "discard", id: "T-1" }, 0) };
  await step(runner);
  assert.equal(world.state().tasks.length, 0);
});

test("a ticket's pull requests are linked in one update for the task", () => {
  let state = reduce(reduce(createLive(context, 0), { type: "deliver", value: "pr" }, 0), { type: "addRepository", path: "/work/api" }, 0);
  state = reduce(state, { type: "addTickets", provider: "plane", issues: [ticket(4, { title: "Fix login" })] }, 0);
  state = reduce(reduce(state, { type: "repos", id: "HMOD-4", repo: "api" }, 0), { type: "ticketUpdates", provider: "plane", link: true }, 0);
  Object.assign(row(state, "HMOD-4"), { status: "merging", merge: true });
  state = reduce(state, { type: "prOpened", id: "HMOD-4", prs: { shop: { url: "https://github.com/me/shop/pull/1", number: 1 }, api: { url: "https://github.com/me/api/pull/2", number: 2 } } }, 0);
  const pending = row(state, "HMOD-4").ticket.pending;
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].links.map(link => [link.url, link.title]), [["https://github.com/me/shop/pull/1", "shop PR #1: Fix login"], ["https://github.com/me/api/pull/2", "api PR #2: Fix login"]]);
  state = reduce(state, { type: "ticketUpdated", id: "HMOD-4", n: pending[0].n, ok: true }, 0);
  assert.equal(row(state, "HMOD-4").ticket.update.text, "Linked 2 pull requests in Plane");
});

test("saved version 4 live pipelines key their worktrees and pull requests by repository", () => {
  const old = { ...typed("A", "B", "C"), version: 4 };
  delete old.repositories;
  const workspace = { root: "/wt/a", cwd: "/wt/a", branch: "pipeline/a", base: "a".repeat(40), target: "main" };
  Object.assign(row(old, "T-1"), { status: "review", workspace, planned: { ...workspace } });
  Object.assign(row(old, "T-2"), { status: "pr", workspace, pr: { url: "https://github.com/me/shop/pull/3", number: 3 } });
  Object.assign(row(old, "T-3"), { workspace: null, planned: null });
  for (const task of old.tasks) delete task.workspaces;
  const state = model.migrate(old, 0);
  assert.equal(state.version, model.VERSION);
  assert.deepEqual(state.repositories, [{ name: "shop", path: "/work/shop" }]);
  assert.deepEqual(row(state, "T-1").workspaces, { shop: { ...workspace, source: "/work/shop" } });
  assert.deepEqual(row(state, "T-1").planned, { shop: { ...workspace, source: "/work/shop" } });
  assert.deepEqual([row(state, "T-2").prs, model.prNeeds(row(state, "T-2")).label], [{ shop: { url: "https://github.com/me/shop/pull/3", number: 3 } }, "PR #3 open"]);
  assert.deepEqual([row(state, "T-3").workspaces, row(state, "T-3").prs], [null, null]);
  assert.ok(!("workspace" in row(state, "T-1")) && !("pr" in row(state, "T-2")));
  assert.equal(model.migrate(state, 0), state);
  const simulation = model.migrate({ ...createPipeline(context, 0), version: 4 }, 0);
  assert.deepEqual([simulation.version, simulation.repositories], [model.VERSION, undefined]);
});

test("a start interrupted after its worktree was planned retries with the same branch and adopts the worktree", async () => {
  const state = reduce(typed("Add a dark mode toggle"), { type: "run" }, 0);
  const planned = { root: "/wt/old", branch: "pipeline/T-1-old", base: "b".repeat(40), target: "main", source: "/work/shop", run: "abcdefabcdef" };
  Object.assign(row(state, "T-1"), { planned: { shop: planned }, launch: null });
  const world = host(state, { async worktree(_context, payload) {
    world.scripts.push(["worktree", payload]);
    if (payload.op === "inspect") return { base: "c".repeat(40), branch: "main", runId: payload.runId, workspaces: [{ root: "/wt/old", branch: "pipeline/T-1-old" }] };
    return { root: "/wt/old", cwd: "/wt/old", branch: "pipeline/T-1-old", base: "b".repeat(40), adopted: true };
  } });
  await step(new live.LiveRunner(world.host));
  assert.equal(world.scripts[0][1].runId, "abcdefabcdef");
  assert.equal(world.scripts[1][1].adopt, true);
  const task = row(world.state(), "T-1");
  assert.equal(task.status, "working");
  assert.equal(task.workspaces.shop.base, "b".repeat(40), "the adopted worktree keeps the commit it started from");
});

test("a task marked to start first goes ahead of the queue, whatever its priority", () => {
  let state = typed("One", "Two", "Three");
  state = reduce(state, { type: "first", id: "T-3" }, 0);
  assert.deepEqual(model.queueOrder(state).map(task => task.id), ["T-3", "T-1", "T-2"]);
  state = reduce(state, { type: "first", id: "T-2" }, 0);
  assert.deepEqual(model.queueOrder(state).map(task => task.id), ["T-2", "T-3", "T-1"], "the last one marked goes first");
  assert.equal(reduce(state, { type: "first", id: "T-2", value: true }, 0), state);
  state = reduce(state, { type: "first", id: "T-2" }, 0);
  assert.deepEqual(model.queueOrder(state).map(task => task.id), ["T-3", "T-1", "T-2"]);
  state = reduce(state, { type: "run" }, 0);
  assert.deepEqual(activeTasks(state).map(task => task.id).sort(), ["T-1", "T-3"]);
  assert.equal(row(state, "T-3").rank, 0, "a started task gives its place back");
});

test("a task's own model and effort win over the agent's setting when it starts", async () => {
  let state = reduce(typed("Write the docs", "Rework billing"), { type: "tune", key: "claude", model: "opus", effort: "high" }, 0);
  state = reduce(state, { type: "tuneTask", id: "T-1", key: "claude", model: "haiku" }, 0);
  assert.deepEqual(row(state, "T-1").tune, { model: "haiku", effort: null });
  assert.deepEqual(model.taskTuning(state, row(state, "T-1"), "claude"), { model: "haiku", effort: "high" }, "what the task leaves unset follows the setting");
  assert.equal(reduce(state, { type: "tuneTask", id: "T-1", key: "claude", effort: "enormous" }, 0), state, "an unknown effort is refused");
  const world = host(reduce(state, { type: "run" }, 0));
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  await step(runner);
  assert.deepEqual(world.started.map(start => start.run), [["claude", "--model", "haiku", "--effort", "high"], ["claude", "--model", "opus", "--effort", "high"]]);
  assert.equal(row(world.state(), "T-1").tuning, "haiku · high effort");
  state = reduce(state, { type: "tuneTask", id: "T-1", key: "claude", model: null }, 0);
  assert.equal(row(state, "T-1").tune, null);
});

test("Pipeline announces what Herdr doesn't: failed checks, refused merges, pull requests and checked work", () => {
  const base = typed("One");
  const at = (patch, extra = {}) => ({ ...base, ...extra, tasks: [{ ...base.tasks[0], ...patch }] });
  const notices = (before, after) => model.liveNotices(before, after).map(notice => [notice.title, notice.level]);
  assert.deepEqual(notices(at({ status: "testing" }), at({ status: "failed", reason: "checks" })), [["T-1 checks failed", "error"]]);
  assert.deepEqual(notices(at({ status: "working" }), at({ status: "failed", error: "Its terminal closed." })), [["T-1 stopped", "error"]]);
  assert.deepEqual(notices(at({ status: "merging" }), at({ status: "review", error: "The branch conflicts with main." })), [["T-1 not merged", "error"]]);
  assert.equal(model.liveNotices(at({ status: "merging" }), at({ status: "review", error: "The branch conflicts with main." }))[0].body, "The branch conflicts with main.");
  assert.deepEqual(notices(at({ status: "testing" }), at({ status: "review" })), [["T-1 is ready for review", "success"]]);
  assert.deepEqual(notices(at({ status: "working" }), at({ status: "review" })), [], "Herdr already says an agent finished");
  assert.deepEqual(notices(at({ status: "working" }), at({ status: "input" })), [], "and that an agent asks");
  assert.deepEqual(notices(at({ status: "working" }), at({ status: "input", reason: "trust" })), [["T-1 asks to trust its worktree", "warning"]]);
  assert.deepEqual(notices(at({ status: "testing" }), at({ status: "review", approvals: ["shop"] })), [], "approved work needs nobody");
  const pr = status => ({ status: "pr", prs: { shop: { url: "u", number: 4, status } } });
  assert.deepEqual(notices(at(pr({ pending: 2 })), at(pr({ failed: 1 }))), [["T-1 pull request · checks failing · 1", "warning"]]);
  assert.deepEqual(notices(at(pr({ pending: 2 })), at(pr({}))), [["T-1 pull request · ready to merge", "success"]]);
  assert.deepEqual(notices(at(pr({ pending: 2 })), at(pr({ pending: 1 }))), []);
  assert.deepEqual(notices(at(pr({})), at({ status: "done" })), [["T-1 merged on GitHub", "success"]]);
  assert.deepEqual(notices(at({ status: "merging" }), at({ status: "done" })), [], "a merge you asked for needs no notice");
  assert.deepEqual(notices(at({ status: "merging" }), at({ status: "done" }, { autoMerge: true })), [["T-1 merged", "success"]]);
  assert.deepEqual(notices(at({ status: "testing" }), at({ status: "failed", reason: "checks" }, { quiet: true })), [], "Notify me off silences them");
});

test("the runner hands each notice to the host as the change lands", async () => {
  let state = reduce(reduce(typed("One"), { type: "check", command: "npm test" }, 0), { type: "run" }, 0);
  const said = [], world = host(state, { announce: (_id, notice) => said.push(notice.title), check: async () => ({ code: 1, output: "1 failing" }) });
  world.store[id] = reduce(world.store[id], { type: "check", fix: false }, 0);
  const runner = new live.LiveRunner(world.host);
  await step(runner);
  world.agents = [{ address: "t9", status: "working" }]; await step(runner);
  world.agents = [{ address: "t9", status: "done" }]; await step(runner);
  let job;
  runner.step({ spawn: fn => { job = fn({ sleep: async () => {} }); } });
  await job;
  assert.equal(row(world.state(), "T-1").status, "failed");
  assert.deepEqual(said, ["T-1 checks failed"]);
});

test("a refused merge can go back to its agent to rebase, which clears the refusal", () => {
  let state = typed("One");
  state = { ...state, tasks: [{ ...state.tasks[0], status: "review", error: "The branch conflicts with main.", approvals: [], workspaces: { shop: { root: "/wt", cwd: "/wt", branch: "b", base: "a", target: "main" } } }] };
  const next = reduce(state, { type: "resolving", id: "T-1" }, 0);
  assert.equal(row(next, "T-1").error, null);
  assert.match(next.events[0].message, /asked its agent to rebase onto main/);
  assert.equal(reduce(next, { type: "resolving", id: "T-1" }, 0), next, "nothing to resolve without a refusal");
  assert.match(live.rebaseRequest("main", "The branch conflicts with main."), /refused:\nThe branch conflicts with main\.\n\nRebase this branch onto main/);
});

test("changed files come from git's own lists, with new files the agent hasn't committed", () => {
  const files = live.changedFiles("M\0src/a.js\0A\0docs/new file.md\0D\0old.txt\0", "3\t1\tsrc/a.js\x0012\t0\tdocs/new file.md\x000\t7\told.txt\x00-\t-\tlogo.png\0", "?? notes.md\0 M src/a.js\0");
  assert.deepEqual(files, [
    { path: "src/a.js", status: "M", fresh: false, add: 3, del: 1, binary: false },
    { path: "docs/new file.md", status: "A", fresh: false, add: 12, del: 0, binary: false },
    { path: "old.txt", status: "D", fresh: false, add: 0, del: 7, binary: false },
    { path: "notes.md", status: "A", fresh: true, add: 0, del: 0 },
  ]);
  assert.deepEqual(live.changedFiles("", "", ""), []);
  assert.deepEqual(live.changedFiles(undefined, undefined, undefined), []);
});

test("a task's time counts while its agent works or checks run, not while it waits for you", () => {
  const minute = 60000;
  let state = reduce(reduce(typed("One"), { type: "check", command: "npm test" }, 0), { type: "run" }, 0);
  assert.equal(model.timing(row(state, "T-1"), 5 * minute), null, "nothing to say while it starts");
  state = reduce(state, { type: "launched", id: "T-1", space: "s", tab: "tb", terminal: "t9", agent: "Claude Code" }, 1 * minute);
  assert.equal(model.timing(row(state, "T-1"), 13 * minute), "12 min");
  state = reduce(state, { type: "observe", id: "T-1", status: "working" }, 2 * minute);
  state = reduce(state, { type: "observe", id: "T-1", status: "input" }, 11 * minute);
  assert.equal(model.timing(row(state, "T-1"), 500 * minute), "10 min", "waiting for an answer doesn't count");
  state = reduce(state, { type: "observe", id: "T-1", status: "working" }, 60 * minute);
  state = reduce(state, { type: "observe", id: "T-1", status: "review" }, 65 * minute);
  assert.equal(row(state, "T-1").status, "testing");
  state = reduce(state, { type: "checkPassed", id: "T-1", run: row(state, "T-1").checkRun }, 70 * minute);
  assert.equal(row(state, "T-1").spent, 20 * minute, "checks count");
  state = reduce(state, { type: "approve", id: "T-1" }, 900 * minute);
  state = reduce(state, { type: "merged", id: "T-1", target: "main" }, 901 * minute);
  assert.equal(model.timing(row(state, "T-1")), "took 20 min", "a night in review is not agent time");
  assert.deepEqual([model.elapsed(20000), model.elapsed(3600000), model.elapsed(75 * minute)], ["under a minute", "1 h", "1 h 15 min"]);
});

test("a working agent whose screen stops changing for ten minutes is flagged, and cleared when it moves again", async () => {
  let state = reduce(typed("One"), { type: "run" }, 0), clock = 0, screen = "Reading files";
  const said = [], world = host(state, { now: () => clock, read: async () => screen, announce: (_id, notice) => said.push(notice.title) });
  const runner = new live.LiveRunner(world.host);
  const tick = async ms => { clock += ms; const jobs = []; runner.step({ spawn: fn => jobs.push(fn({ sleep: async () => {} })) }); await Promise.all(jobs); };
  await tick(0);
  world.agents = [{ address: "t9", status: "working" }];
  await tick(1000); await tick(1000);
  for (const step of ["Edits a", "Edits b", "Runs c", "Runs d", "Waits"]) { screen = step; await tick(60000); }
  assert.equal(row(world.state(), "T-1").stalled ?? null, null, "a screen that keeps changing is fine");
  for (let minute = 0; minute < 11; minute++) { screen = `${minute % 2 ? "⏺" : " "} Sleeping\n  ⎿  $ python3 -c "sleep(840)" (${minute ? `${minute}m ${minute + 3}s` : "47s"})\n${minute % 2 ? "✻" : "✢"} Thinking… (${minute * 60 + 7}s · ↓ ${254 + minute} tokens)`; await tick(60000); }
  assert.ok(row(world.state(), "T-1").stalled, "ten minutes of the same screen");
  assert.deepEqual(said, ["T-1 may be stuck"]);
  assert.match(world.state().events[0].message, /shown nothing new for 10 min/);
  screen = "moving again"; await tick(60000);
  assert.equal(row(world.state(), "T-1").stalled, null);
  for (let minute = 0; minute < 11; minute++) await tick(60000);
  world.agents = [{ address: "t9", status: "done" }]; await tick(1000);
  assert.deepEqual([row(world.state(), "T-1").status, row(world.state(), "T-1").stalled], ["review", null], "a finished task is no longer stalled");
});

test("tokens are read when an agent's turn ends and stay on the task", async () => {
  let state = reduce(typed("One"), { type: "run" }, 0), reads = 0;
  const world = host(state, { usage: async (_context, cwds) => { reads++; return { [cwds[0]]: { written: 1200 * reads, read: 50000, cached: 900000, turns: 7 } }; } });
  const runner = new live.LiveRunner(world.host);
  const tick = async () => { const jobs = []; runner.step({ spawn: fn => jobs.push(fn({ sleep: async () => {} })) }); await Promise.all(jobs); };
  await tick();
  world.agents = [{ address: "t9", status: "working" }]; await tick();
  assert.equal(reads, 0, "nothing is read while it works");
  world.agents = [{ address: "t9", status: "done" }]; await tick(); await tick(); await tick();
  assert.equal(reads, 1, "once per finished turn");
  assert.deepEqual(row(world.state(), "T-1").usage, { written: 1200, read: 50000, cached: 900000, turns: 7 });
  world.agents = [{ address: "t9", status: "working" }]; await tick();
  world.agents = [{ address: "t9", status: "done" }]; await tick(); await tick();
  assert.equal(row(world.state(), "T-1").usage.written, 2400, "and again after another pass");
  assert.equal(model.usageText(row(world.state(), "T-1").usage), "2.4k tokens written · 50k read · 900k from cache");
  assert.deepEqual([model.compact(999), model.compact(1250000), model.compact(24000000)], ["999", "1.3M", "24M"]);
});

test("a live task keeps its own history when the shared log moves on", () => {
  let state = typed("One", "Two");
  state = reduce(state, { type: "first", id: "T-1" }, 0);
  for (let i = 0; i < 45; i++) state = reduce(state, { type: "first", id: "T-2" }, 0);
  assert.equal(state.events.length, 40);
  assert.equal(state.events.some(item => item.task === "T-1"), false, "the shared log dropped it");
  assert.deepEqual(model.taskLog(state, row(state, "T-1")), ["T-1 starts before the rest of the queue.", "T-1 joined the queue."]);
  assert.equal(row(state, "T-2").log.length, 30);
  const old = { ...row(state, "T-1"), log: undefined };
  assert.deepEqual(model.taskLog(state, old), [], "a task saved before this falls back to the shared log");
});

test("with the planner agent on, its order and waits decide what starts, inside Pipeline's own rules", () => {
  let state = reduce(typed("Schema", "API", "Docs"), { type: "plannerSetup", on: true }, 0);
  const key = model.planKey(state);
  state = reduce(state, { type: "run" }, 0);
  assert.equal(activeTasks(state).length, 0, "nothing starts before the plan");
  assert.equal(model.waitingReason(state, row(state, "T-1")), "Waiting for the planner");
  assert.match(state.plan, /The planner is reading 3 queued tasks and the repository\. New agents wait for its plan\./);
  state = reduce(state, { type: "planning", key }, 0);
  assert.equal(reduce(state, { type: "planned", key: "old", order: ["T-3"] }, 0), state, "a plan for another queue is dropped");
  state = reduce(state, { type: "planned", key, summary: "Docs first; the API builds on the schema.", order: ["T-3", "T-1", "NOPE"],
    waits: { "T-2": ["T-1", "NOPE"], "T-1": ["T-2"] }, reasons: { "T-2": "It reads the schema's new types." } }, 0);
  assert.deepEqual(activeTasks(state).map(task => task.id).sort(), ["T-1", "T-3"]);
  assert.deepEqual({ ...row(state, "T-2").plan, sig: undefined }, { n: 2, reason: "It reads the schema's new types.", waits: ["T-1"], sig: undefined }, "unknown ids are dropped and order fills in");
  assert.deepEqual(row(state, "T-1").plan.waits, [], "a wait on a task the plan starts later is refused");
  assert.match(state.plan, /^Docs first; the API builds on the schema\. Starting agents for T-3 \+ T-1/);
  assert.match(state.events.find(item => /planner ordered/.test(item.message)).message, /T-3, T-1, T-2\. T-2 waits for T-1\./);
  assert.equal(model.plannerHolds(state), false, "tasks leaving the queue don't ask for a new plan");
  state = reduce(state, { type: "create", title: "Late" }, 0);
  assert.equal(model.plannerHolds(state), true, "a new task does");
});

test("the planner's order yields to Start first and Start anyway, and a failed plan lets work start by priority", () => {
  let state = reduce(typed("A", "B", "C"), { type: "plannerSetup", on: true }, 0);
  let key = model.planKey(state);
  state = reduce(reduce(state, { type: "planning", key }, 0), { type: "planned", key, order: ["T-3", "T-2", "T-1"], waits: { "T-1": ["T-2"] } }, 0);
  assert.deepEqual(model.queueOrder(state).map(task => task.id), ["T-3", "T-2", "T-1"]);
  state = reduce(state, { type: "first", id: "T-1" }, 0);
  key = model.planKey(state);
  assert.equal(model.planKey(state), key, "Start first doesn't ask for a new plan");
  assert.deepEqual(model.queueOrder(state).map(task => task.id), ["T-1", "T-3", "T-2"]);
  assert.deepEqual(model.dependencies(state, row(state, "T-1")), ["T-2"]);
  state = reduce(state, { type: "unblock", id: "T-1", value: true }, 0);
  assert.deepEqual(model.dependencies(state, row(state, "T-1")), []);
  state = reduce(state, { type: "plannerSetup", on: false }, 0);
  assert.deepEqual(model.queueOrder(state).map(task => task.id), ["T-1", "T-2", "T-3"], "off, its order and waits are ignored");
  state = reduce(reduce(state, { type: "plannerSetup", on: true }, 0), { type: "create", title: "D" }, 0);
  key = model.planKey(state);
  state = reduce(reduce(state, { type: "planning", key }, 0), { type: "run" }, 0);
  assert.equal(activeTasks(state).length, 0);
  state = reduce(state, { type: "planFailed", key, error: "The planner took longer than 5 minutes." }, 0);
  assert.equal(activeTasks(state).length, 2, "a failed plan never blocks the pipeline");
  assert.match(state.plan, /couldn't plan: The planner took longer than 5 minutes\./);
  assert.equal(model.plannerHolds(state), false, "the failure covers the tasks it was asked about");
  assert.equal(model.plannerHolds(reduce(state, { type: "create", title: "E" }, 0)), true, "a new task asks again");
  assert.equal(reduce(state, { type: "replan" }, 0).planning, null);
});

test("the runner asks the planner once the queue settles, read-only, and applies the answer", async () => {
  let state = reduce(reduce(typed("A", "B"), { type: "plannerSetup", on: true, model: "sonnet" }, 0), { type: "addRepository", path: "/work/api" }, 0);
  let clock = 0, calls = [];
  const world = host(state, { now: () => clock, plan: async (_context, job) => { calls.push(job); return { plan: { summary: "B first.", order: ["T-2", "T-1"], tasks: [{ id: "T-1", waits: [], reason: "After B." }] },
    trace: ["Reads src/a.js"], ms: 9000, cost: 0.004, tokens: 35000 }; } });
  const runner = new live.LiveRunner(world.host);
  const tick = async ms => { clock += ms; const jobs = []; runner.step({ spawn: fn => jobs.push(fn({ sleep: async () => {} })) }); await Promise.all(jobs); };
  await tick(0); await tick(1000);
  assert.equal(calls.length, 0, "waits for the queue to settle");
  world.store[id] = reduce(world.store[id], { type: "create", title: "C" }, 0);
  await tick(3500);
  assert.equal(calls.length, 0, "a new task restarts the wait");
  await tick(4000);
  assert.equal(calls.length, 1);
  const { args, prompt, schema, watch } = calls[0];
  assert.deepEqual(args.slice(0, 5), ["-p", "--model", "sonnet", "--tools", "Read,Grep,Glob"]);
  assert.ok(args.includes("--add-dir=/work/api") && args.includes("--strict-mcp-config"));
  assert.deepEqual([schema, watch], [live.PLAN_SCHEMA, false]);
  assert.match(prompt, /- T-3: C\n  repositories: shop · priority 2/);
  assert.match(prompt, /- api: \/work\/api/);
  const planning = world.state().planning;
  assert.deepEqual([planning.status, planning.prompt, planning.trace, planning.ms, planning.cost, planning.tokens], ["done", prompt, ["Reads src/a.js"], 9000, 0.004, 35000]);
  assert.deepEqual(planning.tasks, [{ id: "T-2", title: "B", reason: "", waits: [] }, { id: "T-1", title: "A", reason: "After B.", waits: [] }, { id: "T-3", title: "C", reason: "", waits: [] }],
    "the plan is kept as it was, after its tasks start");
  assert.equal(row(world.state(), "T-1").plan.reason, "After B.");
  await tick(10000);
  assert.equal(calls.length, 1, "the same queue isn't planned twice");
  assert.deepEqual(live.readPlan({ plan: { summary: "s", order: ["T-1"], tasks: [{ id: "T-1", waits: ["T-2"], reason: "r" }] }, trace: ["x"], ms: 5 }),
    { summary: "s", order: ["T-1"], waits: { "T-1": ["T-2"] }, reasons: { "T-1": "r" }, trace: ["x"], ms: 5, cost: null, tokens: null });
  assert.throws(() => live.readPlan({ plan: null, error: "Credit balance is too low", trace: ["Reads a"] }), error => /Credit balance is too low/.test(error.message) && error.trace[0] === "Reads a");
});

test("a plan that was running when Herdr restarted fails, so the queue isn't held", () => {
  let state = reduce(typed("A"), { type: "plannerSetup", on: true }, 0);
  state = reduce(state, { type: "planning", key: model.planKey(state) }, 0);
  const world = host(state);
  new live.LiveRunner(world.host).start();
  assert.equal(world.state().planning.status, "failed");
  assert.equal(model.plannerHolds(world.state()), false);
});

test("the planner can be Codex: read-only, schema first, with its own model and effort", () => {
  let state = reduce(reduce(typed("A"), { type: "plannerSetup", on: true, model: "sonnet", effort: "high" }, 0), { type: "addRepository", path: "/work/api" }, 0);
  assert.equal(model.plannerAgent(state), "claude");
  assert.deepEqual(live.planArgs(state).args.slice(0, 7), ["-p", "--model", "sonnet", "--effort", "high", "--tools", "Read,Grep,Glob"]);
  state = reduce(state, { type: "agent", value: { key: "codex", name: "Codex", run: ["codex"] } }, 0);
  assert.equal(model.plannerAgent(state), "codex", "it follows the task agent when that is Codex");
  state = reduce(state, { type: "plannerSetup", agent: "codex" }, 0);
  assert.deepEqual([state.planner.model, state.planner.effort], ["sonnet", "high"], "picking the one it already is changes nothing");
  state = reduce(state, { type: "plannerSetup", agent: "claude" }, 0);
  assert.deepEqual([state.planner.agent, state.planner.model, state.planner.effort], ["claude", null, null], "another planner drops the old model and effort");
  state = reduce(state, { type: "plannerSetup", agent: "codex", model: "gpt-5", effort: "low" }, 0);
  const job = live.planArgs(state);
  assert.equal(job.agent, "codex");
  assert.deepEqual(job.args, ["--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "--color", "never", "-m", "gpt-5", "-c", 'model_reasoning_effort="low"', "--add-dir=/work/api"]);
  assert.deepEqual(job.tuning, ["gpt-5", "low effort"]);
  assert.match(job.prompt, /^You plan the work queue of Herdr Pipeline/);
  state = reduce(reduce(state, { type: "planning", key: model.planKey(state) }, 0), { type: "planned", key: model.planKey(state), order: ["T-1"], summary: "s" }, 0);
  assert.equal(state.planning.agent, "codex");
});

test("Choose for me reads the repository read-only with the AI helper: Haiku unless set, apart from the planner", () => {
  const facts = { branch: "main", github: false, found: ["npm test"] };
  let state = createLive(context, 0);
  const job = live.setupArgs(state, facts);
  assert.deepEqual([job.agent, job.by], ["claude", "Claude Code · haiku"]);
  assert.deepEqual(job.args.slice(0, 5), ["-p", "--model", "haiku", "--tools", "Read,Grep,Glob"]);
  assert.match(job.prompt, /found by file names alone: npm test/);
  assert.match(job.prompt, /lacks, so choose merge/);
  state = reduce(state, { type: "plannerSetup", on: true, model: "opus" }, 0);
  assert.equal(live.setupArgs(state, facts).by, "Claude Code · haiku", "the planner's model is the planner's alone");
  state = reduce(state, { type: "helperSetup", model: "sonnet", effort: "low" }, 0);
  assert.deepEqual(live.setupArgs(state, facts).args.slice(0, 5), ["-p", "--model", "sonnet", "--effort", "low"]);
  assert.equal(state.planner.model, "opus");
  state = reduce(state, { type: "helperSetup", agent: "codex" }, 0);
  assert.deepEqual([state.helper.model, state.helper.effort], [null, null], "another agent drops the old model and effort");
  const codex = live.setupArgs(state, facts);
  assert.deepEqual([codex.agent, codex.by, codex.args.slice(0, 2)], ["codex", "Codex", ["--sandbox", "read-only"]]);
  const answer = { check: { value: " make check ", reason: "Makefile" }, tryout: { value: "", reason: "Nothing runs" }, delivery: { value: "pr", reason: "CONTRIBUTING asks for PRs" } };
  assert.equal(live.readSetup({ plan: answer }, false).delivery.value, "merge", "no pull requests without GitHub and gh");
  assert.deepEqual(live.readSetup({ plan: answer, ms: 4000 }, true), { check: { value: "make check", reason: "Makefile" }, tryout: { value: "", reason: "Nothing runs" },
    delivery: { value: "pr", reason: "CONTRIBUTING asks for PRs" }, ms: 4000 });
  assert.throws(() => live.readSetup({ plan: null, error: "Not logged in" }, true), /Not logged in/);
});

test("the planner reads each ticket's blockers, and a blocker that changes asks for a new plan", () => {
  let state = reduce(createLive(context, 0), { type: "addTickets", provider: "linear", source: "Linear", issues: [
    { uuid: "u1", identifier: "ENG-1", title: "Schema", priority: { name: "High" }, team: "Eng" },
    { uuid: "u2", identifier: "ENG-2", title: "API", team: "Eng", blockers: [{ key: "ENG-1", title: "Schema" }, { key: "OPS-9", title: "Provision the database", closed: false }] }] }, 0);
  state = reduce(state, { type: "plannerSetup", on: true }, 0);
  const text = live.planPrompt(state);
  assert.match(text, /- ENG-2: API\n  repositories: shop · priority 1 · ticket ENG-2\n  blocked by in Linear: ENG-1 "Schema" \(in the pipeline as ENG-1, queued\); OPS-9 "Provision the database" \(still open, outside the pipeline\)/);
  assert.match(text, /Tickets' blockers are already enforced/);
  const key = model.planKey(state);
  state = reduce(reduce(state, { type: "planning", key }, 0), { type: "planned", key, order: ["ENG-1", "ENG-2"], summary: "s" }, 0);
  assert.equal(model.plannerHolds(state), false);
  assert.deepEqual(model.dependencies(state, row(state, "ENG-2")), ["ENG-1", "OPS-9"], "blockers hold the task with the planner on, as without it");
  state = reduce(state, { type: "blockers", id: "ENG-2", blockers: [{ key: "ENG-1", title: "Schema" }, { key: "OPS-9", title: "Provision the database", closed: true }] }, 0);
  assert.equal(model.plannerHolds(state), true, "a blocker that closed asks for a new plan");
  assert.deepEqual(model.dependencies(state, row(state, "ENG-2")), ["ENG-1"]);
});

test("a watched plan is asked for once, and the plan keeps what it read even when it fails", async () => {
  let state = reduce(reduce(typed("A"), { type: "plannerSetup", on: true }, 0), { type: "watchPlan" }, 0);
  assert.equal(state.planner.watch, true);
  let clock = 0;
  const jobs = [], world = host(state, { now: () => clock, plan: async (_context, job) => { jobs.push(job); return { plan: null, error: "Codex stopped with an error.", trace: ["Runs rg add"], ms: 4000 }; } });
  const runner = new live.LiveRunner(world.host);
  const tick = async ms => { clock += ms; const spawned = []; runner.step({ spawn: fn => spawned.push(fn({ sleep: async () => {} })) }); await Promise.all(spawned); };
  await tick(0); await tick(5000);
  assert.equal(jobs[0].watch, true);
  assert.equal(world.state().planner.watch, false, "only the next plan is watched");
  assert.deepEqual([world.state().planning.status, world.state().planning.trace, world.state().planning.watch], ["failed", ["Runs rg add"], true]);
  assert.equal(world.state().events.some(item => /Planner started/.test(item.message)), false);
  assert.ok(reduce(world.state(), { type: "run" }, 0).events.some(item => /^Started\. Agents start for queued tasks/.test(item.message)));
});

const limited = (windows, extra = {}) => ({ type: "limits", limits: { claude: { windows }, codex: { windows: [{ name: "5-hour", used: 10, resets: null, model: null }], seen: 5 }, ...extra } });
const fiveHour = (used, resets = 5000, model = null) => ({ name: "5-hour", used, resets, model });

test("a usage limit at the hold keeps new agents from starting until it resets", () => {
  let state = reduce(reduce(typed("One", "Two"), limited([fiveHour(93)]), 0), { type: "run" }, 0);
  assert.deepEqual(activeTasks(state), []);
  assert.match(model.waitingReason(state, row(state, "T-1"), 0), /^Held by Claude's 5-hour limit until \d\d:\d\d$/);
  assert.match(state.plan, /^Holding new agents: Claude's 5-hour limit is at 93%, past the 90% you hold at\. It resets at \d\d:\d\d\. Agents already working keep going\.$/);
  assert.equal(reduce(state, { type: "readLimits" }, 4999).tasks.filter(task => task.status === "routing").length, 0);
  state = reduce(state, { type: "readLimits" }, 5000);
  assert.deepEqual(activeTasks(state).map(task => task.id), ["T-1", "T-2"], "the reset frees them, before a new reading");
});

test("only the limits of the agent tasks start with hold them, and a model's own limit holds only that model", () => {
  const codex = { key: "codex", name: "Codex", run: ["codex"] };
  let state = reduce(reduce(typed("One"), limited([fiveHour(99, null)]), 0), { type: "agent", value: codex }, 0);
  assert.equal(reduce(state, { type: "run" }, 0).tasks[0].status, "routing", "Claude's full limit doesn't hold Codex");
  state = reduce(state, limited([fiveHour(99, null)], { codex: { windows: [{ name: "Weekly", used: 100, resets: null, model: null }] } }), 0);
  assert.equal(reduce(state, { type: "run" }, 0).tasks[0].status, "queued");
  state = reduce(reduce(typed("One", "Two"), limited([fiveHour(40, null), { name: "Weekly Fable", used: 96, resets: null, model: "fable" }]), 0), { type: "run" }, 0);
  assert.equal(state.tasks.filter(task => task.status === "routing").length, 2, "no model set, so Fable's limit holds nothing");
  state = reduce({ ...reduce(typed("One", "Two"), limited([{ name: "Weekly Fable", used: 96, resets: null, model: "fable" }]), 0), tuning: { claude: { model: "fable" } } }, { type: "run" }, 0);
  assert.equal(activeTasks(state).length, 0);
  assert.match(state.plan, /Claude's weekly Fable limit is at 96%/);
  const other = { key: null, name: "Pi", run: ["pi"] };
  assert.equal(reduce(reduce(reduce(typed("One"), limited([fiveHour(100, null)]), 0), { type: "agent", value: other }, 0), { type: "run" }, 0).tasks[0].status, "routing");
});

test("the hold can move or go, and a failed read keeps the last good one", () => {
  let state = reduce(reduce(typed("One"), limited([fiveHour(93, null)]), 0), { type: "run" }, 0);
  assert.equal(model.limitHold(state), 90);
  state = reduce(state, { type: "limitHold", value: 95 }, 0);
  assert.equal(state.tasks[0].status, "routing");
  assert.equal(reduce(state, { type: "limitHold", value: 20 }, 0).limitHold, 50);
  assert.equal(reduce(state, { type: "limitHold", value: null }, 0).limitHold, null);
  assert.equal(reduce(createPipeline(context, 0), { type: "limitHold", value: 50 }, 0).limitHold, undefined, "Live only");
  state = reduce(state, { type: "limits", limits: { error: "Pipeline could not run Python." } }, 7);
  assert.deepEqual([state.limits.claude.windows[0].used, state.limits.error, state.limits.read], [93, "Pipeline could not run Python.", 7]);
  state = reduce(state, { type: "limits", limits: { claude: { error: "Claude Code isn't signed in on this machine.", missing: true }, codex: { windows: [{ name: "x", used: 140 }, null] } } }, 8);
  assert.deepEqual(state.limits.claude, { error: "Claude Code isn't signed in on this machine.", missing: true });
  assert.deepEqual(state.limits.codex, { windows: [] });
  assert.equal(state.limits.error, null);
});

test("the runner reads limits once per machine every five minutes, when asked, and right after a window resets", async () => {
  let reads = 0;
  const world = host(reduce(typed("One"), { type: "run" }, 0), { limits: async () => { reads++; return { claude: { windows: [fiveHour(95, 70000)] } }; } });
  world.store[`${LIVE}other`] = { ...createLive({ ...context, id: "other" }, 0) };
  world.store[`${LIVE}remote`] = { ...createLive({ ...context, id: "remote", on: "box" }, 0) };
  let clock = 1000;
  world.host.now = () => clock;
  world.host.start = () => "space";
  const runner = new live.LiveRunner(world.host);
  const jobs = [], cx = { spawn: fn => jobs.push(fn({ sleep: async () => {} })) };
  const tick = async at => { clock = at; runner.watchLimits(cx); await Promise.all(jobs.splice(0)); };
  await tick(1000);
  assert.equal(reads, 2, "this machine and the remote one");
  assert.equal(world.store[`${LIVE}other`].limits.claude.windows[0].used, 95, "both pipelines on a machine get its reading");
  await tick(30000);
  assert.equal(reads, 2);
  world.store[id] = reduce(world.store[id], { type: "readLimits" }, 31000);
  await tick(31000);
  assert.equal(reads, 3, "Read again");
  await tick(69999);
  assert.equal(reads, 3);
  await tick(70000);
  assert.equal(reads, 5, "the 5-hour window reset, on both machines");
  await tick(71000);
  assert.equal(reads, 5, "a reset counts once");
  await tick(70000 + model.LIMIT_READ - 1);
  assert.equal(reads, 5);
  await tick(70000 + model.LIMIT_READ);
  assert.equal(reads, 7);
});
