import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Run the actual native views against live-data snapshots. Exercise actions
// and async-free render paths that Herdr's initial mod check can't cover.
const world = { spaces: [], panes: [], agents: [], terminals: [], calls: [], order: [], width: 268 };
const preferences = new Map(), sharedState = new Map();
globalThis.localStorage = {
  getItem: k => preferences.get(k) ?? null,
  setItem: (k, v) => preferences.set(k, v),
};
function element() {
  const target = { nodes: [], handlers: {}, styles: {} };
  let el;
  el = new Proxy(target, { get(t, key) {
    if (key in t) return t[key];
    if (key === "child") return child => { t.nodes.push(child); return el; };
    if (key === "children") return children => { t.nodes.push(...children); return el; };
    if (key === "when") return (condition, apply) => condition ? apply(el) : el;
    if (key.startsWith("on_")) return (...args) => { t.handlers[key.slice(3) + (args.length > 1 ? `-${args[0]}` : "")] = args.at(-1); return el; };
    return (...args) => { t.styles[key] = args; return el; };
  } });
  return el;
}
const cx = { notify() {}, stop_propagation() {}, spawn() {}, timer: { every() {} } };
globalThis.__spacesNative = {
  View: class {}, div: element, svg: element, image: element, h_flex: element, v_flex: element,
  spaces: () => world.spaces, panes: () => world.panes, agents: () => world.agents,
  terminals: () => world.terminals, focused: () => ({ agent: world.agents.find(a => a.focused)?.address }),
  machines: () => [], run: (...args) => world.calls.push(args),
  setAgentOrder: order => { world.order = order; },
  theme: () => new Proxy({}, { get: (_, key) => key }),
  shared: k => sharedState.get(k), setShared: (k, v) => sharedState.set(k, v),
  window: () => ({ active: true, platform: "macos" }), layout: () => ({ id: "sidebar", size: { px: world.width } }),
};
let source = (await readFile(new URL("../mods/spaces-pin/agent-tree.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "");
source = "const { div, image, svg, h_flex, v_flex, agents, terminals, focused, run, setAgentOrder } = globalThis.__spacesNative;\n" + source;
const { AgentTree, branch } = await import("data:text/javascript," + encodeURIComponent(source));
Object.assign(globalThis.__spacesNative, { AgentTree, branch });
source = (await readFile(new URL("../mods/spaces-pin/main.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "");
source = "const { View, div, svg, v_flex, h_flex, spaces, machines, panes, run, theme, shared, setShared, window, layout, AgentTree, branch } = globalThis.__spacesNative;\n" + source;
const { default: Spaces } = await import("data:text/javascript," + encodeURIComponent(source));
const program = { name: "Codex", key: "codex", icon: "icons/codex.png", agent: true };
const space = (id, active = false) => ({ id, name: id, folder: `/work/${id}`, active, tabs: [{ id: `${id}-tab`, name: "1", named: false }] });
const agent = (id, sp, status = "idle", extra = {}) => ({ address: id, pane: `${id}-pane`, space: sp, tab: `${sp}-tab`, tab_index: 1,
  title: `Task ${id}`, status, program, pinned: false, focused: false, ...extra });
function setup() {
  preferences.clear(); sharedState.clear();
  Object.assign(world, { spaces: [space("app", true), space("other")], panes: [], agents: [agent("one", "app", "working"), agent("two", "other")],
    terminals: [], calls: [], order: [], width: 268 });
  const view = new Spaces(); view.init({}, cx); return view;
}
function find(el, id) { return el?.styles?.id?.[0] === id ? el : (el?.nodes ?? []).map(n => find(n, id)).find(Boolean); }
function text(el) { return typeof el === "string" ? el : (el?.nodes ?? []).map(text).join(" "); }
function click(root, id) { const el = find(root, id); assert.ok(el, `Missing ${id}`); el.handlers.click({}, cx); }

test("one tree places agents inside their owning space and focuses the exact pane", () => {
  const view = setup(), root = view.render();
  assert.ok(find(find(root, "space-tree-app"), "ag-one"));
  assert.equal(find(find(root, "space-tree-app"), "ag-two"), undefined);
  assert.ok(find(find(root, "space-tree-other"), "ag-two"));
  click(root, "ag-two");
  assert.deepEqual(world.calls, [["pane.focus", { pane: "two-pane" }]]);
  assert.deepEqual(world.order, ["one", "two"]);
});

test("space chevrons persist folds without switching focus or losing keyboard navigation", () => {
  const view = setup();
  click(view.render(), "space-fold-app");
  const root = view.render();
  assert.equal(find(root, "ag-one"), undefined);
  assert.ok(find(root, "space-app"));
  assert.deepEqual(world.calls, []);
  assert.deepEqual(world.order, ["one", "two"]);
  const restored = new Spaces(); restored.init({}, cx);
  assert.equal(find(restored.render(), "ag-one"), undefined);
  click(root, "space-fold-app");
  assert.ok(find(view.render(), "ag-one"));
});

test("hidden subagents raise space urgency and the filter reveals their full ancestry", () => {
  const view = setup();
  world.terminals = [{ address: "child", parent: "one", state: "live", status: "error", name: "Approval", program },
    { address: "quiet", parent: "one", state: "live", status: "working", program }];
  let root = view.render();
  assert.equal(find(root, "ag-child"), undefined);
  assert.deepEqual(view.agents.summary(["app"]), { status: "blocked", count: 1, blocked: 1 });
  click(root, "space-fold-app");
  click(view.render(), "spaces-needs-you");
  root = view.render();
  assert.ok(find(root, "ag-one"));
  assert.ok(find(root, "ag-child"));
  assert.equal(find(root, "ag-quiet"), undefined);
  assert.equal(find(root, "space-other"), undefined);
  click(root, "ag-child");
  assert.deepEqual(world.calls, [["terminal.peek", { terminal: "child" }]]);
  click(root, "spaces-needs-you");
  assert.equal(find(view.render(), "ag-one"), undefined);
});

test("statuses appear on agents, space rows stay quiet, and completed subagents do not create unread work", () => {
  const view = setup(); world.agents[0].status = "done";
  world.terminals = [{ address: "child", parent: "one", state: "live", status: "done", program }];
  click(view.render(), "space-fold-app");
  const root = view.render();
  assert.equal(find(root, "ag-one"), undefined);
  assert.equal(view.agents.summary(["app"]).count, 1);
  assert.equal(text(find(root, "space-app")).trim(), "A app");
  click(root, "space-fold-app");
  assert.equal(find(view.render(), "ag-one").styles.accessibility_label[0], "Task one, Done");
  world.agents[0].status = "idle";
  assert.equal(find(view.render(), "ag-one").styles.accessibility_label[0], "Task one, Idle");
  assert.equal(view.agents.summary(["app"]).status, "idle");
});

test("agent pins reorder only their own space and status changes never reorder agents", () => {
  const view = setup();
  world.agents = [agent("one", "app"), agent("three", "app", "working", { pinned: true }), agent("two", "other")];
  let root = view.render();
  assert.deepEqual(world.order, ["three", "one", "two"]);
  click(root, "agent-pin-three");
  assert.deepEqual(world.calls, [["terminal.pin", { terminal: "three", pinned: false }]]);
  world.agents[0].status = "blocked"; view.render();
  assert.deepEqual(world.order, ["three", "one", "two"]);
});

test("kept subagents appear once, in their own space, and cyclic terminal metadata is bounded", () => {
  const view = setup();
  world.agents.push(agent("child", "other", "blocked"));
  world.terminals = [{ address: "child", parent: "one", state: "live", status: "blocked" },
    { address: "cycle", parent: "cycle", state: "live", status: "working" }];
  const root = view.render();
  assert.equal(find(find(root, "space-tree-app"), "ag-child"), undefined);
  assert.ok(find(find(root, "space-tree-other"), "ag-child"));
  assert.equal(view.agents.summary(["app"]).blocked, 0);
  assert.ok(view.agents.descendants("cycle").length <= 1);
});

test("named tabs win, path-like titles fall back to the program, and split agents have unique labels", () => {
  const view = setup();
  world.spaces[0].tabs[0] = { id: "app-tab", name: "Review", named: true };
  world.agents = [agent("one", "app"), agent("split", "app"), agent("two", "other", "idle", { title: "/work/other" })];
  view.render();
  assert.equal(view.agents.labels.get("one"), "Review · one");
  assert.equal(view.agents.labels.get("split"), "Review · split");
  assert.equal(view.agents.labels.get("two"), "Codex");
});

test("worktrees fold under the checkout and retain pins and rail access without space status badges", () => {
  const view = setup();
  world.spaces = [space("app", true), space("worktree"), space("other")];
  world.agents = [agent("one", "app"), agent("two", "worktree", "blocked")];
  view.shown.add("worktree");
  view.git = {
    '[null,"/work/app"]': { repo: "repo", name: "app", branch: "main", linked: false },
    '[null,"/work/worktree"]': { repo: "repo", name: "app", branch: "feature", linked: true },
  };
  let root = view.render();
  assert.ok(find(root, "space-worktree"));
  assert.equal(find(root, "ag-two"), undefined); // Worktrees start folded.
  assert.equal(text(find(root, "space-app")).trim(), "A app");
  click(root, "space-fold-worktree");
  assert.ok(find(view.render(), "ag-two"));
  click(view.render(), "space-fold-app");
  root = view.render();
  assert.equal(find(root, "space-worktree"), undefined);
  assert.deepEqual(world.order, ["one", "two"]);
  world.width = 76; root = view.render();
  assert.ok(find(root, "space-worktree"));
  assert.equal(text(find(root, "space-app")).trim(), "1");
  assert.equal(text(find(root, "space-worktree")).trim(), "2");
  assert.ok(find(root, "spaces-expand-sidebar"));
  click(root, "spaces-expand-sidebar");
  assert.deepEqual(world.calls.at(-1), ["layout.resize", { id: "sidebar", px: 268 }]);
});

test("the attention filter gives a way back when the last blocked agent becomes idle", () => {
  const view = setup(); world.agents[0].status = "blocked";
  click(view.render(), "spaces-needs-you");
  assert.ok(find(view.render(), "ag-one"));
  world.agents[0].status = "idle";
  const root = view.render();
  assert.match(text(root), /No agents need you/);
  click(root, "spaces-show-all");
  assert.ok(find(view.render(), "space-other"));
});

test("the attention filter reveals folded remote machines without saving new folds", () => {
  const view = setup();
  world.spaces.push({ ...space("vps/app"), machine: "vps" });
  world.agents.push(agent("vps/remote", "vps/app", "blocked"));
  view.shown.add("vps/app");
  view.machines = [{ name: "vps", state: "connected" }];
  view.folded.add("vps");
  let root = view.render();
  assert.ok(find(root, "machine-vps"));
  assert.equal(find(root, "ag-vps/remote"), undefined);
  click(root, "spaces-needs-you");
  root = view.render();
  assert.ok(find(root, "ag-vps/remote"));
  click(root, "ag-vps/remote");
  assert.deepEqual(world.calls, [["pane.focus", { pane: "vps/remote-pane" }]]);
  click(root, "spaces-needs-you");
  assert.equal(find(view.render(), "ag-vps/remote"), undefined);
  assert.ok(view.folded.has("vps"));
});

test("the shipped custom layout mounts a single list and keeps the agent panel out", async () => {
  const layout = JSON.parse(await readFile(new URL("../layouts/main-custom.json", import.meta.url), "utf8"));
  const mods = [];
  const walk = n => { if (n.content?.mod) mods.push(n.content.mod); (n.children ?? []).forEach(walk); };
  walk(layout);
  assert.equal(mods.filter(m => m === "spaces-pin").length, 1);
  assert.equal(mods.includes("agents"), false);
});
