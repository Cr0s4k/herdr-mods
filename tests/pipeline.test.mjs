import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../mods/pipeline/pipeline-model.js", import.meta.url), "utf8");
const model = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const { createPipeline, reduce, activeTasks, outstanding, waitingReason, migrate, progress, guessRepos, needsApproval } = model;
const context = { id: "project", name: "Project", cwd: "/project", on: null };
let clock = 0;
const fresh = () => { clock = 0; return createPipeline(context, 0); };
const act = (state, action) => reduce(state, action, clock);
const tick = (state, count = 1) => {
  for (let i = 0; i < count; i++) { clock += 1000; state = reduce(state, { type: "tick" }, clock); }
  return state;
};
const row = (state, id) => state.tasks.find(task => task.id === id);
const review = (state, ids) => {
  for (const id of ids) { const task = row(state, id); task.status = "review"; task.delivery = "pr"; task.approvals = []; }
  return state;
};

test("planner fills capacity with independent work, preserving dependencies", () => {
  const state = act(fresh(), { type: "run" });
  assert.deepEqual(activeTasks(state).map(task => task.id), ["DEMO-101", "DEMO-104", "DEMO-105"]);
  assert.equal(row(state, "DEMO-102").status, "queued");
  assert.match(waitingReason(state, row(state, "DEMO-102")), /101.*merge/);
  assert.match(state.plan, /Holding.*102.*103/);
});

test("stages advance on their own durations and record when each began", () => {
  let state = act(fresh(), { type: "run" });
  state = tick(state, 3);
  assert.equal(row(state, "DEMO-101").status, "working");
  assert.equal(row(state, "DEMO-101").since, 2200);
  state = tick(state, 9);
  assert.equal(row(state, "DEMO-101").status, "testing");
  state = tick(state, 6);
  assert.equal(row(state, "DEMO-101").status, "review");
  assert.equal(row(state, "DEMO-101").slot, null);
});

test("cross-repository approval waits for every PR and dependency releases only after merge", () => {
  let state = tick(act(fresh(), { type: "run" }), 19);
  assert.equal(row(state, "DEMO-101").status, "review");
  assert.equal(activeTasks(state).length, 0);
  state = act(state, { type: "approve", id: "DEMO-101", repo: "contracts" });
  assert.equal(row(state, "DEMO-101").status, "review");
  state = act(state, { type: "approve", id: "DEMO-101", repo: "api" });
  assert.equal(row(state, "DEMO-101").status, "merging");
  assert.equal(row(state, "DEMO-102").status, "queued");
  state = tick(state, 4);
  assert.equal(row(state, "DEMO-101").status, "done");
  assert.equal(row(state, "DEMO-102").status, "routing");
});

test("one action approves every PR of a task, or of every task awaiting approval", () => {
  let state = review(fresh(), ["DEMO-101", "DEMO-104"]);
  state = act(state, { type: "approve", id: "DEMO-101" });
  assert.deepEqual(row(state, "DEMO-101").approvals, ["contracts", "api"]);
  assert.equal(row(state, "DEMO-101").status, "merging");
  state = review(fresh(), ["DEMO-101", "DEMO-102", "DEMO-104"]);
  state = act(state, { type: "approveAll" });
  assert.equal(state.tasks.filter(needsApproval).length, 0);
  assert.equal(row(state, "DEMO-101").status, "merging");
  assert.equal(row(state, "DEMO-102").status, "review", "api is already merging for DEMO-101");
  assert.equal(row(state, "DEMO-104").status, "merging");
  assert.equal(act(state, { type: "approveAll" }), state, "nothing left to approve");
});

test("approval waits free worker slots, with a separate outstanding PR limit", () => {
  let state = tick(act(fresh(), { type: "run" }), 19);
  state = act(state, { type: "reviewLimit", value: 3 });
  state = act(state, { type: "add", ids: ["DEMO-106"] });
  assert.equal(row(state, "DEMO-106").status, "queued");
  assert.equal(outstanding(state).length, 3);
  assert.match(waitingReason(state, row(state, "DEMO-106")), /PR limit/);
  state = act(state, { type: "reviewLimit", value: 5 });
  assert.equal(row(state, "DEMO-106").status, "routing");
});

test("quota reserve stops dispatch; replenishing resumes without duplicating work", () => {
  let state = act(fresh(), { type: "quota", value: 22 });
  state = act(state, { type: "run" });
  assert.equal(activeTasks(state).length, 0);
  assert.match(state.plan, /quota reserve/);
  state = act(state, { type: "quota", value: 31 });
  assert.equal(activeTasks(state).length, 2);
  assert.equal(state.quota, 15);
  assert.ok(activeTasks(state).every(task => task.attempts === 1));
  state = tick(state, 2);
  assert.equal(activeTasks(state).length, 2);
});

test("lowering concurrency and pausing intake preserve active tasks", () => {
  let state = act(fresh(), { type: "run" });
  state = act(state, { type: "parallel", value: 1 });
  state = act(state, { type: "run" });
  state = act(state, { type: "add", ids: ["DEMO-106"] });
  assert.equal(activeTasks(state).length, 3);
  state = tick(state, 19);
  assert.equal(activeTasks(state).length, 0);
  assert.equal(row(state, "DEMO-106").status, "queued");
  state = act(state, { type: "run" });
  assert.equal(activeTasks(state).length, 1);
});

test("picked and watched tasks share a deduplicated queue, including new arrivals", () => {
  let state = act(fresh(), { type: "watch" });
  state = act(state, { type: "arrival" });
  assert.equal(row(state, "DEMO-106").status, "queued");
  assert.equal(row(state, "DEMO-106").source, "Watch · Ready");
  state = act(state, { type: "add", ids: ["DEMO-106", "DEMO-106"] });
  assert.equal(state.tasks.filter(task => task.id === "DEMO-106").length, 1);
  assert.equal(state.events.filter(item => item.message.startsWith("DEMO-106 joined")).length, 1);
  state = act(state, { type: "watch" });
  state = act(state, { type: "arrival" });
  assert.equal(row(state, "DEMO-107").status, "backlog");
});

test("typed tasks join the queue with repositories guessed from the title, and can be changed while waiting", () => {
  let state = act(fresh(), { type: "create", title: "  Document the   login endpoint  " });
  const task = row(state, "NEW-1");
  assert.equal(task.title, "Document the login endpoint");
  assert.equal(task.status, "queued");
  assert.equal(task.source, "Created");
  assert.deepEqual(task.repos, ["api", "docs"]);
  assert.deepEqual(guessRepos("Something vague", 1), ["web"]);
  assert.equal(act(state, { type: "create", title: "   " }), state);
  state = act(state, { type: "repos", id: "NEW-1", repo: "web" });
  assert.deepEqual(row(state, "NEW-1").repos, ["api", "web", "docs"]);
  state = act(state, { type: "repos", id: "NEW-1", repo: "api" });
  state = act(state, { type: "repos", id: "NEW-1", repo: "docs" });
  assert.deepEqual(row(state, "NEW-1").repos, ["web"]);
  assert.equal(act(state, { type: "repos", id: "NEW-1", repo: "web" }), state, "a task keeps at least one repository");
});

test("adding everything and generating examples keeps the queue supplied", () => {
  let state = act(fresh(), { type: "addAll" });
  assert.equal(state.tasks.filter(task => task.status === "backlog").length, 0);
  state = act(state, { type: "generate", count: 3 });
  assert.deepEqual(state.tasks.slice(-3).map(task => [task.id, task.status]), [["DEMO-109", "queued"], ["DEMO-110", "queued"], ["DEMO-111", "queued"]]);
  state = act(state, { type: "generate", count: 1 });
  assert.equal(state.tasks.at(-1).id, "DEMO-112");
});

test("direct delivery merges checked work; existing PRs retain their approval policy", () => {
  let state = tick(act(fresh(), { type: "run" }), 19);
  state = act(state, { type: "delivery", value: "direct" });
  assert.equal(row(state, "DEMO-101").status, "review");
  state = act(state, { type: "add", ids: ["DEMO-106"] });
  state = tick(state, 19);
  assert.equal(row(state, "DEMO-106").status, "merging");
});

test("merges sharing a repository serialize, while independent repositories may merge", () => {
  let state = fresh();
  for (const id of ["DEMO-101", "DEMO-102", "DEMO-104"]) {
    const task = row(state, id); task.status = "review"; task.delivery = "pr"; task.approvals = [...task.repos];
  }
  state = act(state, { type: "reviewLimit", value: 5 });
  assert.equal(row(state, "DEMO-101").status, "merging");
  assert.equal(row(state, "DEMO-102").status, "review");
  assert.equal(row(state, "DEMO-104").status, "merging");
  state = tick(state, 4);
  assert.equal(row(state, "DEMO-102").status, "merging");
});

test("failed checks require an explicit retry and do not produce PRs", () => {
  let state = act(fresh(), { type: "fail" });
  state = tick(act(state, { type: "run" }), 19);
  assert.equal(row(state, "DEMO-101").status, "failed");
  state = tick(state, 10);
  assert.equal(row(state, "DEMO-101").attempts, 1);
  state = act(state, { type: "retry", id: "DEMO-101" });
  assert.equal(row(state, "DEMO-101").status, "routing");
  assert.equal(row(state, "DEMO-101").attempts, 2);
});

test("retry without a task returns every failed task to the queue", () => {
  let state = fresh();
  for (const id of ["DEMO-104", "DEMO-105"]) { row(state, id).status = "failed"; row(state, id).error = "x"; }
  state = act(state, { type: "retry" });
  assert.deepEqual(["DEMO-104", "DEMO-105"].map(id => row(state, id).status), ["queued", "queued"]);
});

test("changing speed keeps each stage's progress", () => {
  let state = tick(act(fresh(), { type: "run" }), 7);
  const before = progress(state, row(state, "DEMO-101"), clock);
  state = act(state, { type: "speed", value: 4 });
  assert.equal(state.speed, 4);
  assert.ok(Math.abs(progress(state, row(state, "DEMO-101"), clock) - before) < 1e-9);
  state = tick(state, 2);
  assert.equal(row(state, "DEMO-101").status, "testing");
});

test("idle ticks return the same state, so nothing is written", () => {
  const state = review(act(fresh(), { type: "run" }), ["DEMO-101", "DEMO-104", "DEMO-105"]);
  assert.equal(reduce(state, { type: "tick" }, clock + 60000), state);
});

test("a tick that only lets time pass returns the same state", () => {
  const state = act(fresh(), { type: "run" });
  assert.equal(reduce(state, { type: "tick" }, 1500), state);
});

test("a pause shifts active stages instead of fast-forwarding them", () => {
  const before = act(fresh(), { type: "run" });
  const after = reduce(before, { type: "tick", pause: 86399000 }, 86400000);
  assert.equal(row(after, "DEMO-101").status, "routing");
  assert.equal(row(after, "DEMO-101").since, 86399000);
  assert.equal(reduce(after, { type: "tick" }, 86400000), after);
  assert.equal(row(before, "DEMO-101").since, 0, "reducer preserves previous snapshots");
});

test("saved version 1 pipelines migrate their elapsed time", () => {
  const legacy = { ...createPipeline(context, 0), version: 1 };
  legacy.tasks = legacy.tasks.map(({ since, ...task }) => ({ ...task, elapsed: task.id === "DEMO-101" ? 4000 : 0 }));
  row(legacy, "DEMO-101").status = "working";
  const state = migrate(legacy, 10000);
  assert.equal(state.version, 2);
  assert.equal(row(state, "DEMO-101").since, 6000);
  assert.ok(!("elapsed" in row(state, "DEMO-101")));
  assert.equal(migrate(state, 20000), state);
});

async function tracker(values) {
  globalThis.__pipelineTracker = { ...model, shared: key => values.get(key), setShared: (key, value) => { values.set(key, value); values.writes = (values.writes ?? 0) + 1; } };
  const trackerSource = (await readFile(new URL("../mods/pipeline/tracker.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
  const { PipelineTracker } = await import(`data:text/javascript,${encodeURIComponent(`const { STORE, MOVING, reduce, migrate } = globalThis.__pipelineTracker;\nconst shared = key => globalThis.__pipelineTracker.shared(key), setShared = (key, value) => globalThis.__pipelineTracker.setShared(key, value);\n${trackerSource}`)}`);
  const callbacks = [];
  const host = { timer: { every: (_ms, fn) => callbacks.push(fn) } };
  new PipelineTracker().start(host); new PipelineTracker().start(host);
  return callbacks;
}

test("the background tracker advances a closed view's pipeline; duplicate owners neither tick nor shift twice", async () => {
  const values = new Map([["pipeline.prototype.v1", { project: act(fresh(), { type: "run" }) }]]);
  const callbacks = await tracker(values);
  const original = Date.now;
  const at = now => { Date.now = () => now; callbacks[0](); callbacks[1](); return row(values.get("pipeline.prototype.v1").project, "DEMO-101"); };
  try {
    assert.equal(at(1000).status, "routing");
    assert.equal(values.writes ?? 0, 0, "nothing changed, nothing written");
    const working = at(3000);
    assert.equal(working.status, "working");
    assert.equal(working.since, 2200);
    assert.equal(working.attempts, 1);
    assert.equal(at(60000).since, 58200, "a sleep shifts the stage once");
  } finally { Date.now = original; }
});

test("the tracker never writes for a running pipeline that is only waiting for approval", async () => {
  const state = review(act(fresh(), { type: "run" }), ["DEMO-101", "DEMO-104", "DEMO-105"]);
  const values = new Map([["pipeline.prototype.v1", { project: state }]]);
  const callbacks = await tracker(values);
  const original = Date.now;
  try {
    for (let now = 1000; now < 30000; now += 1000) { Date.now = () => now; callbacks[0](); }
    assert.equal(values.writes ?? 0, 0);
  } finally { Date.now = original; }
});

test("the tracker migrates a saved version 1 pipeline once", async () => {
  const legacy = { ...createPipeline(context, 0), version: 1 };
  legacy.tasks = legacy.tasks.map(({ since, ...task }) => ({ ...task, elapsed: 0 }));
  const values = new Map([["pipeline.prototype.v1", { project: legacy }]]);
  const callbacks = await tracker(values);
  const original = Date.now;
  try {
    Date.now = () => 5000; callbacks[0](); callbacks[0]();
    assert.equal(values.get("pipeline.prototype.v1").project.version, 2);
    assert.equal(values.writes, 1);
  } finally { Date.now = original; }
});
