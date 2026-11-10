import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../mods/pipeline/pipeline-model.js", import.meta.url), "utf8");
const { createPipeline, reduce, activeTasks, outstanding, waitingReason } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const context = { id: "project", name: "Project", cwd: "/project", on: null };
const fresh = () => createPipeline(context, 0);
const tick = (state, count = 1) => {
  for (let i = 0; i < count; i++) state = reduce(state, { type: "tick" }, state.lastTick + 1000);
  return state;
};
const row = (state, id) => state.tasks.find(task => task.id === id);
const approve = (state, id) => {
  for (const repo of row(state, id).repos) state = reduce(state, { type: "approve", id, repo });
  return state;
};

test("planner fills capacity with independent work, preserving dependencies", () => {
  const state = reduce(fresh(), { type: "run" }, 0);
  assert.deepEqual(activeTasks(state).map(task => task.id), ["DEMO-101", "DEMO-104", "DEMO-105"]);
  assert.equal(row(state, "DEMO-102").status, "queued");
  assert.match(waitingReason(state, row(state, "DEMO-102")), /101.*merge/);
  assert.match(state.plan, /Holding.*102.*103/);
});

test("cross-repository approval waits for every PR and dependency releases only after merge", () => {
  let state = tick(reduce(fresh(), { type: "run" }, 0), 19);
  assert.equal(row(state, "DEMO-101").status, "review");
  assert.equal(activeTasks(state).length, 0);
  state = reduce(state, { type: "approve", id: "DEMO-101", repo: "contracts" });
  assert.equal(row(state, "DEMO-101").status, "review");
  state = reduce(state, { type: "approve", id: "DEMO-101", repo: "api" });
  assert.equal(row(state, "DEMO-101").status, "merging");
  assert.equal(row(state, "DEMO-102").status, "queued");
  state = tick(state, 4);
  assert.equal(row(state, "DEMO-101").status, "done");
  assert.equal(row(state, "DEMO-102").status, "routing");
});

test("approval waits free worker slots, with a separate outstanding PR limit", () => {
  let state = tick(reduce(fresh(), { type: "run" }, 0), 19);
  state = reduce(state, { type: "reviewLimit", value: 3 });
  state = reduce(state, { type: "add", ids: ["DEMO-106"] });
  assert.equal(row(state, "DEMO-106").status, "queued");
  assert.equal(outstanding(state).length, 3);
  assert.match(waitingReason(state, row(state, "DEMO-106")), /PR limit/);
  state = reduce(state, { type: "reviewLimit", value: 5 });
  assert.equal(row(state, "DEMO-106").status, "routing");
});

test("quota reserve stops dispatch; replenishing resumes without duplicating work", () => {
  let state = reduce(fresh(), { type: "quota", value: 22 });
  state = reduce(state, { type: "run" }, 0);
  assert.equal(activeTasks(state).length, 0);
  assert.match(state.plan, /quota reserve/);
  state = reduce(state, { type: "quota", value: 31 });
  assert.equal(activeTasks(state).length, 2);
  assert.equal(state.quota, 15);
  assert.ok(activeTasks(state).every(task => task.attempts === 1));
  state = tick(state, 2);
  assert.equal(activeTasks(state).length, 2);
});

test("lowering concurrency and pausing intake preserve active tasks", () => {
  let state = reduce(fresh(), { type: "run" }, 0);
  state = reduce(state, { type: "parallel", value: 1 });
  state = reduce(state, { type: "run" });
  state = reduce(state, { type: "add", ids: ["DEMO-106"] });
  assert.equal(activeTasks(state).length, 3);
  state = tick(state, 19);
  assert.equal(activeTasks(state).length, 0);
  assert.equal(row(state, "DEMO-106").status, "queued");
  state = reduce(state, { type: "run" });
  assert.equal(activeTasks(state).length, 1);
});

test("picked and watched tasks share a deduplicated queue, including new arrivals", () => {
  let state = reduce(fresh(), { type: "watch" });
  state = reduce(state, { type: "arrival" });
  assert.equal(row(state, "DEMO-106").status, "queued");
  assert.equal(row(state, "DEMO-106").source, "Watch · Ready");
  state = reduce(state, { type: "add", ids: ["DEMO-106", "DEMO-106"] });
  assert.equal(state.tasks.filter(task => task.id === "DEMO-106").length, 1);
  assert.equal(state.events.filter(item => item.message.startsWith("DEMO-106 joined")).length, 1);
  state = reduce(state, { type: "watch" });
  state = reduce(state, { type: "arrival" });
  assert.equal(row(state, "DEMO-107").status, "backlog");
});

test("direct delivery merges checked work; existing PRs retain their approval policy", () => {
  let state = tick(reduce(fresh(), { type: "run" }, 0), 19);
  state = reduce(state, { type: "delivery", value: "direct" });
  assert.equal(row(state, "DEMO-101").status, "review");
  state = reduce(state, { type: "add", ids: ["DEMO-106"] });
  state = tick(state, 19);
  assert.equal(row(state, "DEMO-106").status, "merging");
});

test("merges sharing a repository serialize, while independent repositories may merge", () => {
  let state = fresh();
  for (const id of ["DEMO-101", "DEMO-102", "DEMO-104"]) {
    const task = row(state, id); task.status = "review"; task.delivery = "pr"; task.approvals = [...task.repos];
  }
  state = reduce(state, { type: "tick" }, 1000);
  assert.equal(row(state, "DEMO-101").status, "merging");
  assert.equal(row(state, "DEMO-102").status, "review");
  assert.equal(row(state, "DEMO-104").status, "merging");
  state = tick(state, 4);
  assert.equal(row(state, "DEMO-102").status, "merging");
});

test("failed checks require an explicit retry and do not produce PRs", () => {
  let state = reduce(fresh(), { type: "fail" });
  state = tick(reduce(state, { type: "run" }, 0), 19);
  assert.equal(row(state, "DEMO-101").status, "failed");
  state = tick(state, 10);
  assert.equal(row(state, "DEMO-101").attempts, 1);
  state = reduce(state, { type: "retry", id: "DEMO-101" });
  assert.equal(row(state, "DEMO-101").status, "routing");
  assert.equal(row(state, "DEMO-101").attempts, 2);
});

test("sleep and restart do not fast-forward work; duplicate tracker ticks are ignored", () => {
  const before = reduce(fresh(), { type: "run" }, 0);
  const after = reduce(before, { type: "tick" }, 86400000);
  assert.equal(row(after, "DEMO-101").status, "routing");
  assert.equal(row(after, "DEMO-101").elapsed, 1200);
  assert.equal(reduce(after, { type: "tick" }, 86400000), after);
  assert.equal(row(before, "DEMO-101").elapsed, 0, "reducer preserves previous snapshots");
});

test("the background tracker advances a closed view's pipeline and duplicate owners cannot tick twice", async () => {
  const callbacks = [];
  const values = new Map([["pipeline.prototype.v1", { project: reduce(fresh(), { type: "run" }, 0) }]]);
  globalThis.__pipelineTracker = { ...modelExports(), shared: key => values.get(key), setShared: (key, value) => values.set(key, value) };
  const trackerSource = (await readFile(new URL("../mods/pipeline/tracker.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
  const { PipelineTracker } = await import(`data:text/javascript,${encodeURIComponent(`const { STORE, reduce, ACTIVE, shared, setShared } = globalThis.__pipelineTracker;\n${trackerSource}`)}`);
  const host = { timer: { every: (_ms, fn) => callbacks.push(fn) } };
  new PipelineTracker().start(host); new PipelineTracker().start(host);
  const original = Date.now;
  try {
    Date.now = () => 1000;
    callbacks[0](); callbacks[1]();
    const state = values.get("pipeline.prototype.v1").project;
    assert.equal(row(state, "DEMO-101").elapsed, 1000);
    assert.equal(row(state, "DEMO-101").attempts, 1);
  } finally { Date.now = original; }
});

function modelExports() { return { STORE: "pipeline.prototype.v1", reduce, ACTIVE: ["routing", "working", "testing"] }; }
