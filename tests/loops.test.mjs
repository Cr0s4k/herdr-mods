import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Execute the actual mod against a small native-element stand-in. These checks
// exercise deferred rows and actions that herdr-app check does not render.
const world = { spaces: [], panes: [], calls: [], result: null, execCalls: [] };
function native() {
  const target = { nodes: [], handlers: {} };
  let el;
  el = new Proxy(target, { get(t, key) {
    if (key in t) return t[key];
    if (key === "child") return (child) => { t.nodes.push(child); return el; };
    if (key === "children") return (children) => { t.nodes.push(...children); return el; };
    if (key === "when") return (condition, apply) => condition ? apply(el) : el;
    if (key === "on_click") return (handler) => { t.handlers.click = handler; return el; };
    return (...args) => { t[key + "Args"] = args; return el; };
  } });
  return el;
}
globalThis.__loopsNative = {
  View: class {}, div: native, svg: native, v_flex: native, h_flex: native,
  Button: { new: (id) => native().id(id) },
  appHome: () => "/tmp/herdr", spaces: () => world.spaces, panes: () => world.panes,
  exec: async (...args) => {
    world.execCalls.push(args);
    return typeof world.result === "function" ? world.result(...args) : world.result;
  }, run: (...args) => world.calls.push(args),
  theme: () => new Proxy({}, { get: (_, k) => k }),
};
const source = (await readFile(new URL("../mods/loops/main.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "")
  .replace("const STATUS", "const { View, div, svg, v_flex, h_flex, Button, appHome, spaces, panes, exec, run, theme } = globalThis.__loopsNative;\nconst STATUS");
const { default: Loops } = await import("data:text/javascript," + encodeURIComponent(source));
const goal = (id, cwd, status = "active") => ({ thread_id: id, objective: `Goal ${id}`, cwd, status,
  tokens_used: 250, token_budget: 1000, time_used_seconds: 90, updated_at_ms: 1000 });
const make = () => Object.assign(new Loops(), { items: [goal("one", "/work/app"), goal("two", "/work/app-other"),
  goal("done", "/work/app", "complete")], loading: false, all: false, completed: false });
function textOf(el) { return typeof el === "string" ? el : (el?.nodes ?? []).map(textOf).join(" "); }
function find(el, id) { return el?.idArgs?.[0] === id ? el : (el?.nodes ?? []).map((n) => find(n, id)).find(Boolean); }

test("scope uses live pane folders, with path boundaries and remote isolation", () => {
  world.spaces = [{ id: "space", active: true, folder: "/work/app-other", tabs: [{ id: "tab" }] }];
  world.panes = [{ tab: "tab", cwd: "/work/app/src" }];
  const loops = make();
  assert.deepEqual(loops.scope().items.map((g) => g.thread_id), ["one", "done"]);
  world.spaces[0].machine = "remote";
  assert.equal(loops.scope().items.length, 0);
  loops.all = true;
  assert.equal(loops.scope().items.length, 3);
});

test("completed history is opt-in, real rows render, and the session action names the exact thread", () => {
  world.spaces = [{ id: "space", active: true, tabs: [{ id: "tab" }] }];
  world.panes = [{ tab: "tab", cwd: "/work/app" }];
  world.calls = [];
  const loops = make();
  const root = loops.render();
  assert.match(textOf(root), /Goal one/);
  assert.doesNotMatch(textOf(root), /Goal done/);
  assert.match(textOf(root), /250 \/ 1,000 tokens/);
  find(root, "open-codex-one").handlers.click({}, {});
  assert.deepEqual(world.calls, [["tab.new", { name: "Codex goal", folder: "/work/app",
    argv: ["codex", "resume", "one"], space: "space" }]]);
  loops.completed = true;
  assert.match(textOf(loops.render()), /Goal done/);
});

test("failed refresh retains previous data and tells the user it is stale", async () => {
  const loops = make();
  loops.updated = 1000;
  world.result = { code: 1, stdout: JSON.stringify({ error: "Database is locked. Try refreshing." }) };
  await loops.reload({ notify() {} });
  assert.equal(loops.items.length, 3);
  assert.match(textOf(loops.render()), /Some goals may be from an earlier refresh/);
  world.result = { code: 0, stdout: JSON.stringify({ goals: [], warning: null }) };
  await loops.reload({ notify() {} });
  assert.equal(loops.items.length, 0);
  assert.equal(loops.error, null);
});

test("Claude goals have distinct IDs and copy their session without invoking a CLI", () => {
  world.spaces = [{ id: "space", active: true, folder: "/work/app" }];
  world.panes = [];
  world.calls = [];
  const loops = make();
  loops.items.push({ ...goal("one", "/work/app", "saved"), source: "claude",
    tokens_used: null, token_budget: null, time_used_seconds: null });
  const root = loops.render();
  assert.ok(find(root, "goal-codex-one"));
  const row = find(root, "goal-claude-one");
  assert.ok(row);
  assert.match(textOf(row), /Claude · \/goal/);
  assert.match(textOf(row), /Saved goal/);
  assert.match(textOf(row), /Metrics not recorded yet/);
  assert.doesNotMatch(textOf(row), /tokens|working time|Open session/);
  let copied;
  find(root, "copy-claude-one").handlers.click({}, { write_to_clipboard: (id) => { copied = id; }, notify() {} });
  assert.equal(copied, "one");
  assert.match(textOf(loops.render()), /Copied/);
  loops.open(loops.items.at(-1));
  assert.deepEqual(world.calls, []);
});

test("history includes Claude outcomes, with recorded metrics and without a fake budget", () => {
  const loops = make();
  loops.all = true;
  loops.items = ["complete", "cleared", "failed"].map((status) => ({
    ...goal(status, "/work/app", status), source: "claude", token_budget: null, iterations: 3,
  }));
  assert.doesNotMatch(textOf(loops.render()), /Goal complete|Goal cleared|Goal failed/);
  assert.match(textOf(loops.render()), /History \(3\)/);
  loops.completed = true;
  const text = textOf(loops.render());
  assert.match(text, /Completed/);
  assert.match(text, /Cleared/);
  assert.match(text, /Failed/);
  assert.match(text, /250 tokens used/);
  assert.match(text, /1m elapsed/);
  assert.match(text, /3 evaluated turns/);
});

test("each source refreshes independently and failures preserve only its previous goals", async () => {
  const loops = make();
  loops.items.push({ ...goal("claude-old", "/work/app", "saved"), source: "claude" });
  world.execCalls = [];
  world.result = (_command, args) => args[0].endsWith("claude-goals.py")
    ? { code: 1, stdout: JSON.stringify({ error: "Transcript unavailable" }) }
    : { code: 0, stdout: JSON.stringify({ goals: [goal("fresh", "/work/app")] }) };
  await loops.reload({ notify() {} });
  assert.deepEqual(loops.items.map((g) => [g.source, g.thread_id]), [["codex", "fresh"], ["claude", "claude-old"]]);
  assert.match(loops.error, /Claude: Transcript unavailable/);
  assert.deepEqual(world.execCalls.map(([command, args]) => [command, args[0]]), [
    ["python3", "/tmp/herdr/mods/loops/codex-goals.py"],
    ["python3", "/tmp/herdr/mods/loops/claude-goals.py"],
  ]);
  world.result = (_command, args) => args[0].endsWith("claude-goals.py")
    ? { code: 0, stdout: JSON.stringify({ goals: [] }) }
    : { code: 0, stdout: "null" };
  await loops.reload({ notify() {} });
  assert.deepEqual(loops.items.map((g) => g.thread_id), ["fresh"]);
  assert.match(loops.error, /Codex:/);
  world.result = { code: 0, stdout: JSON.stringify({ goals: [] }) };
  await loops.reload({ notify() {} });
  assert.deepEqual(loops.items, []);
  assert.equal(loops.error, null);
});

test("opening a local goal from a remote space creates a local space", () => {
  world.spaces = [{ id: "remote", active: true, machine: "vps" }];
  world.calls = [];
  make().open(goal("one", "/work/app"));
  assert.equal(world.calls[0][0], "space.new");
  assert.deepEqual(world.calls[0][1].argv, ["codex", "resume", "one"]);
  assert.equal(world.calls[0][1].folder, "/work/app");
});
