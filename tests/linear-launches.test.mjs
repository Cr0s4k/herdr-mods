import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const world = {};
globalThis.__launchNative = {
  shared: key => world.shared.get(key), setShared: (key, value) => world.shared.set(key, value),
  spaces: () => world.spaces, panes: () => world.panes, focused: () => world.focus,
  terminals: () => world.terminals ?? [],
  appHome: () => "/app", readTextFile: async () => "script", exec: async () => ({ code: 0, stdout: JSON.stringify({ data: { cwd: "/worktree" } }) }),
  run: (command, args) => world.calls.push([command, args]),
};
let source = (await readFile(new URL("../mods/linear/launches.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = `const { ${Object.keys(globalThis.__launchNative).join(", ")} } = globalThis.__launchNative;\n` + source;
const { executeLaunch, queueLaunch, updateLaunch, retryLaunch, LaunchTracker, LAUNCHES, agentOpening } = await import("data:text/javascript," + encodeURIComponent(source));
const batch = () => ({ id: "batch", context: { space: "source", cwd: "/project", on: null }, agent: { name: "Codex", run: ["codex"] },
  plan: { base: "commit", common: "/project/.git", root: "/project" },
  rows: ["one", "two", "three"].map(id => ({ id, key: `PRO-${id}`, task: `Full task ${id}`, status: "queued" })) });
function setup(value = batch()) {
  Object.assign(world, { shared: new Map([[LAUNCHES, [value]]]), spaces: [{ id: "source", folder: "/project", tabs: [{ id: "source-tab" }] }], panes: [],
    focus: { space: "source", tab: "source-tab", pane: "source-pane" }, calls: [], operations: [], terminals: [] });
  return {
    get: id => world.shared.get(LAUNCHES).find(batch => batch.id === id), update: updateLaunch,
    create: async (batch, row) => { world.operations.push(["create", row.id]); return { cwd: `/worktree/${row.id}` }; },
    start: (batch, row) => { world.operations.push(["start", row.id]); assert.equal(row.workspace.cwd, `/worktree/${row.id}`); },
    locate: async (batch, workspace) => ({ space: workspace.cwd, terminal: workspace.cwd }),
  };
}

test("each ticket creates a workspace and starts exactly once; repeating the queue does nothing", async () => {
  const host = setup(); await executeLaunch("batch", host); await executeLaunch("batch", host);
  assert.deepEqual(world.operations, [["create", "one"], ["start", "one"], ["create", "two"], ["start", "two"], ["create", "three"], ["start", "three"]]);
  assert.ok(host.get("batch").rows.every(row => row.status === "launched"));
});

test("a workspace failure is per ticket and does not block the rest", async () => {
  const host = setup(), create = host.create;
  host.create = async (batch, row) => { if (row.id === "two") throw new Error("Disk full"); return create(batch, row); };
  await executeLaunch("batch", host);
  assert.deepEqual(host.get("batch").rows.map(row => row.status), ["launched", "failed", "launched"]);
  assert.equal(host.get("batch").rows[1].error, "Disk full");
});

test("stop during worktree creation retains that worktree without launching remaining agents", async () => {
  const host = setup(), create = host.create;
  host.create = async (batch, row) => { const workspace = await create(batch, row); updateLaunch("batch", batch => ({ ...batch, stop: true })); return workspace; };
  await executeLaunch("batch", host);
  assert.ok(host.get("batch").rows.every(row => row.status === "stopped"));
  assert.ok(host.get("batch").rows[0].workspace);
  assert.equal(world.operations.filter(([kind]) => kind === "start").length, 0);
});

test("an accepted but unconfirmed start is never retried automatically", async () => {
  const host = setup(); host.locate = async () => null;
  await executeLaunch("batch", host); await executeLaunch("batch", host);
  assert.ok(host.get("batch").rows.every(row => row.status === "check"));
  assert.equal(world.operations.filter(([kind]) => kind === "start").length, 3);
});

test("retrying a definite start failure reuses the created worktree", async () => {
  const host = setup(); host.start = () => { throw new Error("Machine disconnected"); };
  await executeLaunch("batch", host);
  updateLaunch("batch", batch => ({ ...batch, rows: batch.rows.map(row => ({ ...row, status: "queued" })) }));
  host.start = (batch, row) => world.operations.push(["start", row.id]);
  await executeLaunch("batch", host);
  assert.equal(world.operations.filter(([kind]) => kind === "create").length, 3);
  assert.ok(host.get("batch").rows.every(row => row.status === "launched"));
});

test("another panel cannot queue the same ticket while a launch or session exists", () => {
  setup(); const next = { ...batch(), id: "second" };
  assert.throws(() => queueLaunch(next), /already has an active launch/);
  updateLaunch("batch", batch => ({ ...batch, rows: batch.rows.map(row => ({ ...row, status: "launched", terminal: row.id })) }));
  world.panes = [{ terminal: "one" }];
  assert.throws(() => queueLaunch(next), /already has an active launch/);
  world.panes = [];
  queueLaunch(next); queueLaunch(next);
  assert.equal(world.shared.get(LAUNCHES).length, 2);
});

test("startup preserves uncertain launches without replaying any start", () => {
  const host = setup(); const tracker = new LaunchTracker();
  let tick;
  tracker.start({ timer: { every: (_ms, callback) => { tick = callback; } } });
  tick({ spawn() { throw new Error("Must not spawn interrupted launches"); } });
  assert.ok(host.get("batch").rows.every(row => row.status === "check"));
  assert.equal(world.calls.length, 0);
});

test("a parked live terminal still prevents a duplicate launch or retry from another batch", () => {
  setup();
  updateLaunch("batch", batch => ({ ...batch, rows: [{ ...batch.rows[0], status: "launched", terminal: "parked" }] }));
  world.terminals = [{ address: "parked", state: "live" }];
  assert.throws(() => queueLaunch({ ...batch(), id: "second" }), /already has an active launch/);
  const second = { ...batch(), id: "second", rows: [{ ...batch().rows[0], status: "failed" }] };
  world.shared.get(LAUNCHES).push(second);
  assert.throws(() => retryLaunch("second"), /already has an active launch/);
  assert.equal(second.rows[0].status, "failed");
});

test("losing launch ownership during worktree creation cannot start an agent", async () => {
  const host = setup(); let owned = true;
  const get = host.get; host.get = id => owned ? get(id) : null;
  host.create = async () => { owned = false; return { cwd: "/worktree/one" }; };
  await executeLaunch("batch", host);
  assert.equal(world.operations.length, 0);
});

test("background launch uses the captured machine and restores the user's current view", async () => {
  setup({ ...batch(), rows: batch().rows.slice(0, 1), context: { cwd: "/remote/project", on: "remote", space: "old" } });
  const tracker = new LaunchTracker(); tracker.start({ timer: { every() {} } });
  updateLaunch("batch", batch => ({ ...batch, rows: batch.rows.map(row => ({ ...row, status: "queued" })) }));
  world.spaces.push({ id: "remote/new", machine: "remote", folder: "/worktree", tabs: [{ id: "remote/tab", active: true }] });
  world.panes.push({ tab: "remote/tab", terminal: "remote/agent" });
  const tasks = [], cx = { spawn: fn => tasks.push(fn(cx)), notify() {}, sleep: async () => {} };
  tracker.pump(cx); tracker.pump(cx); await Promise.all(tasks);
  assert.equal(world.calls.filter(([command]) => command === "space.new").length, 1);
  assert.equal(world.calls[0][1].machine, "remote");
  assert.equal(world.calls[0][1].argv[0], "codex");
  assert.ok(world.calls[0][1].task.includes("Full task one"));
  assert.deepEqual(agentOpening({ key: "opencode", run: ["opencode"] }, "Do it"), { argv: ["opencode", "--prompt=Do it"] }, "OpenCode would read a last argument as its folder");
  assert.deepEqual(world.calls.slice(1).map(([command]) => command), ["space.select", "tab.select", "pane.focus"]);
});
