import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Execute the actual mod against a small native-element stand-in. These checks
// exercise deferred rows and actions that herdr-app check does not render.
const world = { spaces: [], panes: [], calls: [], result: null, execCalls: [] };
const preferences = new Map();
globalThis.localStorage = { getItem: (key) => preferences.get(key) ?? null,
  setItem: (key, value) => preferences.set(key, value) };
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
  props: () => world.props ?? null,
  moveToPaneButton: kind => native().id(`move-${kind}-to-pane`),
};
const source = (await readFile(new URL("../mods/loops/main.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "")
  .replace("const STATUS", "const { View, div, svg, v_flex, h_flex, Button, appHome, spaces, panes, exec, run, theme, props, moveToPaneButton } = globalThis.__loopsNative;\nconst STATUS");
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
  assert.match(textOf(loops.render()), /Some entries may be from an earlier refresh/);
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
    : { code: 0, stdout: JSON.stringify({ goals: args[0].endsWith("codex-goals.py") ? [goal("fresh", "/work/app")] : [] }) };
  await loops.reload({ notify() {} });
  assert.deepEqual(loops.items.map((g) => [g.source, g.thread_id]), [["codex", "fresh"], ["claude", "claude-old"]]);
  assert.match(loops.error, /Claude: Transcript unavailable/);
  assert.deepEqual(world.execCalls.map(([command, args]) => [command, args[0]]), [
    ["python3", "/tmp/herdr/mods/loops/codex-goals.py"],
    ["python3", "/tmp/herdr/mods/loops/claude-goals.py"],
    ["python3", "/tmp/herdr/mods/loops/claude-loops.py"],
    ["python3", "/tmp/herdr/mods/loops/opencode-goals.py"],
  ]);
  world.result = (_command, args) => !args[0].endsWith("codex-goals.py")
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

test("scheduled rows show cadence and recorded state, with unique task IDs and no goal metrics", () => {
  const loops = make();
  loops.all = true;
  loops.items = ["first", "second"].map((id) => ({
    thread_id: "session", task_id: id, record_id: `session:${id}`, kind: "schedule", schedule_kind: "cron",
    objective: "Check deploy", cwd: "/work/app", status: "saved_schedule", source: "claude-loops",
    cron: "*/5 * * * *", recurring: true, recorded_next_run_ms: 1000,
    expires_at_ms: 2000, reason: "Last recorded schedule; session may be offline.",
  }));
  const root = loops.render();
  const first = find(root, "goal-claude-loops-session:first");
  assert.ok(first);
  assert.ok(find(root, "goal-claude-loops-session:second"));
  const text = textOf(first);
  assert.match(text, /Claude · scheduled task/);
  assert.match(text, /Saved schedule/);
  assert.match(text, /Recurring · \*\/5 \* \* \* \*/);
  assert.match(text, /Recorded run:/);
  assert.match(text, /Expiry:/);
  assert.match(text, /session may be offline/);
  assert.doesNotMatch(text, /tokens|working time|Metrics not recorded|Open session/);
  world.calls = [];
  let copied;
  find(root, "copy-claude-loops-session:first").handlers.click({}, { write_to_clipboard: (id) => { copied = id; }, notify() {} });
  assert.equal(copied, "session");
  loops.open(loops.items[0]);
  assert.deepEqual(world.calls, []);
});

test("ended schedules stay in history, and project schedules without sessions copy the task ID", () => {
  const loops = make();
  loops.all = true;
  loops.items = ["cancelled", "expired", "ended", "inactive", "schedule_due"].map((status) => ({
    kind: "schedule", schedule_kind: "dynamic", source: "claude-loops", thread_id: null,
    task_id: status, record_id: `project:${status}`, objective: `Schedule ${status}`, status,
  }));
  let root = loops.render();
  assert.match(textOf(root), /History \(4\)/);
  assert.doesNotMatch(textOf(root), /Schedule cancelled|Schedule expired|Schedule ended|Schedule inactive/);
  assert.match(textOf(root), /Run time passed/);
  assert.match(textOf(root), /Self-paced loop/);
  let copied;
  find(root, "copy-claude-loops-project:schedule_due").handlers.click({}, { write_to_clipboard: (id) => { copied = id; }, notify() {} });
  assert.equal(copied, "schedule_due");
  loops.completed = true;
  root = loops.render();
  assert.match(textOf(root), /Schedule cancelled/);
  assert.match(textOf(root), /Schedule expired/);
});

test("schedule reader gets local project folders, and its failure preserves schedules independently", async () => {
  world.spaces = [{ folder: "/work/app", tabs: [{ id: "local" }] },
    { folder: "/remote/project", machine: "remote", tabs: [{ id: "remote" }] }];
  world.panes = [{ tab: "local", cwd: "/work/app/src" }, { tab: "remote", cwd: "/remote/secret" }];
  world.execCalls = [];
  const loops = make();
  loops.items = [{ source: "claude-loops", kind: "schedule", status: "saved_schedule", record_id: "session:job", objective: "Keep me" }];
  world.result = (_command, args) => args[0].endsWith("claude-loops.py")
    ? { code: 1, stdout: JSON.stringify({ error: "Schedule snapshot unavailable" }) }
    : { code: 0, stdout: JSON.stringify({ goals: [] }) };
  await loops.reload({ notify() {} });
  assert.equal(loops.items.length, 1);
  assert.equal(loops.items[0].objective, "Keep me");
  assert.match(loops.error, /Claude schedules: Schedule snapshot unavailable/);
  const [command, args] = world.execCalls.find(([, args]) => args[0].endsWith("claude-loops.py"));
  assert.equal(command, "python3");
  assert.deepEqual(args.slice(1), ["--project", "/work/app", "--project", "/work/app/src"]);
});

test("opening a local goal from a remote space creates a local space", () => {
  world.spaces = [{ id: "remote", active: true, machine: "vps" }];
  world.calls = [];
  make().open(goal("one", "/work/app"));
  assert.equal(world.calls[0][0], "space.new");
  assert.deepEqual(world.calls[0][1].argv, ["codex", "resume", "one"]);
  assert.equal(world.calls[0][1].folder, "/work/app");
});

test("source toggles include Claude goals and schedules, update counts, and persist independently", (t) => {
  t.after(() => preferences.clear());
  preferences.clear();
  world.spaces = [{ active: true, folder: "/work/app" }];
  world.panes = [];
  const loops = make();
  loops.items.push({ ...goal("claude-goal", "/work/app", "saved"), source: "claude" },
    { ...goal("schedule", "/work/app", "saved_schedule"), source: "claude-loops", kind: "schedule" },
    { ...goal("cancelled", "/work/app", "cancelled"), source: "claude-loops", kind: "schedule" });
  const cx = { notify() {} };
  let root = loops.render();
  assert.equal(find(root, "loops-source-codex").selectedArgs[0], true);
  assert.equal(find(root, "loops-source-claude").selectedArgs[0], true);
  assert.match(textOf(root), /3 current/);
  assert.match(textOf(root), /History \(2\)/);
  find(root, "loops-source-claude").handlers.click({}, cx);
  root = loops.render();
  assert.ok(find(root, "goal-codex-one"));
  assert.equal(find(root, "goal-claude-claude-goal"), undefined);
  assert.equal(find(root, "goal-claude-loops-schedule"), undefined);
  assert.match(textOf(root), /1 current/);
  assert.match(textOf(root), /History \(1\)/);
  assert.equal(find(root, "loops-source-claude").selectedArgs[0], false);
  find(root, "loops-source-codex").handlers.click({}, cx);
  loops.items.push({ ...goal("ses_1", "/work/app", "paused"), source: "opencode", iterations: 2, tokens_used: null, time_used_seconds: null, reason: "Paused by the user" });
  root = loops.render();
  assert.match(textOf(find(root, "goal-opencode-ses_1")), /OpenCode · \/goal[\s\S]*Continued 2 times by its reviewer/);
  assert.doesNotMatch(textOf(find(root, "goal-opencode-ses_1")), /tokens|working time/);
  world.calls = [];
  loops.open(loops.items.at(-1));
  assert.deepEqual(world.calls[0][1].argv, ["opencode", "--session", "ses_1"]);
  find(root, "loops-source-opencode").handlers.click({}, cx);
  assert.equal(find(loops.render(), "goal-opencode-ses_1"), undefined);
  assert.match(textOf(loops.render()), /No sources selected/);
  const restored = new Loops();
  restored.init({}, { spawn() {}, timer: { every() {} } });
  assert.equal(restored.showCodex, false);
  assert.equal(restored.showClaude, false);
  find(loops.render(), "loops-source-claude").handlers.click({}, cx);
  root = loops.render();
  assert.equal(find(root, "goal-codex-one"), undefined);
  assert.ok(find(root, "goal-claude-claude-goal"));
  assert.ok(find(root, "goal-claude-loops-schedule"));
  assert.match(textOf(root), /2 current/);
  assert.match(textOf(root), /History \(1\)/);
  assert.equal(preferences.get("source-claude"), "true");
  assert.equal(preferences.get("source-codex"), "false");
});

test("hidden sources keep refreshing while their errors and warnings follow the source filter", async (t) => {
  t.after(() => preferences.clear());
  const loops = make();
  loops.all = true;
  loops.showClaude = false;
  world.result = (_command, args) => args[0].endsWith("claude-goals.py")
    ? { code: 1, stdout: JSON.stringify({ error: "Claude unavailable" }) }
    : { code: 0, stdout: JSON.stringify({ goals: args[0].endsWith("claude-loops.py")
      ? [{ ...goal("new-schedule", "/work/app", "saved_schedule"), kind: "schedule" }] : [],
    warning: args[0].endsWith("claude-loops.py") ? "Schedule folder unavailable" : null }) };
  await loops.reload({ notify() {} });
  assert.doesNotMatch(textOf(loops.render()), /Claude unavailable|Schedule folder unavailable|Goal new-schedule/);
  find(loops.render(), "loops-source-claude").handlers.click({}, { notify() {} });
  const root = loops.render();
  assert.match(textOf(root), /Claude unavailable/);
  assert.match(textOf(root), /Schedule folder unavailable/);
  assert.ok(find(root, "goal-claude-loops-new-schedule"));
  const initialized = new Loops();
  preferences.clear();
  initialized.init({}, { spawn() {}, timer: { every() {} } });
  assert.equal(initialized.showCodex, true);
  assert.equal(initialized.showClaude, true);
});

test("moving Loops to a pane restores its explicit filters over copy-local preferences", () => {
  preferences.set("scope", "space");
  preferences.set("completed", "false");
  preferences.set("source-codex", "true");
  preferences.set("source-claude", "false");
  world.props = { panelState: { all: true, completed: true, showCodex: false, showClaude: true } };
  try {
    const moved = new Loops();
    moved.init({}, { spawn() {}, timer: { every() {} } });
    assert.equal(moved.all, true);
    assert.equal(moved.completed, true);
    assert.equal(moved.showCodex, false);
    assert.equal(moved.showClaude, true);
  } finally { world.props = null; }
});
