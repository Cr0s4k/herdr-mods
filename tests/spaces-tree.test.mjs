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
const cx = { notify() {}, stop_propagation() {}, spawn() {}, timer: { every() {} }, focus_handle() { return { focus() {}, is_focused: () => false }; } };
globalThis.__spacesNative = {
  View: class {}, div: element, svg: element, image: element, h_flex: element, v_flex: element,
  spaces: () => world.spaces, panes: () => world.panes, agents: () => world.agents,
  terminals: () => world.terminals, focused: () => ({ agent: world.agents.find(a => a.focused)?.address }),
  machines: () => [], run: (...args) => world.calls.push(args),
  setAgentOrder: order => { world.order = order; },
  theme: () => new Proxy({}, { get: (_, key) => key }),
  shared: k => sharedState.get(k), setShared: (k, v) => sharedState.set(k, v),
  props: () => world.menu, keys: () => [], closeOverlay: id => world.closed.push(id), openOverlay: options => world.opened.push(options),
  window: () => ({ active: true, platform: "macos" }), layout: () => ({ id: "sidebar", size: { px: world.width } }),
};
let source = (await readFile(new URL("../mods/space-hide/state.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = "const { shared, setShared } = globalThis.__spacesNative;\n" + source;
const hideState = await import("data:text/javascript," + encodeURIComponent(source));
Object.assign(globalThis.__spacesNative, hideState);
source = (await readFile(new URL("../mods/tabs-show/ui.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = "const { exec } = globalThis.__spacesNative;\n" + source;
Object.assign(globalThis.__spacesNative, await import("data:text/javascript," + encodeURIComponent(source)));
source = (await readFile(new URL("../mods/spaces-pin/agent-tree.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "");
source = "const { div, image, svg, h_flex, v_flex, agents, terminals, focused, run, setAgentOrder, spin } = globalThis.__spacesNative;\n" + source;
const { AgentTree, branch } = await import("data:text/javascript," + encodeURIComponent(source));
Object.assign(globalThis.__spacesNative, { AgentTree, branch });
const { STORE, LIVE, spaceKey } = await import("../mods/pipeline/pipeline-model.js");
globalThis.__spacesNative.spaceKey = spaceKey;
source = (await readFile(new URL("../mods/spaces-pin/pipeline-row.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = `const { div, svg, h_flex, run, shared, openOverlay, spaceKey } = globalThis.__spacesNative; const STORE = ${JSON.stringify(STORE)};\n` + source;
Object.assign(globalThis.__spacesNative, await import("data:text/javascript," + encodeURIComponent(source)));
source = (await readFile(new URL("../mods/spaces-pin/main.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "");
source = "const { View, div, svg, v_flex, h_flex, spaces, machines, panes, run, theme, shared, setShared, window, layout, AgentTree, branch, openOverlay, hiddenSpaces, expireSpaces, ink, watchMotion, nextCommand, spacePipeline, pipelineRow, openPipeline } = globalThis.__spacesNative;\n" + source;
const { default: Spaces } = await import("data:text/javascript," + encodeURIComponent(source));
const { reduce } = await import("../mods/pipeline/pipeline-model.js");
source = (await readFile(new URL("../mods/pipeline-close/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = `const { View, div, svg, v_flex, h_flex, run, props, shared, setShared, closeOverlay, theme } = globalThis.__spacesNative; const STORE = ${JSON.stringify(STORE)}, reduce = globalThis.__pipelineReduce;\n` + source;
globalThis.__pipelineReduce = reduce;
const { default: PipelineClose, closeDetail } = await import("data:text/javascript," + encodeURIComponent(source));
source = (await readFile(new URL("../mods/menu-pin/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = "const { View, div, svg, v_flex, h_flex, run, props, shared, setShared, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes } = globalThis.__spacesNative;\n" + source;
const { default: Menu } = await import("data:text/javascript," + encodeURIComponent(source));
globalThis.__spacesNative.Input = { new: element };
globalThis.__spacesNative.InputState = { new: options => ({ text: options.value ?? "", handlers: {},
  on(event, fn) { this.handlers[event] = fn; }, value() { return this.text; }, focus() {} }) };
source = (await readFile(new URL("../mods/space-hide/main.js", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
source = "const { View, div, svg, v_flex, h_flex, Input, InputState, props, spaces, theme, closeOverlay, openOverlay, hiddenSpaces, expireSpaces, hideSpace, restoreSpace, localTime, parseLocalTime, hideChoices } = globalThis.__spacesNative;\n" + source;
const { default: SpaceHide } = await import("data:text/javascript," + encodeURIComponent(source));
const program = { name: "Codex", key: "codex", icon: "icons/codex.png", agent: true };
const space = (id, active = false) => ({ id, name: id, folder: `/work/${id}`, active, tabs: [{ id: `${id}-tab`, name: "1", named: false }] });
const agent = (id, sp, status = "idle", extra = {}) => ({ address: id, pane: `${id}-pane`, space: sp, tab: `${sp}-tab`, tab_index: 1,
  title: `Task ${id}`, status, program, pinned: false, focused: false, ...extra });
function setup() {
  preferences.clear(); sharedState.clear();
  Object.assign(world, { spaces: [space("app", true), space("other")], panes: [], agents: [agent("one", "app", "working"), agent("two", "other")],
    terminals: [], calls: [], order: [], width: 268, menu: null, closed: [], opened: [] });
  const view = new Spaces(); view.init({}, cx); return view;
}
function find(el, id) { return el?.styles?.id?.[0] === id ? el : (el?.nodes ?? []).map(n => find(n, id)).find(Boolean); }
function text(el) { return typeof el === "string" ? el : (el?.nodes ?? []).map(text).join(" "); }
function click(root, id) { const el = find(root, id); assert.ok(el, `Missing ${id}`); el.handlers.click({}, cx); }

test("the sidebar plus opens the space choices without starting a terminal", () => {
  const view = setup();
  click(view.render(), "space-new");
  assert.deepEqual(world.calls, []);
  assert.deepEqual(world.opened, [{ mod: "space-new", kind: "popup", width: 300, height: 114 }]);
});

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

test("a worktree terminal first in a space keeps the checkout's name and groups its agents under the branch", () => {
  const view = setup();
  const app = { ...space("app", true), name: "t-4-fix-8a32", tabs: [{ id: "pipe-tab", name: "Pipeline" }, { id: "task-tab", name: "T-4", named: true }, { id: "app-tab", name: "3" }] };
  world.spaces = [app];
  world.agents = [agent("task", "app", "working", { tab: "task-tab" }), agent("main", "app")];
  world.panes = [{ pane: "pipe-pane", tab: "pipe-tab", mod: "pipeline" }, { pane: "task-pane", tab: "task-tab", cwd: "/wt/t-4-fix-8a32" }, { pane: "main-pane", tab: "app-tab", cwd: "/work/app" }];
  view.git = {
    '[null,"/wt/t-4-fix-8a32"]': { repo: "repo", name: "app", branch: "t-4-fix", top: "/wt/t-4-fix-8a32", linked: true },
    '[null,"/work/app"]': { repo: "repo", name: "app", branch: "main", top: "/work/app", linked: false },
  };
  let root = view.render();
  assert.equal(text(find(root, "space-app")).trim(), "A app");
  const tree = find(root, "worktree-tree-app-0");
  assert.match(text(tree), /t-4-fix/);
  assert.ok(find(tree, "ag-task"));
  assert.equal(find(tree, "ag-main"), undefined);
  assert.ok(find(find(root, "space-tree-app"), "ag-main"));
  click(root, "worktree-app-0");
  assert.deepEqual(world.calls.at(-1), ["pane.focus", { pane: "task-pane" }]);
  sharedState.set("spaces.focus", "app"); root = view.render();
  assert.match(text(find(root, "spaces-focus-title")), /app/);
  assert.ok(find(find(root, "focus-worktree-tree-app-0"), "focus-ag-task"));
  app.named = true;
  assert.match(text(view.render()), /t-4-fix-8a32/);
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

test("the hover focus button selects its own space without dragging or changing pins", () => {
  const view = setup();
  sharedState.set("space.pinned", ["app"]);
  let root = view.render();
  assert.equal(find(root, "space-focus-other"), undefined);
  find(root, "space-other").handlers.hover(true, cx);
  root = view.render();
  const button = find(root, "space-focus-other");
  assert.ok(button);
  let stops = 0;
  const actionCx = { ...cx, stop_propagation() { stops++; } };
  button.handlers["mouse_down-left"]({}, actionCx);
  button.handlers["mouse_up-left"]({}, actionCx);
  assert.equal(stops, 2);
  assert.deepEqual(world.calls, []);
  button.handlers.click({}, actionCx);
  assert.equal(stops, 3);
  assert.equal(sharedState.get("spaces.focus"), "other");
  assert.deepEqual(world.calls, [["space.select", { id: "other" }]]);
  assert.deepEqual(sharedState.get("space.pinned"), ["app"]);
  assert.equal(view.pressed, null);
  assert.ok(find(view.render(), "spaces-focus-view"));
});

test("the menu focuses the right-clicked space, selects it, and offers a way back", () => {
  setup();
  world.menu = { tab: "space", target: { id: "other" }, overlay: "popup" };
  const menu = new Menu(); menu.init({}, cx);
  assert.match(text(menu.render(cx)), /Focus this space/);
  menu.choose(3, cx);
  assert.equal(sharedState.get("spaces.focus"), "other");
  assert.deepEqual(world.calls, [["space.select", { id: "other" }]]);
  assert.deepEqual(world.closed, ["popup"]);
  assert.match(text(menu.render(cx)), /Show all spaces/);
  menu.choose(3, cx);
  assert.equal(sharedState.get("spaces.focus"), null);
  assert.equal(world.calls.length, 1);
});

test("a stale focus menu never selects an unrelated space", () => {
  setup();
  world.menu = { tab: "space", target: { id: "gone" }, overlay: "popup" };
  const menu = new Menu(); menu.init({}, cx); menu.choose(3, cx);
  assert.equal(sharedState.has("spaces.focus"), false);
  assert.deepEqual(world.calls, []);
});

test("focus shows only that space's agents while keeping the original list mounted for scroll restoration", () => {
  const view = setup();
  click(view.render(), "space-fold-app");
  view.attention = true;
  const savedFolds = preferences.get("spaces.expanded");
  const before = find(view.render(), "spaces-all-list");
  sharedState.set("spaces.focus", "app");
  const root = view.render(), focus = find(root, "spaces-focus-view");
  assert.ok(find(root, "spaces-all-view").styles.invisible);
  assert.equal(find(root, "spaces-all-list").styles.id[0], before.styles.id[0]);
  assert.ok(find(focus, "focus-ag-one")); // Focus ignores the full tree's folds and filter.
  assert.equal(find(focus, "focus-ag-two"), undefined);
  assert.equal(find(focus, "space-app"), undefined);
  assert.equal(text(find(focus, "spaces-focus-title")).trim(), "A app");
  click(focus, "focus-ag-one");
  assert.deepEqual(world.calls, [["pane.focus", { pane: "one-pane" }]]);
  click(root, "spaces-unfocus");
  const restored = view.render();
  assert.equal(find(restored, "spaces-focus-view"), undefined);
  assert.equal(find(restored, "spaces-all-view").styles.invisible, undefined);
  assert.equal(preferences.get("spaces.expanded"), savedFolds);
  assert.equal(view.attention, true);
});

test("focus stays on its chosen space when agents finish or another space becomes active", () => {
  const view = setup(); sharedState.set("spaces.focus", "app");
  world.agents[0].status = "done";
  world.spaces[0].active = false; world.spaces[1].active = true;
  const root = view.render(), focus = find(root, "spaces-focus-view");
  assert.equal(sharedState.get("spaces.focus"), "app");
  assert.equal(find(focus, "focus-ag-one").styles.accessibility_label[0], "Task one, Done");
  click(focus, "spaces-focus-title");
  assert.deepEqual(world.calls, [["space.select", { id: "app" }]]);
});

test("the back button counts attention only in other spaces, including their subagents", () => {
  const view = setup(); sharedState.set("spaces.focus", "app");
  world.agents[0].status = "blocked"; world.agents[1].status = "blocked";
  world.terminals = [{ address: "child", parent: "two", state: "live", status: "error", program }];
  let root = view.render();
  assert.equal(text(find(root, "spaces-focus-elsewhere")), "2 elsewhere");
  world.agents[1].status = "idle"; world.terminals = [];
  root = view.render();
  assert.equal(find(root, "spaces-focus-elsewhere"), undefined);
  assert.ok(find(root, "spaces-unfocus"));
});

test("focused subagents and pins keep their actions and use distinct element identities", () => {
  const view = setup(); sharedState.set("spaces.focus", "app"); world.agents[0].pinned = true;
  world.terminals = [{ address: "child", parent: "one", state: "live", status: "working", program }];
  let root = view.render();
  click(root, "focus-agent-fold-one");
  root = view.render();
  assert.ok(find(find(root, "spaces-focus-view"), "focus-ag-child"));
  assert.ok(find(find(root, "spaces-all-view"), "ag-child"));
  click(root, "focus-ag-child"); click(root, "focus-agent-pin-one");
  assert.deepEqual(world.calls, [["terminal.peek", { terminal: "child" }], ["terminal.pin", { terminal: "one", pinned: false }]]);
});

test("empty and narrow focused views keep an accessible way back", () => {
  const view = setup(); sharedState.set("spaces.focus", "app"); world.agents = [];
  let root = view.render();
  assert.match(text(find(root, "spaces-focus-view")), /No agents in this space/);
  world.width = 76; world.agents = [agent("one", "app")];
  root = view.render();
  assert.ok(find(root, "spaces-focus-expand-sidebar"));
  assert.equal(text(find(root, "focus-ag-one")).trim(), ""); // Icon and status, with the full name in its tooltip.
  assert.match(find(root, "focus-ag-one").styles.tooltip[0], /Task one/);
  click(root, "spaces-unfocus");
  assert.equal(find(view.render(), "spaces-focus-view"), undefined);
});

test("closing the focused space returns to all spaces without selecting another target", () => {
  const view = setup(); sharedState.set("spaces.focus", "app");
  world.spaces = [world.spaces[1]];
  const root = view.render();
  assert.equal(find(root, "spaces-focus-view"), undefined);
  assert.equal(sharedState.get("spaces.focus"), null);
  assert.ok(find(root, "space-other"));
  assert.deepEqual(world.calls, []);
});

test("hover hide precedes the pin and opens choices without selecting, dragging or changing pins", () => {
  const view = setup(); sharedState.set("space.pinned", ["app"]);
  find(view.render(), "space-app").handlers.hover(true, cx);
  const row = find(view.render(), "space-app"), button = find(row, "space-hide-app");
  const ids = row.nodes[0].nodes.map(n => n.styles?.id?.[0]);
  assert.ok(ids.indexOf("space-hide-app") < ids.indexOf("space-pin-app"));
  let stopped = 0;
  const actionCx = { ...cx, stop_propagation() { stopped++; } };
  button.handlers["mouse_down-left"]({}, actionCx); button.handlers["mouse_up-left"]({}, actionCx);
  button.handlers.click({}, actionCx);
  assert.equal(stopped, 3); assert.equal(view.pressed, null);
  assert.deepEqual(world.calls, []);
  assert.deepEqual(sharedState.get("space.pinned"), ["app"]);
  assert.deepEqual(world.opened[0].props, { id: "app" });
});

test("the right-click menu offers hide before pin and rejects a stale target", () => {
  setup(); world.menu = { tab: "space", target: { id: "other" }, overlay: "popup" };
  const menu = new Menu(); menu.init({}, cx);
  assert.match(text(menu.render(cx)).replace(/\s+/g, " "), /Rename Hide space until… Pin to top/);
  menu.choose(1, cx);
  assert.deepEqual(world.opened[0].props, { id: "other" });
  assert.deepEqual(world.calls, []);
  world.opened = []; world.menu.target.id = "gone"; menu.choose(1, cx);
  assert.deepEqual(world.opened, []);
});

test("hiding persists across sidebar reloads, excludes attention, and leaves pin and model order intact", () => {
  let view = setup(); world.agents[1].status = "blocked";
  sharedState.set("space.pinned", ["app"]); sharedState.set("spaces.focus", "app");
  hideState.hideSpace("app", Date.now() + 60000); hideState.hideSpace("other", Date.now() + 60000);
  assert.equal(sharedState.get("spaces.focus"), null);
  view = new Spaces(); view.init({}, cx);
  let root = view.render();
  assert.equal(find(root, "space-app"), undefined); assert.equal(find(root, "ag-two"), undefined);
  assert.equal(text(find(root, "spaces-hidden")).trim(), "Hidden spaces 2");
  click(root, "spaces-needs-you"); root = view.render();
  assert.match(text(root), /No agents need you/);
  assert.deepEqual(world.order, []); assert.deepEqual(world.calls, []);
  assert.deepEqual(sharedState.get("space.pinned"), ["app"]);
  click(root, "spaces-hidden"); assert.deepEqual(world.opened[0].props, { list: true });
  world.width = 76; assert.ok(find(view.render(), "spaces-hidden"));
  world.width = 268; hideState.restoreSpace("app"); click(view.render(), "spaces-needs-you");
  assert.ok(find(view.render(), "space-app"));
});

test("the existing timer expires deadlines and returns spaces without a user action", () => {
  const view = setup(); let timer;
  const timerCx = { ...cx, timer: { every(ms, fn) { if (ms === 250) timer = fn; } } };
  view.init({}, timerCx);
  const now = Date.now(); sharedState.set("spaces.hidden", { app: now + 5000 });
  assert.equal(find(view.render(), "space-app"), undefined);
  const original = Date.now;
  try { Date.now = () => now + 5000; timer(cx); }
  finally { Date.now = original; }
  assert.deepEqual(sharedState.get("spaces.hidden"), {});
  assert.ok(find(view.render(), "space-app"));
});

test("hidden checkout roots promote visible worktrees and hidden children leave their checkout visible", () => {
  const view = setup(); world.spaces = [space("app", true), space("worktree")];
  world.agents = [agent("one", "app"), agent("two", "worktree")]; view.shown.add("worktree");
  view.git = { '[null,"/work/app"]': { repo: "repo", name: "app", branch: "main", linked: false },
    '[null,"/work/worktree"]': { repo: "repo", name: "app", branch: "feature", linked: true } };
  hideState.hideSpace("app", Date.now() + 60000);
  let root = view.render(); assert.ok(find(root, "space-worktree")); assert.ok(find(root, "ag-two"));
  assert.equal(find(root, "space-app"), undefined);
  hideState.restoreSpace("app"); hideState.hideSpace("worktree", Date.now() + 60000);
  root = view.render(); assert.ok(find(root, "space-app")); assert.equal(find(root, "space-worktree"), undefined);
  assert.deepEqual(world.calls, []);
});

test("preset picker hides the requested space and the hidden list restores early", () => {
  const view = setup(); world.menu = { id: "other", overlay: "hide" };
  const picker = new SpaceHide(); picker.init({}, cx);
  const start = Date.now(); click(picker.render(), "space-hide-choice-0");
  assert.ok(sharedState.get("spaces.hidden").other >= start + 30 * 60000);
  assert.equal(find(view.render(), "space-other"), undefined); assert.deepEqual(world.closed, ["hide"]);
  world.menu = { list: true, overlay: "hidden" };
  const list = new SpaceHide(); list.init({}, cx); click(list.render(), "hidden-space-other");
  assert.ok(find(view.render(), "space-other")); assert.match(text(list.render()), /No hidden spaces/);
  assert.deepEqual(world.calls, []);
});

test("custom deadlines reject invalid, normalized and past times and accept a future local time", () => {
  setup(); world.menu = { id: "other", custom: true, overlay: "custom" };
  const picker = new SpaceHide(); picker.init({}, cx);
  for (const invalid of ["bad", "2027-02-30 12:00", "2027-01-01 24:00", "2020-01-01 12:00"]) {
    picker.input.text = invalid; picker.submit(cx);
    assert.match(picker.error, /Enter a future/); assert.equal(sharedState.has("spaces.hidden"), false);
  }
  picker.input.text = hideState.localTime(Date.now() + 3600000); picker.submit(cx);
  assert.equal(sharedState.get("spaces.hidden").other, hideState.parseLocalTime(picker.input.text));
  assert.deepEqual(world.closed, ["custom"]);
});

test("deadline parsing and tomorrow preserve local calendar time and stale pickers cannot hide another space", () => {
  setup(); const now = new Date(2026, 10, 7, 23, 30).getTime();
  assert.equal(hideState.hideChoices(now)[3][1], new Date(2026, 10, 8, 9).getTime());
  assert.equal(hideState.parseLocalTime("2028-02-29 08:05"), new Date(2028, 1, 29, 8, 5).getTime());
  sharedState.set("spaces.hidden", { expired: now - 1, text: "9999999999999", other: now + 1000 });
  assert.deepEqual(hideState.hiddenSpaces(now), { other: now + 1000 });
  world.menu = { id: "gone", overlay: "hide" }; const picker = new SpaceHide(); picker.init({}, cx); picker.choose(0, cx);
  assert.match(picker.error, /no longer available/); assert.deepEqual(world.calls, []);
});

test("the shipped custom layout mounts a single list and keeps the agent panel out", async () => {
  const layout = JSON.parse(await readFile(new URL("../layouts/main-custom.json", import.meta.url), "utf8"));
  const mods = [];
  const walk = n => { if (n.content?.mod) mods.push(n.content.mod); (n.children ?? []).forEach(walk); };
  walk(layout);
  assert.equal(mods.filter(m => m === "spaces-pin").length, 1);
  assert.equal(mods.includes("agents"), false);
});

test("the sidebar walks spaces and agents with the keyboard", () => {
  const view = setup();
  view.keyboard = true;
  view.render();
  const key = (k) => view.key({ key: k, modifiers: {} }, cx);
  world.calls = [];
  key("down");
  assert.equal(view.cursor, "space:app");
  key("down");
  assert.equal(view.cursor, "agent:one");
  key("enter");
  assert.deepEqual(world.calls, [["pane.focus", { pane: "one-pane" }]]);
  key("left");
  assert.equal(view.cursor, "space:app");
  key("end");
  assert.equal(view.cursor, "agent:two");
  key("up");
  world.calls = [];
  key("enter");
  assert.deepEqual(world.calls, [["space.select", { id: "other" }]]);
  key("p");
  assert.deepEqual(sharedState.get("space.pinned"), ["other"]);
  view.render();
  assert.equal(view.nav[0].key, "space:other");
  key("escape");
  assert.equal(view.keyboard, false);
  assert.deepEqual(world.calls.at(-1), ["pane.go", { direction: "right" }]);
});

test("a space lists its pipeline once it is in use, a still dot while started, and opens it there", () => {
  const view = setup(), key = LIVE + JSON.stringify([null, "/work/app"]);
  const context = { id: JSON.stringify([null, "/work/app"]), cwd: "/work/app", on: null, name: "app" };
  const live = (running, tasks) => sharedState.set(STORE, { [key]: { live: true, context, running, tasks } });
  live(false, [{ status: "done" }]);
  assert.equal(find(view.render(), "pipeline-app"), undefined);
  live(false, [{ status: "queued" }, { status: "review" }]);
  let row = find(view.render(), "pipeline-app");
  assert.ok(find(find(view.render(), "space-tree-app"), "pipeline-app"));
  assert.equal(find(view.render(), "pipeline-other"), undefined);
  assert.equal(row.styles.tooltip[0], "Pipeline · Not started · 1 queued · 1 to review");
  assert.equal(row.nodes.at(-1).styles.spin, undefined);
  live(true, [{ status: "working" }]);
  row = find(view.render(), "pipeline-app");
  assert.equal(row.styles.tooltip[0], "Pipeline · Started · 1 working");
  assert.equal(row.nodes.at(-1).styles.spin, undefined);
  assert.ok(row.nodes.at(-1).styles.bg);
  row.handlers.click({}, cx);
  assert.deepEqual(world.calls, [["space.select", { id: "app" }], ["tab.new", { space: "app", name: "Pipeline", mod: "pipeline", props: { context: { ...context, space: "app" } } }]]);
  world.calls = [];
  world.panes = [{ pane: "pipe", mod: "pipeline", tab: "other-tab", terminal: null, cwd: null }];
  click(view.render(), "pipeline-other");
  assert.deepEqual(world.calls, [["space.select", { id: "other" }], ["tab.select", { id: "other-tab" }], ["pane.focus", { pane: "pipe" }]]);
  click(view.render(), "spaces-needs-you");
  assert.equal(find(view.render(), "pipeline-app"), undefined);
});

test("two spaces in one folder each have their own pipeline; an older shared one stays with the space that started it", () => {
  const view = setup(), all = {};
  world.panes = [{ pane: "o", mod: null, tab: "other-tab", terminal: null, cwd: "/work/app" }];
  const own = (space, running) => all[LIVE + JSON.stringify([null, "/work/app", space])] = { live: true, running, tasks: [{ status: "queued" }], context: { id: JSON.stringify([null, "/work/app", space]), cwd: "/work/app", on: null, name: "app", space } };
  own("app", true); own("other", false);
  sharedState.set(STORE, all);
  assert.match(find(view.render(), "pipeline-app").styles.tooltip[0], /Started/);
  assert.match(find(view.render(), "pipeline-other").styles.tooltip[0], /Not started/);
  const older = { live: true, running: true, space: "app", tasks: [], context: { id: JSON.stringify([null, "/work/app"]), cwd: "/work/app", on: null, name: "app" } };
  sharedState.set(STORE, { [LIVE + JSON.stringify([null, "/work/app"])]: older });
  assert.ok(find(view.render(), "pipeline-app"));
  assert.equal(find(view.render(), "pipeline-other"), undefined);
});

test("closing a space's pipeline asks first, then stops it, discards its work and closes its tab", () => {
  const view = setup(), key = LIVE + JSON.stringify([null, "/work/app"]);
  const context = { id: JSON.stringify([null, "/work/app"]), cwd: "/work/app", on: null, name: "app" };
  sharedState.set(STORE, { [key]: { live: true, version: 5, context, running: true, schedule: null, events: [], tasks: [
    { id: "T-1", status: "working", depends: [], workspaces: { app: {} }, discard: false },
    { id: "T-2", status: "queued", depends: [], workspaces: null, discard: false },
    { id: "T-3", status: "pr", depends: [], workspaces: { app: {} }, discard: false }] } });
  world.panes = [{ pane: "pipe", mod: "pipeline", tab: "app-tab", terminal: null, cwd: null }];
  assert.equal(find(view.render(), "pipeline-close-app"), undefined);
  find(view.render(), "pipeline-app").handlers.hover(true, cx);
  click(view.render(), "pipeline-close-app");
  assert.equal(world.calls.length, 0);
  assert.deepEqual(world.opened.map(o => [o.mod, o.kind, o.props]), [["pipeline-close", "dialog", { space: "app", key, tab: "app-tab" }]]);
  assert.deepEqual(closeDetail(sharedState.get(STORE)[key]), ["Stops the pipeline, so no new task starts.",
    "Stops 1 agent and deletes its worktrees and branches. Unmerged work is lost.", "Removes 1 queued task.",
    "Leaves 1 task that is merging or waiting on a pull request."]);
  world.menu = { ...world.opened[0].props, overlay: "o1" };
  const dialog = new PipelineClose(); dialog.init({}, cx);
  click(dialog.render(), "no");
  assert.deepEqual(world.closed, ["o1"]);
  assert.equal(sharedState.get(STORE)[key].running, true);
  click(dialog.render(), "yes");
  const state = sharedState.get(STORE)[key];
  assert.equal(state.running, false);
  assert.deepEqual(state.tasks.map(task => [task.id, task.discard]), [["T-1", true], ["T-3", false]]);
  assert.deepEqual(world.calls, [["tab.close", { id: "app-tab", confirmed: true }]]);
  world.panes = [];
  assert.ok(find(view.render(), "pipeline-app"), "an open pull request keeps it listed");
  state.tasks = state.tasks.filter(task => task.id !== "T-3");
  assert.equal(find(view.render(), "pipeline-app"), undefined);
});
